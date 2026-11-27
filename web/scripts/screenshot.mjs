/**
 * Скриншоты интерфейса для CI: мобильный и десктопный экраны + проверка ошибок в консоли.
 * Запускается после `vite preview` (http://127.0.0.1:4173).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.SHOT_URL || 'http://127.0.0.1:4173/';
const OUT = join(process.cwd(), '..', 'ci', 'shots');
mkdirSync(OUT, { recursive: true });

import { existsSync } from 'node:fs';
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Chrome не найден. Проверьте CHROME_PATH.');
  process.exit(1);
}

const scenarios = [
  {
    name: 'mobile-map',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    steps: async (page) => {
      await page.waitForSelector('.vehicle-marker', { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
    },
  },
  {
    name: 'mobile-route',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    steps: async (page) => {
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabbar__btn')];
        if (tabs[1]) tabs[1].click();
      });
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.route-tile')];
        if (tiles[0]) tiles[0].click();
      });
      await new Promise((r) => setTimeout(r, 1600));
    },
  },
  {
    name: 'mobile-stops',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    steps: async (page) => {
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabbar__btn')];
        if (tabs[2]) tabs[2].click();
      });
      await new Promise((r) => setTimeout(r, 500));
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.stop-row, .row')];
        rows.find((el) => !el.classList.contains('sheet__head'))?.click();
      });
      await new Promise((r) => setTimeout(r, 1200));
    },
  },
  {
    name: 'mobile-settings',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    steps: async (page) => {
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabbar__btn')];
        if (tabs[3]) tabs[3].click();
      });
      await new Promise((r) => setTimeout(r, 500));
    },
  },
  {
    name: 'desktop-map',
    viewport: { width: 1280, height: 820, deviceScaleFactor: 1 },
    steps: async (page) => {
      await page.waitForSelector('.vehicle-marker', { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
    },
  },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const report = [];
for (const sc of scenarios) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.setViewport(sc.viewport);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 900));
  try {
    await sc.steps(page);
  } catch (e) {
    logs.push(`[steps] ${e.message}`);
  }
  const file = join(OUT, `${sc.name}.png`);
  await page.screenshot({ path: file });
  const title = await page.title();
  const markers = await page.evaluate(() => document.querySelectorAll('.vehicle-marker').length);
  const tabs = await page.evaluate(() => document.querySelectorAll('.tabbar__btn').length);
  report.push({ name: sc.name, title, markers, tabs, logs });
  await page.close();
}
await browser.close();

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><title>BusBus UI</title>
<body style="font-family:system-ui;background:#0e1116;color:#eef2f7;padding:20px">
<h1>BusBus — скриншоты интерфейса</h1>
<p>Сгенерировано автоматически в CI.</p>
${report
  .map(
    (r) =>
      `<section style="margin:18px 0"><h2>${r.name}</h2>` +
      `<p>маркеров: ${r.markers}, вкладок: ${r.tabs}, ошибок: ${r.logs.length}</p>` +
      `<img src="./${r.name}.png" style="max-width:${r.name.startsWith('desktop') ? '100%' : '390px'};border-radius:14px;border:1px solid #333">` +
      (r.logs.length ? `<pre style="white-space:pre-wrap;color:#fca5a5">${r.logs.join('\n').replace(/</g, '&lt;')}</pre>` : '') +
      `</section>`,
  )
  .join('\n')}
</body>`;
writeFileSync(join(OUT, 'index.html'), html, 'utf8');
console.log(JSON.stringify(report, null, 2));
