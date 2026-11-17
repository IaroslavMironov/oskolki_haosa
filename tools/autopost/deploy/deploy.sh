#!/bin/sh
# Выкладка Глашатая на VPS (тот же, где gcanalitics, Нейро МОП и сайт). Запуск с ноутбука из корня репозитория:
#   sh tools/autopost/deploy/deploy.sh            — обновить код и перезапустить службу
#   sh tools/autopost/deploy/deploy.sh --install  — первый раз: пользователь, папки, Node 24, служба, nginx, https
# Соседей не трогает: свой пользователь, свой Node, свой порт 3400, свой файл nginx; перед перезагрузкой nginx — nginx -t.
set -eu
HOST=gcanalitics

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
    command -v ffprobe >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg
  " < tools/autopost/deploy/glashatai.env.example
  scp -q tools/autopost/deploy/glashatai.service "$HOST":/etc/systemd/system/glashatai.service
  scp -q tools/autopost/deploy/nginx.conf "$HOST":/etc/nginx/sites-available/glashatai
fi

# Код и контент (docs — библиотека файлов кабинета, data.js — пророчества). Данные (/var/lib/glashatai) не трогаем.
rsync -az --delete --no-owner --no-group \
  --include 'data.js' --include 'docs/***' --include 'tools/' --include 'tools/autopost/***' \
  --exclude 'tools/autopost/data/***' --exclude 'tools/autopost/.env' --exclude '.DS_Store' --exclude '*' \
  ./ "$HOST":/opt/glashatai/repo/

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
