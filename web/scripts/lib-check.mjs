#!/usr/bin/env node
/**
 * Проверка живых источников из node (без браузера): маршруты, машины,
 * геометрия/остановки и табло. Запускается в CI (ui-check) и локально.
 *
 * Используется собранный код core? Нет — модули ESM на TS, поэтому
 * собираем временный бандл через esbuild из зависимостей vite.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = path.join(root, 'web', 'scripts', '.lib-entry.ts');
const outfile = path.join(root, 'web', 'scripts', '.lib-bundle.mjs');

fs.writeFileSync(
  entry,
  `import { createProvider } from '../../core/src/transport/index.ts';
export { createProvider };
`,
);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'silent',
  alias: {},
});

const { createProvider } = await import('file://' + outfile);

const only = process.argv[2] || 'nsk';
const results = [];
function log(ok, msg) {
  results.push({ ok, msg });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
}

for (const city of only === 'all' ? ['nsk', 'krsk'] : [only]) {
  const p = createProvider(city, 'live');
  try {
    const routes = await p.routes();
    log(routes.length > 0, `${city}: маршрутов ${routes.length}`);
    const route = routes.find((r) => r.number === (city === 'nsk' ? '13' : '85')) ?? routes[0];
    log(!!route, `${city}: выбран ${route?.kind} ${route?.number}`);

    const vehicles = await p.vehicles(route);
    log(vehicles.length > 0, `${city}: машин ${vehicles.length}`);
    if (vehicles[0]) {
      const v = vehicles[0];
      log(
        Number.isFinite(v.lat) && Number.isFinite(v.lon) && Math.abs(v.lat - 55) < 1.5,
        `${city}: координаты ${v.lat.toFixed(5)},${v.lon.toFixed(5)}`,
      );
    }

    if (p.trace && city === 'nsk') {
      const trace = await p.trace(route);
      log(trace.points.length > 10, `${city}: точек линии ${trace.points.length}`);
      log(trace.stops.length > 10, `${city}: остановок ${trace.stops.length}`);
      const stop = trace.stops[Math.floor(trace.stops.length / 2)];
      const board = await p.stopBoard(stop);
      log(board.entries.length > 0, `${city}: табло «${stop.name}» — ${board.entries.length} строк`);
      if (board.entries[0]) console.log('     ', JSON.stringify(board.entries[0]));
    }

    if (city === 'krsk') {
      const raw = await p.fetchRaw(route);
      log(raw.vehicles.length > 0, `${city}: машин в ответе ${raw.vehicles.length}`);
    }
  } catch (e) {
    log(false, `${city}: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}

fs.rmSync(entry, { force: true });
fs.rmSync(outfile, { force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
