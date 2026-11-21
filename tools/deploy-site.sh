#!/bin/sh
# Выкладка сайта-кодекса (статика nginx). Запуск из корня репозитория: DEPLOY_HOST=<ssh-хост> sh tools/deploy-site.sh
# На сайт уходят только файлы сайта: служебное (инструменты, документы, тесты, настройки) исключено.
set -eu
HOST=${DEPLOY_HOST:?укажите DEPLOY_HOST=<ssh-хост сервера>}
rsync -az --delete --no-owner --no-group \
  --exclude .git --exclude .github --exclude .claude --exclude tools --exclude docs --exclude tests --exclude node_modules \
  --exclude 'CLAUDE*.md' --exclude .gitignore --exclude .DS_Store \
  --exclude package.json --exclude package-lock.json --exclude eslint.config.js \
  ./ "$HOST":/var/www/oskolkihaosa.ru/
curl -s -o /dev/null -w "сайт %{http_code}\n" https://oskolkihaosa.ru
