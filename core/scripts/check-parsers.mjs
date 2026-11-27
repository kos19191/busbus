/**
 * Сетевой смоук-тест парсеров: тянет реальные ответы источников
 * и проверяет, что нормализация даёт осмысленные объекты.
 *
 * Запуск (нужен интернет, локально источники песочницы недоступны — используйте CI):
 *   node ./scripts/check-parsers.mjs            # только live-парсеры на фикстурах
 *   LIVE=1 node ./scripts/check-parsers.mjs     # плюс реальные сетевые запросы
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');

let failures = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}${extra ? ' — ' + extra : ''}`);
  }
};

console.log('\n== Новосибирск: listmarsh (фикстура) ==');
const listmarsh = JSON.parse(readFileSync(join(fixtures, 'nsk-listmarsh.json'), 'utf8'));
ok(Array.isArray(listmarsh) && listmarsh.length >= 3, 'есть группы типов транспорта', `groups=${listmarsh.length}`);
const allWays = listmarsh.flatMap((g) => g.ways ?? []);
ok(allWays.length > 300, 'маршрутов много', `ways=${allWays.length}`);
const bus13 = allWays.find((w) => (w.name === '13' || w.marsh === '13'));
ok(!!bus13, 'найден маршрут 13', JSON.stringify(bus13));
const types = [...new Set(listmarsh.map((g) => g.type))];
ok(types.includes(0), 'есть автобусы (type=0)', `types=${types.join(',')}`);

console.log('\n== Новосибирск: markers (фикстура) ==');
const markers = JSON.parse(readFileSync(join(fixtures, 'nsk-markers.json'), 'utf8'));
ok(Array.isArray(markers.markers) && markers.markers.length > 0, 'есть маркеры', `n=${markers.markers.length}`);
const m0 = markers.markers[0];
ok(typeof m0.lat === 'string' && Number(m0.lat) > 54 && Number(m0.lat) < 56, 'широта в пределах Нска', m0.lat);
ok(typeof m0.lng === 'string' && Number(m0.lng) > 82 && Number(m0.lng) < 84, 'долгота в пределах Нска', m0.lng);
ok(/А|Б|[A-Za-z]/.test(m0.title), 'есть номер маршрута', m0.title);
ok(/^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(m0.time_nav) || /^\d{4}-\d{2}-\d{2}/.test(m0.time_nav), 'формат времени распознан', m0.time_nav);

console.log('\n== Красноярск: getMarshData (фикстура) ==');
const krk = JSON.parse(readFileSync(join(fixtures, 'krsk-getmarsh.json'), 'utf8'));
ok(typeof krk.marsh_title === 'string' && krk.marsh_title.length > 0, 'есть номер маршрута', krk.marsh_title);
ok(krk.directions && krk.directions.A && krk.directions.B, 'есть оба направления');
const stopsA = (krk.ts_line?.A ?? []).filter((r) => r.obj === 'stop');
const tsA = (krk.ts_line?.A ?? []).filter((r) => r.obj === 'ts');
ok(stopsA.length > 10, 'остановок в направлении A достаточно', `n=${stopsA.length}`);
ok(stopsA.every((s) => typeof s.st_title === 'string' && s.st_title.length > 0), 'у остановок есть названия');
ok(tsA.length > 0, 'есть машины в линии', `n=${tsA.length}`);
ok(tsA.every((t) => /менее\s+\d+\s+метр|—|–/.test(t.ts_coment ?? '') || !t.ts_coment), 'формат «менее N метров»', JSON.stringify(tsA[0]));
const etaSample = stopsA.find((s) => /^\d{1,2}:\d{2}$/.test(s.st_arrive ?? ''));
ok(!!etaSample, 'есть прогнозы времени прибытия', etaSample?.st_arrive);
ok(/^\d{1,2}:\d{2}$/.test(krk.forecast ?? ''), 'есть серверное время', krk.forecast);

if (process.env.LIVE === '1') {
  console.log('\n== LIVE: сетевые запросы ==');
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'BusBus/1.0 (parser check)' } });
    return { status: res.status, text: await res.text() };
  };
  try {
    const r = await get('https://map.nskgortrans.ru/listmarsh.php?r');
    ok(r.status === 200 && r.text.trim().startsWith('['), 'NSK listmarsh отвечает JSON', `status=${r.status}, len=${r.text.length}`);
    const route = JSON.parse(r.text).flatMap((g) => g.ways ?? [])[0];
    const q = encodeURIComponent(`0-${route.marsh}-W-${route.name}`);
    const mk = await get(`https://map.nskgortrans.ru/markers.php?r=${q}`);
    const parsed = JSON.parse(mk.text);
    ok(mk.status === 200 && Array.isArray(parsed.markers), 'NSK markers отвечает JSON', `status=${mk.status}, markers=${parsed.markers?.length}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ NSK live: ${e.message}`);
  }
  try {
    const r = await get('https://mu-kgt.ru/informing/wap/marsh/?m=85&action=getMarshData');
    const data = JSON.parse(r.text);
    ok(r.status === 200 && data.marsh_title, 'KRK getMarshData отвечает JSON', `status=${r.status}, route=${data.marsh_title}`);
    ok(!!data.ts_line?.A?.length, 'KRK вернул остановки', `n=${data.ts_line?.A?.length}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ KRK live: ${e.message}`);
  }
}

console.log(failures ? `\nПРОВАЛЕНО проверок: ${failures}` : '\nВсе проверки парсеров пройдены');
process.exit(failures ? 1 : 0);
