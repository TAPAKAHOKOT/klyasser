// Импорт уже опубликованного из выгрузки Instagram
// (Настройки → Центр аккаунтов → Ваша информация и разрешения → Скачать информацию, формат JSON).
// Принимает ZIP или распакованную папку. Публикации встают в «опубликованное» в порядке сетки — новые сверху.
// Грузится из index.html по первому клику на «импорт из Instagram»; пользуется его глобальными функциями
// (S, uploadOne, UP, upStep, renderUpload, mutate, toast, canvasToBlob, I, esc).
(function(){
  'use strict';
  const ZIP_URL = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.24.0/dist/zip.min.js';
  const ZIP_SRI = 'sha384-IQSO75gzWxUu8d5fBrmYP/++ztYeZnYcVgY1gvWiW5XTVZpOxEEd5dvgu8lIJl9R';
  const IMG = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i, VID = /\.(mp4|mov|m4v)$/i;
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4' };
  const mimeOf = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  const norm = p => String(p).replace(/\\/g, '/').replace(/^\.?\/+/, '');
  const day = ts => new Date(ts * 1000);
  const fmt = ts => day(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const iso = ts => day(ts).toISOString().slice(0, 10);

  // ---------- откуда читаем: ZIP или папка → { paths, text(path), blob(path) } ----------
  let zipLib = null;
  const loadZip = () => zipLib ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = ZIP_URL; s.integrity = ZIP_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => window.zip ? res(window.zip) : rej(new Error('zip.js'));
    s.onerror = () => { zipLib = null; rej(new Error('zip.js не загрузился')); };
    document.head.appendChild(s);
  });
  async function fromZip(file){
    const zip = await loadZip();
    zip.configure({ useWebWorkers: false });
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    const map = new Map((await reader.getEntries()).filter(e => !e.directory).map(e => [norm(e.filename), e]));
    return { paths: [...map.keys()], text: p => map.get(p).getData(new zip.TextWriter()), blob: p => map.get(p).getData(new zip.BlobWriter(mimeOf(p))), close: () => reader.close() };
  }
  function fromFiles(list){ // [{ path, file }]
    const map = new Map(list.map(x => [norm(x.path), x.file]));
    return { paths: [...map.keys()], text: p => map.get(p).text(), blob: async p => { const f = map.get(p); return f.type ? f : new Blob([f], { type: mimeOf(p) }); }, close(){} };
  }
  async function readDirEntry(dir){
    const out = [];
    const walk = async (d, prefix) => {
      const reader = d.createReader(); let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch){
          if (e.isDirectory) await walk(e, prefix + e.name + '/');
          else if (/\.json$/i.test(e.name) || IMG.test(e.name) || VID.test(e.name)) out.push({ path: prefix + e.name, file: await new Promise((res, rej) => e.file(res, rej)) });
        }
      } while (batch.length);
    };
    await walk(dir, dir.name + '/');
    return out;
  }

  // ---------- разбор выгрузки ----------
  // Ищем в JSON-файлах публикаций объекты вида { media: [{ uri, creation_timestamp }], creation_timestamp }.
  // Так читаются и новые выгрузки (your_instagram_activity/media/posts_1.json, reels.json), и старые (content/posts_1.json).
  function collect(json, kind){
    const out = [];
    const visit = v => {
      if (Array.isArray(v)){ v.forEach(visit); return; }
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v.media) && v.media.length && v.media.every(m => m && typeof m.uri === 'string')){
        const uris = v.media.map(m => norm(m.uri)).filter(u => IMG.test(u) || VID.test(u));
        const ts = Number(v.creation_timestamp || v.media[0].creation_timestamp || 0);
        if (uris.length && ts) out.push({ ts, kind: kind === 'reel' || VID.test(uris[0]) ? 'reel' : 'post', uris });
        return;
      }
      for (const k in v) visit(v[k]);
    };
    visit(json);
    return out;
  }
  async function scan(src){
    const jsons = src.paths.filter(p => /(^|\/)(posts_\d+|reels)\.json$/i.test(p) && !/(archiv|deleted|stories|story)/i.test(p));
    if (!jsons.length){
      if (src.paths.some(p => /\.html$/i.test(p))) throw new Error('Это выгрузка в формате HTML. Запроси новую в формате JSON.');
      throw new Error('В выгрузке не нашлось публикаций. Проверь, что в экспорте отмечены «Публикации» и формат JSON.');
    }
    const byUri = new Map();
    for (const p of jsons){
      let json; try { json = JSON.parse(await src.text(p)); } catch { continue; }
      for (const post of collect(json, /reels\.json$/i.test(p) ? 'reel' : 'post')) if (!byUri.has(post.uris[0])) byUri.set(post.uris[0], post);
    }
    const suffix = new Map(); // uri → путь в архиве (у папки сверху ещё имя папки)
    for (const p of src.paths) suffix.set(p, p);
    const resolve = uri => suffix.get(uri) || src.paths.find(p => p.endsWith('/' + uri)) || null;
    const posts = [...byUri.values()].map(p => ({ ...p, path: resolve(p.uris[0]) })).filter(p => p.path).sort((a, b) => b.ts - a.ts);
    if (!posts.length) throw new Error('Публикации нашлись, но файлов фото в выгрузке нет. Попробуй выгрузить ещё раз с медиафайлами.');
    return posts;
  }

  // кадр для обложки рилса
  async function videoFrame(blob){
    const url = URL.createObjectURL(blob);
    try {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      const wait = (ev, ms = 10000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('видео не открылось')), ms); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); v.addEventListener('error', () => { clearTimeout(t); rej(new Error('видео не открылось')); }, { once: true }); });
      await wait('loadeddata');
      v.currentTime = Math.min(.5, (v.duration || 1) / 4); await wait('seeked');
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      return await canvasToBlob(c, .92);
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- окно импорта ----------
  const CSS = `
  .ig-card{width:min(520px,100%)}
  .ig-steps{margin:0 0 16px;padding-left:20px;font-size:13px;line-height:1.6;color:var(--ink-2)}
  .ig-steps b{color:var(--ink);font-weight:600}
  .ig-drop{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;border:1.5px dashed var(--blue);border-radius:14px;padding:26px 16px;color:var(--blue-deep);
    background:radial-gradient(circle,var(--blue-pale) 1.1px,transparent 1.5px) 0 0/7px 7px;transition:background-color .2s}
  .ig-drop.over{background-color:var(--blue-mist)}
  .ig-drop b{font:italic 600 20px/1.15 var(--serif)}
  .ig-drop small{font:500 11px var(--mono);color:var(--ink-2)}
  .ig-pick{display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap}
  .ig-sum{font-size:14px;line-height:1.55;margin:0 0 16px}
  .ig-sum b{font-weight:700}
  .ig-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px dashed var(--line);font-size:13px}
  .ig-row .seg{flex:none}
  .ig-note{font-size:12px;color:var(--ink-3);margin:6px 0 0;line-height:1.5}
  .ig-err{color:var(--red);font-size:13px;line-height:1.5;margin:0 0 14px}
  .ig-actions{display:flex;justify-content:space-between;align-items:center;margin-top:16px}
  .ig-link{margin-top:8px;font-size:12px}`;
  let modal = null, state = null;
  function ensureModal(){
    if (modal) return modal;
    document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`);
    modal = document.createElement('div'); modal.className = 'modal'; modal.hidden = true;
    modal.innerHTML = `<div class="modal-card ig-card"><div class="panel-head"><h2>импорт из Instagram</h2>
      <button class="icon-btn" data-ig="close" style="margin-left:auto" title="закрыть"><svg class="i" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
      <div class="ig-body"></div>
      <input type="file" accept=".zip,application/zip" hidden data-ig-input="zip">
      <input type="file" webkitdirectory hidden data-ig-input="dir"></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal) return close();
      const b = e.target.closest('[data-ig]'); if (!b) return;
      const a = b.dataset.ig;
      if (a === 'close') return close();
      if (a === 'zip') return modal.querySelector('[data-ig-input=zip]').click();
      if (a === 'dir') return modal.querySelector('[data-ig-input=dir]').click();
      if (a === 'back') return render('intro');
      if (a === 'count'){ state.count = b.dataset.n === 'all' ? Infinity : +b.dataset.n; return render('found'); }
      if (a === 'reels'){ state.reels = !state.reels; return render('found'); }
      if (a === 'go') return start();
    });
    modal.querySelector('[data-ig-input=zip]').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) load({ zip: f }); });
    modal.querySelector('[data-ig-input=dir]').addEventListener('change', e => {
      const list = [...e.target.files].filter(f => /\.json$/i.test(f.name) || IMG.test(f.name) || VID.test(f.name)).map(f => ({ path: f.webkitRelativePath || f.name, file: f }));
      e.target.value = ''; if (list.length) load({ files: list });
    });
    modal.addEventListener('dragover', e => { const d = modal.querySelector('.ig-drop'); if (d && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) d.classList.add('over'); });
    modal.addEventListener('dragleave', e => { if (e.target === modal) { const d = modal.querySelector('.ig-drop'); if (d) d.classList.remove('over'); } });
    return modal;
  }
  function close(){ if (modal) modal.hidden = true; if (state && state.src && state.src.close) state.src.close(); state = null; }
  function chooseSelection(){
    const pool = state.posts.filter(p => state.reels || p.kind !== 'reel');
    const top = pool.slice(0, state.count === Infinity ? pool.length : state.count);
    const have = new Set([...S.photos.values()].filter(p => p.ig).map(p => p.ig.uri));
    return { pool, top, fresh: top.filter(p => !have.has(p.uris[0])), dup: top.filter(p => have.has(p.uris[0])).length };
  }
  function render(view, msg){
    const body = modal.querySelector('.ig-body');
    if (view === 'intro'){
      body.innerHTML = `<ol class="ig-steps">
          <li>В Instagram: <b>Настройки → Центр аккаунтов → Ваша информация и разрешения → Скачать информацию</b>.</li>
          <li><b>Создать экспорт</b> → профиль → <b>Экспорт на устройство</b>. В «Настроить информацию» оставь только <b>«Публикации»</b>.</li>
          <li>Формат <b>JSON</b>, качество медиафайлов <b>высокое</b>, период <b>всё время</b>. Когда придёт письмо — скачай ZIP.</li>
        </ol>
        <div class="ig-drop"><b>перетащи сюда ZIP или папку выгрузки</b><small>фото останутся на твоём компьютере, пока не начнёшь импорт</small></div>
        <div class="ig-pick"><button class="btn quiet sm" data-ig="zip">выбрать ZIP</button><button class="btn quiet sm" data-ig="dir">выбрать папку</button></div>`;
    } else if (view === 'busy'){
      body.innerHTML = `<p class="ig-sum">${esc(msg || 'читаю выгрузку…')}</p>`;
    } else if (view === 'error'){
      body.innerHTML = `<p class="ig-err">${esc(msg)}</p><div class="ig-actions"><button class="btn-text" data-ig="back">${I.back}назад</button><span></span></div>`;
    } else if (view === 'found'){
      const all = state.posts, reels = all.filter(p => p.kind === 'reel').length, sel = chooseSelection();
      const opts = [[12, '12'], [30, '30'], [60, '60'], ['all', 'все']].filter(([n]) => n === 'all' || n < sel.pool.length);
      const cur = state.count === Infinity ? 'all' : String(state.count);
      body.innerHTML = `<p class="ig-sum">Нашлось <b>${all.length}</b> ${plural(all.length, 'публикация', 'публикации', 'публикаций')}
          ${reels ? `(из них ${reels} ${plural(reels, 'рилс', 'рилса', 'рилсов')})` : ''} — с ${fmt(all[all.length - 1].ts)} по ${fmt(all[0].ts)}</p>
        <div class="ig-row"><span>сколько последних загрузить</span>
          <div class="seg">${opts.map(([n, l]) => `<button data-ig="count" data-n="${n}" class="${String(n) === cur ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${reels ? `<div class="ig-row"><span>обложки рилсов<br><span class="ig-note">берём первый кадр видео</span></span><button class="switch${state.reels ? ' on' : ''}" data-ig="reels" role="switch" aria-checked="${state.reels}"></button></div>` : ''}
        <p class="ig-note">${sel.fresh.length ? `Загружу <b>${sel.fresh.length}</b> ${plural(sel.fresh.length, 'фото', 'фото', 'фото')} в «опубликованное»` : 'Всё выбранное уже есть в Кляссере'}${sel.dup ? ` · ${sel.dup} уже ${plural(sel.dup, 'есть', 'есть', 'есть')}, их пропущу` : ''}.
          Закреплённые в профиле посты в выгрузке не отмечены — закрепи их потом через меню поста.</p>
        <div class="ig-actions"><button class="btn-text" data-ig="back">${I.back}другая выгрузка</button><button class="btn" data-ig="go"${sel.fresh.length ? '' : ' disabled'}>импортировать</button></div>`;
    }
  }
  async function load(input){
    if (!state) state = {};
    if (state.src && state.src.close) state.src.close();
    render('busy', input.zip ? 'открываю ZIP…' : 'читаю папку…');
    try {
      let src;
      if (input.zip) src = await fromZip(input.zip);
      else if (input.dirEntry) src = fromFiles(await readDirEntry(input.dirEntry));
      else src = fromFiles(input.files);
      render('busy', 'ищу публикации…');
      const posts = await scan(src);
      state = { src, posts, count: posts.length <= 30 ? Infinity : 30, reels: true };
      render('found');
    } catch (e){ console.warn(e); render('error', e.message || 'не получилось прочитать выгрузку'); }
  }
  async function start(){
    if (UP.running) return toast('дождись, пока загрузятся фото');
    const sel = chooseSelection().fresh, src = state.src, acc = S.acc;
    modal.hidden = true;
    const added = []; let failed = 0;
    UP.running = true; UP.total = sel.length; UP.done = 0; UP.added = 0; renderUpload();
    for (const post of sel){
      if (S.acc !== acc) break;
      UP.name = `Instagram · ${fmt(post.ts)}`; upStep(0, 'достаю из выгрузки');
      try {
        let blob = await src.blob(post.path);
        const video = VID.test(post.path);
        if (video){ upStep(.05, 'беру кадр из рилса'); blob = await videoFrame(blob); }
        const ext = video ? 'jpg' : (post.path.split('.').pop() || 'jpg').toLowerCase();
        const file = new File([blob], `instagram-${iso(post.ts)}${post.kind === 'reel' ? '-reel' : ''}.${ext}`, { type: video ? 'image/jpeg' : (blob.type || mimeOf(post.path)) });
        const id = await uploadOne(file, acc, { quiet: true, ig: { uri: post.uris[0], ts: post.ts, kind: post.kind } });
        if (id) added.push(id); else failed++;
      } catch (e){ console.warn(e); failed++; }
      UP.done++; UP.frac = 0; renderUpload();
    }
    UP.running = false; UP.total = UP.done = 0; UP.name = UP.stage = ''; renderUpload();
    if (src.close) src.close(); state = null;
    if (S.acc === acc && added.length){
      mutate(() => {
        const L = S.layout, ts = id => ((S.photos.get(id) || {}).ig || {}).ts || 0;
        const manual = L.published.filter(id => !ts(id)); // отмеченные в Кляссере вручную — это самые свежие посты, они остаются сверху
        L.published = [...manual, ...[...L.published.filter(id => ts(id)), ...added].sort((a, b) => ts(b) - ts(a))];
      });
    }
    toast(added.length ? `из Instagram: +${added.length} в опубликованное${failed ? ` · ${failed} не получилось` : ''}` : 'ничего не импортировалось');
  }

  window.KlyasserImport = {
    open(input){ ensureModal(); modal.hidden = false; if (input) load(input); else { state = null; render('intro'); } },
    // для проверок: разобрать выгрузку без окна
    _scan: async input => scan(input.zip ? await fromZip(input.zip) : fromFiles(input.files)),
  };
})();
