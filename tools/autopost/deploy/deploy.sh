#!/bin/sh
# Выкладка Глашатая на VPS (общий с сайтом и другими проектами). Запуск с ноутбука из корня репозитория, DEPLOY_HOST — ssh-хост сервера:
#   sh tools/autopost/deploy/deploy.sh            — обновить код и перезапустить службу
#   sh tools/autopost/deploy/deploy.sh --install  — первый раз: пользователь, папки, Node 24, служба, nginx, https
# Соседей не трогает: свой пользователь, свой Node, свой порт 3400, свой файл nginx; перед перезагрузкой nginx — nginx -t.
set -eu
HOST=${DEPLOY_HOST:?укажите DEPLOY_HOST=<ssh-хост сервера>}

if [ "${1:-}" = "--install" ]; then
  ssh "$HOST" "set -eu
    id glashatai >/dev/null 2>&1 || useradd --system --home /var/lib/glashatai --shell /usr/sbin/nologin glashatai
    mkdir -p /opt/glashatai/repo /var/lib/glashatai /var/www/glashatai-media
    chown glashatai:glashatai /var/lib/glashatai /var/www/glashatai-media
    # настройки — из примера на stdin (первой командой, пока stdin никто не прочитал), со своим SECRET_KEY
    [ -f /etc/glashatai.env ] || { sed \"s/^SECRET_KEY=.*/SECRET_KEY=\$(openssl rand -hex 32)/\" > /etc/glashatai.env; chown root:glashatai /etc/glashatai.env; chmod 640 /etc/glashatai.env; }
    if [ ! -x /opt/glashatai/node/bin/node ]; then
      # свежий Node 24 (LTS) только для Глашатая; сверяем контрольную сумму с официальным списком
      cd /tmp && T=\$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep linux-x64.tar.xz)
      F=\$(echo \"\$T\" | awk '{print \$2}') && curl -fsSLO https://nodejs.org/dist/latest-v24.x/\$F && echo \"\$T\" | sha256sum -c -
      mkdir -p /opt/glashatai/node && tar -xJf \$F -C /opt/glashatai/node --strip-components=1 && rm \$F
    fi
    # свой статический ffmpeg: apt мог бы обновить общие библиотеки и перезапустить соседние службы
    if [ ! -x /opt/glashatai/bin/ffmpeg ]; then
      mkdir -p /opt/glashatai/bin && cd /tmp && curl -fsSLO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
      curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz.md5 | md5sum -c -
      D=\$(mktemp -d) && tar -xJf ffmpeg-release-amd64-static.tar.xz -C \$D --strip-components=1 && cp \$D/ffmpeg \$D/ffprobe /opt/glashatai/bin/ && rm -rf \$D ffmpeg-release-amd64-static.tar.xz
    fi
  " < tools/autopost/deploy/glashatai.env.example
  scp -q tools/autopost/deploy/glashatai.service "$HOST":/etc/systemd/system/glashatai.service
  scp -q tools/autopost/deploy/nginx.conf "$HOST":/etc/nginx/sites-available/glashatai
fi

# Код и контент (docs — библиотека файлов кабинета, data.js — пророчества, арт из корня сайта — его берут посты). Данные (/var/lib/glashatai) не трогаем.
# Тяжёлое (видео, аудио) напрямую не возим: путь «ноутбук → сервер» медленный (~20 КБ/с, 18.11.2026), а GitHub → сервер — десятки МБ/с.
# Поэтому видео сервер забирает сам с GitHub по последнему отправленному коммиту — см. ниже. --delete их не трогает (исключены из передачи).
rsync -az --delete --no-owner --no-group \
  --exclude '*.mp4' --exclude '*.mov' --exclude '*.mp3' --exclude '*.wav' \
  --include 'data.js' --include '/*.jpg' --include '/*.png' --include '/*.webp' --include 'docs/***' --include 'tools/' --include 'tools/autopost/***' \
  --exclude 'tools/autopost/data/***' --exclude 'tools/autopost/.env' --exclude '.DS_Store' --exclude '*' \
  ./ "$HOST":/opt/glashatai/repo/

# Видео и аудио — с GitHub (репозиторий публичный): у каждого файла сверяем сумму, качаем только изменившиеся.
# Файл, изменённый, но не отправленный в GitHub, сервер взять не может — предупреждаем: сначала «пушь».
REMOTE=$(git rev-parse origin/dev 2>/dev/null || true)
CHANGED=$(git -c core.quotepath=off status --porcelain -- docs '*.mp4' '*.mp3' 2>/dev/null | grep -E '\.(mp4|mov|mp3|wav)"?$' || true)
[ -n "$CHANGED" ] && echo "Внимание: эти медиафайлы не отправлены в GitHub — на сервере останутся прежние версии, сначала «пушь»:" && echo "$CHANGED"
if [ -n "$REMOTE" ]; then
  git -c core.quotepath=off ls-tree -r "$REMOTE" --name-only | grep -E '^(docs/|media/).*\.(mp4|mov|mp3|wav)$|^[^/]+\.(mp4|mp3)$' | while read -r f; do
    [ -f "$f" ] && printf '%s  %s\n' "$(git show "$REMOTE:$f" | shasum -a 256 | cut -d' ' -f1)" "$f"
  done | ssh "$HOST" "cd /opt/glashatai/repo && while read -r sum f; do
      echo \"\$sum  \$f\" | sha256sum -c --quiet - >/dev/null 2>&1 && continue
      mkdir -p \"\$(dirname \"\$f\")\"
      enc=\$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' \"\$f\")
      curl -fsSL -m 300 -o \"\$f.dl\" \"https://raw.githubusercontent.com/IaroslavMironov/oskolki_haosa/$REMOTE/\$enc\" && echo \"\$sum  \$f.dl\" | sha256sum -c --quiet - \\
        && mv -f \"\$f.dl\" \"\$f\" && echo \"с GitHub: \$f\" || { rm -f \"\$f.dl\"; echo \"не скачалось: \$f\"; }
    done"
fi

ssh "$HOST" "set -eu
  chmod -R a+rX /opt/glashatai/repo
  systemctl daemon-reload
  if [ \"${1:-}\" = \"--install\" ]; then
    ln -sf /etc/nginx/sites-available/glashatai /etc/nginx/sites-enabled/glashatai
    nginx -t && systemctl reload nginx
    certbot --nginx -d glashatai.oskolkihaosa.ru --non-interactive --agree-tos --redirect --register-unsafely-without-email || echo 'certbot не прошёл — проверьте DNS-запись glashatai'
    systemctl enable glashatai
  fi
  systemctl restart glashatai
  sleep 2; systemctl is-active glashatai
"
echo "Готово: https://glashatai.oskolkihaosa.ru"
echo "Завести человека или выдать новый пароль (печатает пароль):"
echo "  ssh $HOST 'cd /opt/glashatai/repo/tools/autopost && sudo -u glashatai AUTOPOST_DATA=/var/lib/glashatai /opt/glashatai/node/bin/node auth.js yaroslav Ярослав'"
