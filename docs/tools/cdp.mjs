// Мини-клиент Chrome DevTools Protocol для скриптов в docs/tools.
// Без зависимостей: Node 22+ (встроенный WebSocket) и установленный Google Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitHttp(url, timeout = 20000){
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < timeout){
    try { const r = await fetch(url); if (r.ok) return r; last = 'HTTP ' + r.status; } catch (e){ last = (e.cause && (e.cause.code || e.cause.message)) || e.message; }
    await sleep(150);
  }
  throw new Error(`не дождался ${url} (${last})`);
}

// Локальный server.js с временной пустой базой — чтобы демо не смешивалось с настоящими данными.
export function startServer(root, port){
  const data = mkdtempSync(join(tmpdir(), 'klyasser-demo-'));
  const proc = spawn(process.execPath, [join(root, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', KLYASSER_DATA: data, KLYASSER_INVITE: '' },
    stdio: process.env.DEBUG ? 'inherit' : 'ignore',
  });
  proc.on('exit', code => { if (code) console.error(`server.js завершился с кодом ${code}`); });
  return { url: `http://127.0.0.1:${port}`, stop(){ proc.kill(); rmSync(data, { recursive: true, force: true }); } };
}

export async function launchChrome(port = 9341){
  const bin = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = mkdtempSync(join(tmpdir(), 'klyasser-chrome-'));
  const proc = spawn(bin, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++){
    try { target = (await (await waitHttp(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('Chrome не открыл страницу');
  const page = await connect(target.webSocketDebuggerUrl);
  return { page, stop(){ try { page.close(); } catch {} proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 800); } };
}

export function connect(url){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0; const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data), p = m.id && pending.get(m.id); if (!p) return;
      pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    };
    ws.onerror = reject;
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
      const evaluate = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result.value;
      };
      const waitFor = async (expr, timeout = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout){ try { if (await evaluate(expr)) return; } catch {} await sleep(120); }
        throw new Error('не дождался: ' + expr);
      };
      const goto = async url => {
        await send('Page.navigate', { url });
        await waitFor(`location.href !== 'about:blank' && document.readyState === 'complete'`);
        await evaluate('document.fonts.ready.then(() => true)');
      };
      const reload = async () => { await send('Page.reload'); await sleep(400); await waitFor(`document.readyState === 'complete'`); await evaluate('document.fonts.ready.then(() => true)'); };
      const viewport = (width, height, deviceScaleFactor = 2) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
      const shot = async (file, { format = 'jpeg', quality = 86 } = {}) => {
        const r = await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      };
      const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
      resolve({ send, evaluate, waitFor, goto, reload, viewport, shot, mouse, close: () => ws.close() });
    };
  });
}
