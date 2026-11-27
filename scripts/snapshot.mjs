/**
 * Снимает снапшот живых данных и кладёт его в data/live/<город>.json.
 *
 * Зачем: официальные порталы (ЦУГАЭТ, Красноярскгортранс) не отдают
 * CORS-заголовки, поэтому веб-версия на GitHub Pages не может обращаться к ним
 * напрямую. Снапшот делает GitHub Actions и публикует в ветке `ci/live`,
 * откуда браузер читает JSON по обычному HTTPS (raw.githubusercontent.com
 * отдаёт `access-control-allow-origin: *`). В APK мост работает без этого.
 *
 * Запуск: node scripts/snapshot.mjs   (в CI, каждые 10 минут)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// esbuild уже стоит в web/ (зависимость vite) — берём его оттуда, чтобы не плодить пакеты
const requireWeb = createRequire(path.join(root, 'web', 'package.json'));
const { build } = requireWeb('esbuild');
const entry = path.join(root, 'scripts', '.snapshot-entry.ts');
const bundle = path.join(root, 'scripts', '.snapshot-bundle.mjs');
const outDir = path.join(root, 'data', 'live');

writeFileSync(
  entry,
  `export { createLiveProvider } from '../core/src/transport/index';
`,
);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundle,
  logLevel: 'silent',
});


mkdirSync(outDir, { recursive: true });

/** Сколько машин и остановок кладём в снапшот (чтобы файл оставался лёгким). */
const MAX_VEHICLES = 900;
const MAX_BOARDS = 160;

/**
 * createProvider в браузерной сборке отдаёт снапшот, но здесь node — прямой
 * источник. Поэтому создаём провайдеры вручную.
 */
async function liveProvider(city) {
  const mod = await import('file://' + bundle);
  return mod.createLiveProvider(city);
}

async function snapshot(city) {
  const provider = await liveProvider(city);
  const routes = await provider.routes();
  const vehicles = [];
  const stopMap = new Map();

  // Машины собираем пачками по несколько маршрутов — источник это позволяет.
  const batch = city === 'nsk' ? 12 : 4;
  for (let i = 0; i < routes.length; i += batch) {
    const chunk = routes.slice(i, i + batch);
    try {
      if (city === 'nsk' && provider.vehiclesMany) {
        vehicles.push(...(await provider.vehiclesMany(chunk)));
      } else {
        for (const route of chunk) {
          try {
            vehicles.push(...(await provider.vehicles(route)));
          } catch {
            /* маршрут мог не отдать данные */
          }
        }
      }
    } catch {
      /* пачка не удалась — идём дальше */
    }
    if (vehicles.length >= MAX_VEHICLES) break;
  }

  // Остановки: из трасс (NSK) или из ответа по маршруту (КРСК).
  try {
    const stops = (await provider.stops?.()) ?? [];
    for (const stop of stops) stopMap.set(stop.id, stop);
  } catch {
    /* без остановок снапшот тоже полезен */
  }

  const boards = {};
  if (provider.stopBoard) {
    let taken = 0;
    for (const stop of stopMap.values()) {
      if (taken >= MAX_BOARDS) break;
      try {
        const board = await provider.stopBoard(stop);
        if (board.entries.length) boards[stop.id] = board;
        taken++;
      } catch {
        /* отдельная остановка могла не ответить */
      }
    }
  }

  return {
    city,
    at: Date.now(),
    source: provider.label,
    routes,
    vehicles: vehicles.slice(0, MAX_VEHICLES),
    stops: [...stopMap.values()],
    boards,
  };
}

const result = { at: Date.now(), cities: {} };
for (const city of ['nsk', 'krsk']) {
  try {
    const data = await snapshot(city);
    result.cities[city] = data;
    console.log(
      `${city}: маршрутов ${data.routes.length}, машин ${data.vehicles.length}, ` +
        `остановок ${data.stops.length}, табло ${Object.keys(data.boards).length}`,
    );
  } catch (e) {
    console.log(`${city}: снапшот не удался (${e.message})`);
  }
}

writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(result));
console.log('Записано', path.join(outDir, 'snapshot.json'));

rmSync(entry, { force: true });
rmSync(bundle, { force: true });
