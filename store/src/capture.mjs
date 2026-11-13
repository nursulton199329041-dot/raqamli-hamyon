// Store screenshots at iPhone 6.9" size (440x956 @3x = 1320x2868) from the running web build, via Chrome DevTools Protocol.
// node capture.mjs <outDir> <email> <password>   (web app on http://localhost:8080, API on :5080)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [outDir, email, password] = process.argv.slice(2);
const APP = 'http://localhost:8080';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `hamyon-capture-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws; let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        ws.addEventListener('message', (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id); pending.delete(msg.id);
            if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
          }
        });
        return;
      }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('chrome did not start');
}

async function tap(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await sleep(250);
}
/** centre of the first visible element whose aria-label / text matches */
async function find(selector, text) {
  return evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const t = ${JSON.stringify(text ?? null)};
    const el = els.find((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      if (t === null) return true; const s = (e.getAttribute('aria-label') || e.innerText || '').trim(); return s === t || s.startsWith(t); });
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}
async function tapOn(selector, text) {
  const p = await find(selector, text);
  if (!p) throw new Error(`not found: ${selector} ${text ?? ''}`);
  await tap(p.x, p.y);
}
async function shot(name) {
  await sleep(1200);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Page.navigate', { url: APP }); await sleep(6000);

  // sign in (demo account of the local test server)
  await tapOn('input[type=email]'); await send('Input.insertText', { text: email });
  await tapOn('input[type=password]'); await send('Input.insertText', { text: password });
  await tapOn('[role=button]', 'Kirish'); await sleep(5000);

  // 1. home, period = year so the sections carry real totals
  await tapOn('[data-testid=period-button]'); await sleep(600);
  await tapOn('[role=button]', 'Yil'); await sleep(2500);
  await shot('1-home');

  // 2. history: step back to the latest month that has operations
  await tapOn('[data-testid=tab-history]'); await sleep(2500);
  for (let i = 0; i < 12 && (await evaluate(`document.body.innerText.includes('Hali operatsiya yo')`)); i++) {
    await tapOn('[data-testid=prev-period]'); await sleep(1800);
  }
  await shot('2-history');

  // 3. reports for the whole year
  await tapOn('[data-testid=tab-analytics]'); await sleep(3000);
  await tapOn('[data-testid=open-filters]'); await sleep(1200);
  await tapOn('[role=button]', 'Yil'); await sleep(800);
  await tapOn('[data-testid=close-filters]'); await sleep(3500);
  await shot('3-reports');

  // 4. calculator sheet: tap an income source tile on the home screen
  await tapOn('[data-testid=tab-index]'); await sleep(1500);
  await tapOn('div', 'Ish haqi'); await sleep(1800);
  await shot('4-operation');

  // 5. appearance: accent colours
  await send('Page.navigate', { url: `${APP}/settings` }); await sleep(4000);
  await tapOn('[role=button]', 'Mavzu'); await sleep(1500);
  await shot('5-appearance');
} catch (e) {
  console.error('capture failed:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
}
