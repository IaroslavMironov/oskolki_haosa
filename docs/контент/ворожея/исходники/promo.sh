#!/bin/bash
# Ролики плана 20–29 ноября из готовых материалов сайта: живые портреты отряда, тизер клипа, письмо Визиусу, пророчества.
# Надписи — прозрачные слои из ../pw/overlays.js (папка ov/). Вертикаль 1080×1920, 24 к/с.
set -e
R="/Users/vladislavzherebtsov/Cursor Проекты/Осколки Хаоса"
O="${OUT:-$R/docs/контент/ворожея/ролики}"
P=$(cd "$(dirname "$0")" && pwd); OV="$P/ov"
ENC=(-c:v libx264 -preset slow -crf 19 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart)
# медленный наезд на картинку: вход → 1080×1920, z от 1 до 1+zz за весь ролик
kb() { echo "scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='1+$2*on/($1*24)':d=1:x='iw/2-(iw/zoom/2)':y='ih*$3-(ih/zoom*$3)':s=1080x1920:fps=24,setsar=1"; }
ov() { echo "format=rgba,fade=in:st=$1:d=0.5:alpha=1,fade=out:st=$2:d=0.4:alpha=1"; }

# Отряд: живой портрет одним проходом вперёд (LIVE с, без петли — губы не успевают «разойтись» со словами) → портрет крупно с наездом, всего 16 с; звук — отрывок песни героя
LIVE=${LIVE:-2.6}
hero() { # ключ песня файл
  local K; K=$(awk "BEGIN{print 16-$LIVE+0.5}")
  ffmpeg -hide_banner -loglevel error -y -i "$R/media/$1.mp4" -loop 1 -framerate 24 -t $K -i "$R/$1.jpg" \
    -loop 1 -t 16 -i "$OV/$1-a.png" -loop 1 -t 16 -i "$OV/$1-b.png" -i "$R/media/previews/$2.mp3" -filter_complex "
    [0:v]scale=1280:1920:flags=lanczos,crop=1080:1920,unsharp=5:5:0.5,fps=24,trim=0:$LIVE,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v1];
    [1:v]$(kb $K 0.09 0.25),format=yuv420p[v2];
    [v1][v2]xfade=transition=fade:duration=0.5:offset=$(awk "BEGIN{print $LIVE-0.5}")[v];
    [2:v]$(ov 0.3 7.7)[a];[3:v]$(ov 8.4 15.4)[b];
    [v][a]overlay=0:0[x];[x][b]overlay=0:0,noise=alls=3:allf=t[vo];
    [4:a]atrim=0:16,asetpts=PTS-STARTPTS,afade=t=in:d=0.2,afade=t=out:st=14.6:d=1.4[ao]" \
    -map "[vo]" -map "[ao]" -t 16 "${ENC[@]}" "$O/$3.mp4"
}

# «Сладкая дрянь»: кусок тизера клипа 44–62 с по центру, фон — тот же кадр размытый
sladkaya() {
  ffmpeg -hide_banner -loglevel error -y -ss 44 -t 18 -i "$R/media/sladkaya-dryan-teaser.mp4" -loop 1 -t 18 -i "$OV/sd.png" -filter_complex "
    [0:v]fps=24,split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.22[bg];
    [b]scale=1080:-2:flags=lanczos[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1[v];[1:v]$(ov 0.2 17.5)[o];[v][o]overlay=0:0,noise=alls=3:allf=t[vo];
    [0:a]afade=t=in:d=0.3,afade=t=out:st=16.6:d=1.4[ao]" -map "[vo]" -map "[ao]" -t 18 "${ENC[@]}" "$O/$1.mp4"
}

# «Корона горит»: письмо → Визиус; хук «Прячься, предатель» звучит на 0.2 и 8.3 с
korona() {
  ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 24 -t 8.6 -i "$R/letter.jpg" -loop 1 -framerate 24 -t 8.6 -i "$R/vizius.jpg" \
    -loop 1 -t 16.6 -i "$OV/kor-a.png" -loop 1 -t 16.6 -i "$OV/kor-b.png" -i "$R/media/previews/korona-gorit.mp3" -filter_complex "
    [0:v]$(kb 8.6 0.08 0.45),format=yuv420p[v1];[1:v]$(kb 8.6 0.06 0.3),format=yuv420p[v2];
    [v1][v2]xfade=transition=fade:duration=0.6:offset=8[v];
    [2:v]$(ov 0.2 7.8)[a];[3:v]$(ov 8.3 16.1)[b];[v][a]overlay=0:0[x];[x][b]overlay=0:0,noise=alls=3:allf=t[vo];
    [4:a]atrim=0:16.6,asetpts=PTS-STARTPTS,afade=t=out:st=15.2:d=1.4[ao]" -map "[vo]" -map "[ao]" -t 16.6 "${ENC[@]}" "$O/$1.mp4"
}

# Пророчество дня: карточка 1080×1350 на тёмном поле, медленный наезд; звук — вступление «Ворожеи» (18–30 с)
prophecy() { # картинка файл
  ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 24 -t 12 -i "$R/docs/контент/ворожея/картинки/$1.jpg" -ss 18 -t 12 -i "$P/../vor/song.mp3" -filter_complex "
    [0:v]pad=1080:1920:0:285:color=0x09060d,$(kb 12 0.05 0.5),noise=alls=3:allf=t,format=yuv420p[vo];
    [1:a]afade=t=in:d=0.6,afade=t=out:st=10.4:d=1.6[ao]" -map "[vo]" -map "[ao]" -t 12 "${ENC[@]}" "$O/$2.mp4"
}

# «Багровая бойня»: замок → король Элронд → бойня, по 6.6 с, отрывок песни (инструментальный)
boynya() {
  ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 24 -t 6.6 -i "$R/castle.jpg" -loop 1 -framerate 24 -t 6.6 -i "$R/elrond.jpg" -loop 1 -framerate 24 -t 6.6 -i "$R/battle.jpg"     -loop 1 -t 18.6 -i "$OV/bb-a.png" -loop 1 -t 18.6 -i "$OV/bb-b.png" -loop 1 -t 18.6 -i "$OV/bb-c.png" -i "$R/media/previews/bagrovaya-boynya.mp3" -filter_complex "
    [0:v]$(kb 6.6 0.07 0.4),format=yuv420p[v1];[1:v]$(kb 6.6 0.06 0.3),format=yuv420p[v2];[2:v]$(kb 6.6 0.08 0.6),format=yuv420p[v3];
    [v1][v2]xfade=transition=fade:duration=0.6:offset=6[x1];[x1][v3]xfade=transition=fade:duration=0.6:offset=12[v];
    [3:v]$(ov 0.3 5.8)[a];[4:v]$(ov 6.3 11.8)[b];[5:v]$(ov 12.3 18.1)[c];
    [v][a]overlay=0:0[y1];[y1][b]overlay=0:0[y2];[y2][c]overlay=0:0,noise=alls=3:allf=t[vo];
    [6:a]atrim=0:18.6,asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=17:d=1.6[ao]" -map "[vo]" -map "[ao]" -t 18.6 "${ENC[@]}" "$O/$1.mp4"
}

for job in ${JOBS:-hero1 prop1 sd hero2 prop2 hero3 kor hero4 prop3}; do case $job in
  hero1) hero ayla hmelnaya-ten "3-отряд-айла" ;;
  prop1) prophecy пророчество-дня-пламя "4-пророчество-1-пламя" ;;
  sd) sladkaya "5-сладкая-дрянь-клип" ;;
  hero2) hero miri sladkaya-dryan "7-отряд-мири" ;;
  prop2) prophecy пророчество-дня-луна "8-пророчество-2-луна" ;;
  hero3) hero ilvy ryzhiy-meh "9-отряд-ильви" ;;
  kor) korona "10-корона-горит" ;;
  hero4) hero vulkan tron-eshche-zhdet "11-отряд-вулкан" ;;
  boynya) boynya "13-багровая-бойня" ;;
  prop3) prophecy пророчество-дня-око "12-пророчество-3-око" ;;
esac; echo "готово: $job"; done
