#!/usr/bin/env node
// Снимает скриншоты для README: поднимает server.js с временной пустой базой,
// открывает Кляссер в безголовом Chrome, заполняет демо-аккаунт нарисованными «снимками»
// и сохраняет кадры в docs/screenshots, баннер — в docs/banner.jpg.
//
//   node docs/tools/shoot.mjs
//
// Нужны Node 22+ и Google Chrome (путь можно задать через CHROME=...).
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, launchChrome, waitHttp, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const scenes = readFileSync(join(here, 'scenes.js'), 'utf8');

const FEED = [['sunset', 0], ['sea', 0], ['forest', 0], ['flowers', 0], ['interior', 0], ['night', 0], ['portrait', 0], ['mountains', 0],
  ['coffee', 0], ['arches', 0], ['lavender', 0], ['desert', 0], ['lemons', 0], ['snow', 0], ['portrait', 1], ['sunset', 1],
  ['sea', 1], ['interior', 1], ['forest', 1], ['portrait', 2], ['coffee', 1]];
const BUFFER = [['flowers', 1], ['mountains', 1], ['night', 1], ['desert', 1], ['lemons', 1]];

const server = startServer(root, 4180);
const chrome = await launchChrome(9341);
const page = chrome.page;
const step = async (name, fn) => { process.stdout.write(`· ${name}… `); await fn(); console.log('ok'); };

try {
  await waitHttp(server.url + '/api/accounts');
  await page.viewport(1440, 900, 2);
  // без анимаций — кадры получаются ровными
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  await step('демо-аккаунт', async () => {
    await page.goto(server.url + '/');
    await page.evaluate(`fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'anna.film', pin: '2580' }) }).then(r => r.status)`);
    await page.reload();
    await page.waitFor(`window.__kl && __kl.S.acc && document.querySelector('#gate').hidden`);
    await page.evaluate(`document.head.insertAdjacentHTML('beforeend', '<style>.toast{display:none!important}</style>')`);
    await page.evaluate(scenes);
  });

  await step('фото в ленту', async () => {
    await page.evaluate(`klyasserScenes(${JSON.stringify(FEED)}).then(f => __kl.addFiles(f))`);
    await page.evaluate(`document.querySelector('#allToFeed').click()`);
    await page.evaluate(`(() => {
      const L = __kl.S.layout;
      for (let i = 0; i < 5; i++) __kl.doAction('publish', L.plan[L.plan.length - 1].id);
      __kl.doAction('pin', __kl.S.layout.published[2]);
      for (const p of [...__kl.S.photos.values()]) if (p.name.startsWith('portrait')) setAttr(p.id, 'person', p.name === 'portrait-3.jpg' ? 'me' : 'selfie');
      __kl.doAction('lock', __kl.S.layout.plan[1].id);
      __kl.doAction('lock', __kl.S.layout.plan[6].id);
    })()`);
    await page.evaluate(`klyasserScenes(${JSON.stringify(BUFFER)}, 11).then(f => __kl.addFiles(f))`);
    await page.evaluate(`document.querySelector('#feedScroll').scrollTop = 0; document.querySelector('#bufferBody').scrollTop = 0`);
    await sleep(800);
  });

  const pickPlan = name => `(__kl.S.layout.plan.find(e => __kl.S.photos.get(e.id).name === '${name}') || __kl.S.layout.plan[3]).id`;

  await step('01 главный экран', async () => {
    await page.evaluate(`select(${pickPlan('portrait-1.jpg')})`);
    await sleep(500); await page.shot(join(out, '01-main.jpg'));
  });
  await step('02 настройки раскладки', async () => {
    await page.evaluate(`toggleSettings(true)`); await sleep(400);
    await page.shot(join(out, '02-settings.jpg'));
    await page.evaluate(`toggleSettings(false); select(null)`);
  });
  await step('03 меню по правому клику', async () => {
    await page.evaluate(`(() => {
      const id = ${pickPlan('sea-1.jpg')}, el = document.querySelector('.cell[data-id="' + id + '"]'), r = el.getBoundingClientRect();
      select(id); openMenu(id, r.left + r.width * .55, r.top + r.height * .35);
    })()`);
    await sleep(300); await page.shot(join(out, '03-menu.jpg'));
    await page.evaluate(`closeMenus(); select(null)`);
  });
  await step('04 обрезка', async () => {
    await page.evaluate(`openCrop(${pickPlan('sunset-1.jpg')}).then(() => { CROP.crop.zoom = 1.6; setCropCenter(.42, .5); document.querySelector('#cropZoom').value = 1.6; drawCropUI(); })`);
    await sleep(500); await page.shot(join(out, '04-crop.jpg'));
    await page.evaluate(`closeCrop()`);
  });
  await step('05 перетаскивание', async () => {
    const [sx, sy, tx, ty] = await page.evaluate(`(() => {
      const s = document.querySelector('#stamps .stamp-wrap img').getBoundingClientRect();
      const cells = [...document.querySelectorAll('.cell.z-plan')].filter(c => !c.querySelector('.lock-btn.on'));
      const t = cells[4].getBoundingClientRect();
      return [s.left + s.width / 2, s.top + s.height / 2, t.left + t.width / 2, t.top + t.height / 2];
    })()`);
    await page.mouse('mousePressed', sx, sy);
    for (let i = 1; i <= 12; i++){ await page.mouse('mouseMoved', sx + (tx - sx) * i / 12, sy + (ty - sy) * i / 12); await sleep(30); }
    await sleep(300); await page.shot(join(out, '05-drag.jpg'));
    await page.mouse('mouseReleased', tx, ty); await sleep(600);
  });
  await step('06 вход по PIN', async () => {
    await page.evaluate(`(async () => {
      const id = __kl.S.acc; await lockAccount(); showGate('pin', id);
      await new Promise(r => setTimeout(r, 150)); // экран сам ставит фокус в первую клетку — ждём и переставляем
      const ins = document.querySelectorAll('.pin-boxes input'); ins[0].value = '2'; ins[1].value = '5'; ins[2].focus();
    })()`);
    await sleep(300); await page.shot(join(out, '06-pin.jpg'));
  });
  await step('баннер', async () => {
    await page.viewport(1280, 640, 2);
    await page.goto(pathToFileURL(join(here, 'banner.html')).href);
    await page.waitFor('window.bannerReady === true');
    await sleep(300); await page.shot(join(root, 'docs', 'banner.jpg'), { quality: 92 });
  });
  console.log('готово:', out);
} finally {
  chrome.stop(); server.stop();
}
