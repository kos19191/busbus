/**
 * Скриншоты интерфейса для CI: мобильный и десктопный экраны + проверка ошибок в консоли.
 * Запускается после `vite preview` (http://127.0.0.1:4173).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
      // вкладка «Остановки» — список подгружается сам
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabbar__btn')];
        if (tabs[2]) tabs[2].click();
      });
      await page.waitForSelector('.sheet__body .row', { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1600));
    },
  },
  {
    name: 'mobile-board',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    steps: async (page) => {
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabbar__btn')];
        if (tabs[2]) tabs[2].click();
      });
      await page.waitForSelector('.sheet__body button.row', { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const opened = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.sheet__body button.row')][0];
        if (!row) return false;
        row.click();
        return true;
      });
      if (!opened) console.log('board: кнопка остановки не найдена');
      await new Promise((r) => setTimeout(r, 2500));
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

// живой режим: включаем до первой отрисовки, чтобы приложение стартовало с источником
const liveScenario = {
  name: process.env.SHOT_LIVE_NAME || 'mobile-live',
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  init: () => {
    const raw = localStorage.getItem('busbus.settings.v1');
    const base = raw ? JSON.parse(raw) : { city: 'nsk', theme: 'dark' };
    localStorage.setItem('busbus.settings.v1', JSON.stringify({ ...base, mode: 'live' }));
  },
  steps: async (page) => {
    await page.waitForSelector('.vehicle-marker', { timeout: 25000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  },
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const report = [];
for (const sc of [...scenarios, ...(process.env.SHOT_LIVE ? [liveScenario] : [])]) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) logs.push(`[http ${res.status()}] ${res.url().slice(0, 140)}`);
  });
  page.on('requestfailed', (req) => logs.push(`[failed] ${req.url().slice(0, 140)} ${req.failure()?.errorText ?? ''}`));
  await page.setViewport(sc.viewport);
  // локальный снапшот живых данных (CI кладёт его рядом), иначе берём URL из настроек
  if (process.env.BUSBUS_SNAPSHOT_LOCAL) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      try {
        if (req.url().includes('raw.githubusercontent.com') && req.url().endsWith('.json')) {
          const body = readFileSync(process.env.BUSBUS_SNAPSHOT_LOCAL, 'utf8');
          const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
          if (req.method() === 'OPTIONS') {
            await req.respond({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*' } });
          } else {
            await req.respond({ status: 200, headers, body });
          }
          return;
        }
        await req.continue();
      } catch (e) {
        logs.push(`[route] ${e.message}`);
      }
    });
  }
  if (sc.init) await page.evaluateOnNewDocument(sc.init);
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
