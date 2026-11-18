/*
 * Предпросмотр: как пост будет выглядеть на площадке. Не копия интерфейсов, а их раскладка и правила,
 * которые влияют на вид: где обрежется подпись, где окажется файл, что увидит человек в ленте.
 * Правила обрезки — по виду площадок на 11.2026: VK ≈ 7 строк / 400 знаков, Instagram — 125 знаков, Telegram — подпись к файлу до 1024.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isVideo = (p) => /\.(mp4|mov|m4v|webm)$/i.test(p);
const src = (p) => `/media?p=${encodeURIComponent(p)}`;
const AVATAR = src('docs/vk/аватар-сообщества.png');

/** Текст с подсветкой хэштегов, @упоминаний и ссылок; переносы строк сохраняются. */
function rich(text) {
  return esc(text)
    .replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="pv-tag">$2</span>')
    .replace(/(^|\s)(@[\w.]+)/g, '$1<span class="pv-tag">$2</span>')
    .replace(/\b((?:https?:\/\/)?[\w-]+\.(?:ru|com|рф|me|io)(?:\/[^\s<]*)?)/g, '<span class="pv-link">$1</span>')
    .replace(/\n/g, '<br>');
}

/** Обрезка как в ленте: кусок + «ещё» (по клику раскрывается). */
function clamp(text, max, more) {
  if (text.length <= max) return rich(text);
  const cut = text.slice(0, max).replace(/\s+\S*$/, '');
  return `<span class="pv-short">${rich(cut)}… <a href="#" class="pv-more" data-pv-more>${more}</a></span><span class="pv-full" hidden>${rich(text)}</span>`;
}

const media1 = (f, cls = '') => (isVideo(f)
  ? `<video class="${cls}" src="${src(f)}" muted autoplay loop playsinline></video>`
  : `<img class="${cls}" src="${src(f)}" alt="">`);

function grid(files) {
  if (!files.length) return '';
  if (files.length === 1) return `<div class="pv-media">${media1(files[0])}</div>`;
  return `<div class="pv-grid n${Math.min(files.length, 4)}">${files.slice(0, 4).map((f, i) => `<div>${media1(f)}${i === 3 && files.length > 4 ? `<b>+${files.length - 4}</b>` : ''}</div>`).join('')}</div>`;
}

/** Вертикальный экран (клипы, Shorts, Reels, TikTok, истории). */
function phone({ file, name, caption = '', title = '', lines = 2, note = '' }) {
  return `<div class="pv-phone">
    ${file ? media1(file, 'pv-fill') : '<div class="pv-fill pv-empty">нет файла</div>'}
    <div class="pv-over">
      <div class="pv-who"><img src="${AVATAR}" alt=""><b>${esc(name)}</b></div>
      ${title ? `<div class="pv-title">${esc(title)}</div>` : ''}
      ${caption ? `<div class="pv-cap" style="--lines:${lines}">${rich(caption)}</div>` : ''}
    </div>
    <div class="pv-side">♥<br>💬<br>↗</div>
  </div>${note ? `<p class="pv-note">${note}</p>` : ''}`;
}

const head = (name, sub) => `<div class="pv-head"><img src="${AVATAR}" alt=""><div><b>${esc(name)}</b><span>${esc(sub)}</span></div></div>`;

export function preview({ platform, format, account, caption, title, files, when }) {
  const name = account || 'Осколки хаоса';
  const time = when || 'сейчас';
  const video = files.find(isVideo);
  if (platform === 'vk') {
    if (format === 'story') return phone({ file: files[0], name, note: 'История живёт 24 часа, без подписи. Ссылку-стикер API поставить не даёт.' });
    if (format === 'clip') return phone({ file: video, name, caption, lines: 2, note: 'Клип выкладывается вручную в приложении VK — так он будет выглядеть в ленте клипов.' });
    return `<div class="pv-card pv-vk">${head(name, time)}
      ${caption ? `<div class="pv-text">${clamp(caption, 400, 'Показать ещё')}</div>` : ''}
      ${grid(files)}
      <div class="pv-acts">♡ &nbsp; 💬 &nbsp; ↗ <span>👁 0</span></div></div>`;
  }
  if (platform === 'telegram') {
    const split = caption.length > 1024 && files.length;
    const bubble = (inner, foot = true) => `<div class="pv-bubble">${inner}${foot ? `<div class="pv-meta">👁 1 · ${esc(time)}</div>` : ''}</div>`;
    return `<div class="pv-tg"><div class="pv-tg-chan">${head(name, 'канал')}</div>
      ${files.length ? bubble(`${grid(files)}${!split && caption ? `<div class="pv-text">${rich(caption)}</div>` : ''}`, !split) : ''}
      ${!files.length || split ? bubble(`<div class="pv-text">${rich(caption)}</div>`) : ''}
      ${split ? '<p class="pv-note">Подпись длиннее 1024 знаков: файл уйдёт отдельно, текст — следующим сообщением.</p>' : ''}</div>`;
  }
  if (platform === 'youtube') {
    return `${phone({ file: video, name, title: title || '', lines: 1 })}
      <div class="pv-card pv-yt"><b>${esc(title || '')}</b><span class="muted small">${esc(name)} · Shorts · сейчас</span>
      <div class="pv-text">${clamp(caption, 160, 'ещё')}</div></div>`;
  }
  if (platform === 'instagram') {
    if (format === 'reels') return phone({ file: video, name, caption, lines: 1, note: 'В Reels подпись видна одной строкой, остальное — по нажатию.' });
    if (format === 'story') return phone({ file: files[0], name, note: 'История живёт 24 часа, без подписи и стикеров.' });
    return `<div class="pv-card pv-ig">${head(name.replace(/^@/, ''), '')}
      <div class="pv-media sq">${files[0] ? media1(files[0]) : ''}${files.length > 1 ? `<span class="pv-count">1/${files.length}</span>` : ''}</div>
      ${files.length > 1 ? `<div class="pv-dots">${files.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      <div class="pv-acts">♡ &nbsp; 💬 &nbsp; ↗</div>
      <div class="pv-text"><b>${esc(name.replace(/^@/, ''))}</b> ${clamp(caption, 125, 'ещё')}</div></div>`;
  }
  if (platform === 'tiktok') {
    return phone({ file: video, name, caption, lines: 2,
      note: format === 'draft' ? 'Черновик: ролик придёт во «Входящие» TikTok, подпись вставите там — Глашатай пришлёт её в Telegram. Так пост будет выглядеть после публикации.' : 'Без аудита приложения TikTok покажет ролик только вам («видно мне»).' });
  }
  return '<p class="muted">Предпросмотра для этого формата нет.</p>';
}

/** Полностью: вся подпись без обрезки и все файлы в полный размер (ролики — со звуком и перемоткой). */
export function full({ platform, format, caption, title, files }) {
  const tags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  const facts = [`${caption.length} знаков`, tags ? `${tags} хэштегов` : null, files.length ? `файлов: ${files.length}` : 'без файлов'].filter(Boolean).join(' · ');
  return `<div class="pv-full-view">
    ${title && (platform === 'youtube') ? `<div class="pv-fv-title">${esc(title)}</div>` : ''}
    <div class="pv-fv-cap">${caption ? rich(caption) : '<span class="muted">без подписи</span>'}</div>
    <p class="pv-note">${facts}</p>
    ${files.map((f) => `<figure>${isVideo(f) ? `<video src="${src(f)}" controls playsinline preload="metadata"></video>` : `<img src="${src(f)}" alt="">`}<figcaption>${esc(f.split('/').pop())}</figcaption></figure>`).join('')}
  </div>`;
}
