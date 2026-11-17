#!/bin/bash
# полная пересборка трёх роликов «Ворожеи»: кадры → видео со звуком (приглушение под концовкой, затухание в конце)
set -e
V=/private/tmp/claude-501/-Users-vladislavzherebtsov-Cursor----------------------/43ed27f2-9d17-4819-9175-b5dfe5f42572/scratchpad/vor
O="/Users/vladislavzherebtsov/Cursor Проекты/Осколки Хаоса/docs/контент/ворожея/ролики"
cd "$V/../pw"
for c in ${CLIPS:-A B C}; do rm -rf "$V/out_$c"; node vor.js $c; done
cd "$V"
enc() { # clip from dur name endAt fadeIn
  E=$(python3 -c "print(round($5-$2,2))"); F=$(python3 -c "print(round($3-1.4,2))")
  ffmpeg -hide_banner -loglevel error -y -framerate 24 -i out_$1/%04d.png -ss $2 -t $3 -i song.mp3 \
    -filter_complex "[0:v]noise=alls=3:allf=t,format=yuv420p[v];[1:a]afade=t=in:st=0:d=$6,volume='if(lt(t,$E),1,max(0.5,1-(t-$E)*0.8))':eval=frame,afade=t=out:st=$F:d=1.4[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 19 -profile:v high -c:a aac -b:a 192k -shortest -movflags +faststart "$O/$4.mp4"
}
[[ "${CLIPS:-A B C}" == *A* ]] && enc A 245.2 32.0 "1-расклад-припев" 272.0 0.3
[[ "${CLIPS:-A B C}" == *B* ]] && enc B 51.6 29.2 "2-вытяни-карту" 75.6 0.3
[[ "${CLIPS:-A B C}" == *C* ]] && enc C 68.44 21.56 "0-тизер-17-ноября" 84.85 0.02
for f in "$O"/*.mp4; do echo "$(basename "$f") $(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f")"; done
