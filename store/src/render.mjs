// Renders framed store screenshots (Play 1080x1920, App Store 6.9" 1320x2868) and the Play banner with headless Chrome.
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function render(html, hash, w, h, out) {
  const url = pathToFileURL(join(root, 'src', html)).href + hash;
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${out}`, '--virtual-time-budget=3000', url], { stdio: 'ignore' });
  console.log('saved', out);
}

const items = [
  ['1-home', 'Raqamli Hamyon', 'Pullaringizni raqamli nazorat qiling'],
  ['4-operation', 'Tez kiritish', 'Kalkulyator bilan bir zumda yozing'],
  ['2-history', 'Tarix', 'Har bir so‘m yozib boriladi'],
  ['3-reports', 'Hisobot', 'Xarajatlaringizni tahlil qiling'],
  ['5-glass', 'Super Glass', 'iPhone kabi shisha ko‘rinish'],
  ['6-settings', 'Sozlamalar', 'Parol, eksport, profillar, sinxron'],
];
items.forEach(([shot, eb, title], i) => {
  render('frame.html', '#' + encodeURIComponent(`${shot}|${eb}|${title}|1080|1920`), 1080, 1920, join(root, 'play', `screenshot-${i + 1}.png`));
  render('frame.html', '#' + encodeURIComponent(`${shot}|${eb}|${title}|1320|2868`), 1320, 2868, join(root, 'appstore', `screenshot-6.9in-${i + 1}.png`));
});
render('banner.html', '', 1024, 500, join(root, 'play', 'banner-1024x500.png'));
