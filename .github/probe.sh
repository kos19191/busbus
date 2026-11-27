#!/usr/bin/env bash
# Diagnostic probe for upstream transit APIs. Results are committed by the workflow.
set -u
say() { echo; echo "########## $* ##########"; }

say "HEADERS NSK"
curl -sS -m 30 -D - -o /dev/null "https://map.nskgortrans.ru/markers.php?r=1-8-W-8" || true

say "HEADERS KRK"
curl -sS -m 30 -D - -o /dev/null "https://mu-kgt.ru/informing/wap/marsh/?m=85&action=getMarshData" || true

say "HEADERS BUSTI"
curl -sS -m 30 -D - -o /dev/null "https://ru.busti.me/api/v1/datasources/" || true

say "HEADERS OSM TILE"
curl -sS -m 30 -D - -o /dev/null -A "BusBus/1.0 (probe)" "https://tile.openstreetmap.org/13/5982/2590.png" || true

say "KRK HTML"
curl -sS -m 60 "https://mu-kgt.ru/informing/" -o page.html || true
wc -c page.html || true
grep -oE '(src|href)="[^"]+"' page.html | sort -u | head -100 || true
grep -oE 'action=[A-Za-z_]+' page.html | sort -u | head -40 || true

say "KRK JS"
grep -oE 'src="[^"]+\.js[^"]*"' page.html | sed 's/src="//;s/"$//' | sort -u > jslist.txt || true
cat jslist.txt || true
while read -r f; do
  test -n "$f" || continue
  echo "=== $f"
  curl -sS -m 60 "https://mu-kgt.ru/$f" -o js.tmp || continue
  wc -c < js.tmp
  grep -oE 'action=[A-Za-z_]+' js.tmp | sort -u | head -40 || true
  grep -oE 'https?://[^"'"'"' ]+' js.tmp | sort -u | head -20 || true
done < jslist.txt

say "TOOLCHAIN"
java -version 2>&1 | head -3 || true
gradle -v 2>&1 | sed -n '1,12p' || true
ls "$ANDROID_HOME" 2>/dev/null || true
ls "$ANDROID_SDK_ROOT" 2>/dev/null || true
echo "--- build-tools:"; ls "$ANDROID_HOME/build-tools" 2>/dev/null || true
echo "--- platforms:"; ls "$ANDROID_HOME/platforms" 2>/dev/null || true
echo "--- cmdline-tools:"; ls "$ANDROID_HOME/cmdline-tools" 2>/dev/null || true
echo "--- node:"; node -v || true
python3 -c "import yaml, sys" 2>&1 || true

say "NSK MINIBUS"
curl -sS -m 30 "https://map.nskgortrans.ru/markers.php?r=8-29-W-29" | head -c 700 || true

say "NSK GRASP STOPS"
curl -sS -m 30 "https://map.nskgortrans.ru/components/com_planrasp/helpers/grasp.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB&typeview=stops" | head -c 1200 || true

say "NSK MOBILE BOARD"
curl -sS -m 30 "https://m.nskgortrans.ru/index.php?m=8&t=2&tt=1&s=0&r=A&p=1" | head -c 1200 || true

say "BUSTI DATASOURCES"
curl -sS -m 30 "https://ru.busti.me/api/v1/datasources/" | head -c 2000 || true

say "NSK PAGE SOURCES"
curl -sS -m 30 "https://map.nskgortrans.ru/" -o nsk.html || true
grep -oE '(src|href)="[^"]+"' nsk.html | sort -u | head -60 || true

say "NSK JS LOOKUP"
grep -oE 'src="[^"]+\.js[^"]*"' nsk.html | sed 's/src="//;s/"$//' | sort -u > nskjs.txt || true
cat nskjs.txt || true
while read -r f; do
  test -n "$f" || continue
  case "$f" in http*) u="$f";; *) u="https://map.nskgortrans.ru/$f";; esac
  echo "=== $u"
  curl -sS -m 60 "$u" -o js.tmp || continue
  wc -c < js.tmp
  grep -oE '[a-zA-Z_]+\.php' js.tmp | sort -u | head -40 || true
done < nskjs.txt

say "NSK FORECAST EXAMPLE"
for u in \
  "https://map.nskgortrans.ru/forecast.php?id=1&type=platform" \
  "https://map.nskgortrans.ru/forecast.php?id=1&type=stop" \
  "https://map.nskgortrans.ru/forecast.php?id=99999&type=platform" ; do
  echo "=== $u"
  curl -sS -m 30 -w " [%{http_code}]" "$u" | head -c 600 || true
  echo
done
say "NSK TRASSES EXAMPLE"
curl -sS -m 30 -w " [%{http_code}]" "https://map.nskgortrans.ru/trasses.php?r=0-13-W-13" | head -c 800 || true
echo
say "NSK SEARCH CALCULATE"
for u in \
  "https://map.nskgortrans.ru/calculate.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB" \
  "https://map.nskgortrans.ru/calculate.php?from=55.03,82.92&to=55.01,82.95" ; do
  echo "=== $u"
  curl -sS -m 30 -w " [%{http_code}]" "$u" | head -c 500 || true
  echo
done
say "NSK MAIN JS"
curl -sS -m 30 "https://map.nskgortrans.ru/js/main.1.3.min.js?_136" -o main.js || true
cat main.js | head -c 4400 || true
echo
say "NSK MYQUERY JS"
curl -sS -m 30 "https://map.nskgortrans.ru/js/myjquery.js?_11" -o myjq.js || true
cat myjq.js | head -c 3600 || true
echo
say "NSK CONFIG JS"
curl -sS -m 30 "https://map.nskgortrans.ru/js/config.js?_3" || true
echo
say "NSK FORECAST PROBES"
for u in \
  "https://map.nskgortrans.ru/forecast.php?stop=1" \
  "https://map.nskgortrans.ru/forecast.php?q=1" \
  "https://map.nskgortrans.ru/forecast.php" \
  "https://map.nskgortrans.ru/calculate.php" ; do
  echo "=== $u"
  curl -sS -m 30 -w " [%{http_code}]" "$u" | head -c 400 || true
  echo
done
say "NSK LIB JS grep"
curl -sS -m 30 "https://map.nskgortrans.ru/js/lib.js?_34" -o lib.js || true
grep -oE '.{80}forecast.php.{120}' lib.js | head -5 || true
grep -oE '.{60}calculate.php.{120}' lib.js | head -3 || true
grep -oE '.{40}(stop|stops)[A-Za-z_]*\s*[:=].{60}' lib.js | head -10 || true

say "NSK GRASP VARIANTS"
for u in \
  "https://map.nskgortrans.ru/components/com_planrasp/helpers/grasp.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB" \
  "https://map.nskgortrans.ru/components/com_planrasp/helpers/grasp.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB&typeview=stops&t=1" \
  "https://map.nskgortrans.ru/grasp.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB&typeview=stops" \
  "https://map.nskgortrans.ru/stops.php?q=%D0%92%D0%BE%D0%BA%D0%B7%D0%B0%D0%BB" \
  "https://map.nskgortrans.ru/stops.php" ; do
  echo "=== $u"
  curl -sS -m 30 -w " [%{http_code}]" "$u" | head -c 500 || true
  echo
done

say "NSK STOP BOARD VARIANTS"
curl -sS -m 30 "https://m.nskgortrans.ru/" -o m.html || true
grep -oE 'href="[^"]+"' m.html | sort -u | head -40 || true

say "OVERPASS"
curl -sS -m 120 -G "https://overpass-api.de/api/interpreter" --data-urlencode 'data=[out:json][timeout:60];node(55.0,82.9,55.02,82.93)[public_transport=platform];out 3;' | head -c 900 || true

say "PROXY CODETABS"
curl -sS -m 40 -D - "https://api.codetabs.com/v1/proxy?quest=https://map.nskgortrans.ru/markers.php%3Fr%3D1-8-W-8" | head -c 900 || true

say "PROXY ALLORIGINS"
curl -sS -m 40 -D - "https://api.allorigins.win/raw?url=https%3A%2F%2Fmap.nskgortrans.ru%2Fmarkers.php%3Fr%3D1-8-W-8" | head -c 900 || true

say "NSK STOPS V2"
# 1) listmarsh: реальные id маршрутов (нужны для trasses/forecast)
echo "--- listmarsh sample"
curl -sS -m 30 "https://map.nskgortrans.ru/listmarsh.php?r" -o lm.json || true
wc -c lm.json || true
head -c 1200 lm.json || true
python3 - <<'PY' || true
import json
try:
    d = json.load(open('lm.json'))
except Exception as e:
    print('parse fail', e); raise SystemExit
for g in d[:4]:
    print('type=', g.get('type'), 'ways=', len(g.get('ways') or []))
    for w in (g.get('ways') or [])[:4]:
        print('   ', w)
PY
# 2) строим r= по первой автобусной группе и пробуем trasses + forecast
python3 - <<'PY' || true
import json, urllib.parse, subprocess
try:
    d = json.load(open('lm.json'))
except Exception:
    raise SystemExit
bus = next((g for g in d if g.get('type') in ('0', 0)), None)
if not bus:
    raise SystemExit('no bus group')
w = (bus.get('ways') or [])[0]
r = f"0-{w['marsh']}-W-{w['name']}"
print('R =', r)
q = urllib.parse.quote(r)
for path in ('trasses.php', 'forecast.php'):
    url = f"https://map.nskgortrans.ru/{path}?r={q}" if path == 'trasses.php' else f"https://map.nskgortrans.ru/{path}?id={urllib.parse.quote(w['stopb'])}&type=platform"
    print('===', url)
    out = subprocess.run(['curl', '-sS', '-m', '40', url], capture_output=True, text=True).stdout
    print(out[:1500])
PY
# 3) WAP-табло: пробуем реальные параметры с главной m.nskgortrans.ru
echo "--- WAP index links"
curl -sS -m 30 "https://m.nskgortrans.ru/index.php?t=2" -o wap.html || true
wc -c wap.html || true
python3 - <<'PY' || true
import re
html = open('wap.html', encoding='utf-8', errors='replace').read()
for m in re.findall(r'href="([^"]*index\.php[^"]*)"', html)[:25]:
    print(m)
PY

say "NSK PREFIX MATRIX"
for r in "1-3-W-3" "0-3-W-3" "1-13-W-13" "1-8-W-8" "2-8-W-8" "3-13-W-13" "8-29-W-29"; do
  echo "=== markers r=$r"
  curl -sS -m 30 "https://map.nskgortrans.ru/markers.php?r=$r" | head -c 700 || true
  echo
  echo "=== trasses r=$r"
  curl -sS -m 30 "https://map.nskgortrans.ru/trasses.php?r=$r" | head -c 700 || true
  echo
done

say "NSK WAP DEEP"
curl -sS -m 30 "https://m.nskgortrans.ru/index.php?t=2" -o wap2.html || true
python3 - <<'PY' || true
import re
html = open('wap2.html', 'rb').read().decode('cp1251', errors='replace')
print('LEN', len(html))
links = sorted(set(re.findall(r'href="([^"]+)"', html)))
print('LINKS', links[:40])
sel = re.findall(r'<select[^>]*name="([^"]+)"[\s\S]{0,400}?</select>', html)
print('SELECTS', sel)
opts = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]{0,40})', html)
print('OPTS', len(opts), opts[:15])
print('FORMS', re.findall(r'<form[^>]*>', html)[:6])
print('---TEXT---')
text = re.sub(r'<[^>]+>', ' ', html)
print(re.sub(r'\s+', ' ', text)[:1200])
PY

say "NSK WAP BOARD REAL"
for u in \
  "https://m.nskgortrans.ru/index.php?m=13&tt=1&s=2133&r=A&p=1" \
  "https://m.nskgortrans.ru/index.php?m=13&tt=1&s=2133" \
  "https://m.nskgortrans.ru/index.php?m=13&tt=1" ; do
  echo "=== $u"
  curl -sS -m 30 "$u" -o wb.html || continue
  wc -c wb.html
  file -bi wb.html || true
  python3 - <<'PY' || true
import re, html
raw = open('wb.html','rb').read()
for enc in ('utf-8','cp1251'):
    try:
        txt = raw.decode(enc)
        break
    except Exception:
        txt = None
if txt is None:
    print('decode fail'); raise SystemExit
plain = re.sub(r'<script[\s\S]*?</script>', ' ', txt)
plain = re.sub(r'<[^>]+>', '|', plain)
plain = html.unescape(re.sub(r'\|+', '|', plain))
print(re.sub(r'\s+', ' ', plain)[:1200])
print('--- HREFS', sorted(set(re.findall(r'href="([^"]+)"', txt)))[:15])
print('--- ROWS')
for tr in re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', txt)[:10]:
    cells = [html.unescape(re.sub(r'<[^>]+>',' ',c)).strip() for c in re.findall(r'<td[^>]*>([\s\S]*?)</td>', tr)]
    print(cells)
PY
done

say "NSK WAP STOP SEARCH"
for u in \
  "https://m.nskgortrans.ru/index.php?t=3" \
  "https://m.nskgortrans.ru/index.php?t=1" ; do
  echo "=== $u"
  curl -sS -m 30 "$u" -o wq.html || continue
  python3 - <<'PY' || true
import re, html
raw = open('wq.html','rb').read()
txt = raw.decode('utf-8', errors='replace')
plain = re.sub(r'<[^>]+>', ' ', txt)
print(re.sub(r'\s+', ' ', html.unescape(plain))[:900])
print('--- FORMS', re.findall(r'<form[^>]*>', txt)[:4])
print('--- SELECTS/OPTS', re.findall(r'<select[^>]*>', txt)[:4], re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]{0,25})', txt)[:12])
PY
done

say "NSK TRASSES FULL"
curl -sS -m 40 "https://map.nskgortrans.ru/trasses.php?r=1-13-W-13" -o t13.json || true
ls -l t13.json || true
python3 - <<'PY' || true
import json
d = json.load(open('t13.json', encoding='utf-8', errors='replace'))
r = d['trasses'][0]['r']
print('branches', len(r))
for br in r:
    u = br.get('u') or []
    stops = [p for p in u if p.get('id')]
    print(' marsh', br.get('marsh'), 'points', len(u), 'stops', len(stops))
    for p in stops[:8]:
        print('   ', p.get('id'), p.get('len'), repr(p.get('n'))[:70])
    print('   keys of point:', sorted({k for p in u for k in p}))
PY
echo "--- raw head"
head -c 300 t13.json | xxd | head -6 || true

say "NSK ENCODING VARIANTS"
for hdr in "" "-H Accept-Charset:utf-8" "-H Accept-Charset:windows-1251"; do
  echo "=== headers: $hdr"
  curl -sS -m 30 $hdr "https://map.nskgortrans.ru/listmarsh.php?r" -o lm2.json || true
  head -c 220 lm2.json | xxd | head -3 || true
  python3 - <<'PY' || true
import json
try:
    d = json.load(open('lm2.json', encoding='utf-8', errors='replace'))
    print('  stopb raw:', repr(d[0]['ways'][0]['stopb'])[:80])
    nm = d[0]['ways'][0]['stopb']
    try:
        fixed = nm.encode('cp1251', errors='strict').decode('utf-8')
        print('  cp1251->utf8 OK:', fixed)
    except Exception as e:
        print('  cp1251->utf8 fail:', e)
except Exception as e:
    print('  parse fail', e)
PY
done

say "NSK WAP CELLS"
curl -sS -m 30 "https://m.nskgortrans.ru/index.php?m=13&tt=1&s=2133&r=A&p=1" -o wb2.html || true
head -c 240 wb2.html | xxd | head -4 || true
python3 - <<'PY' || true
import re, html
raw = open('wb2.html','rb').read()
for enc in ('utf-8','cp1251'):
    try:
        txt = raw.decode(enc); print('decoded as', enc); break
    except Exception:
        txt = None
if txt:
    cells = [html.unescape(re.sub(r'<[^>]+>','',c)).strip() for c in re.findall(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', txt)]
    print('cells', len(cells), cells[:40])
    print('tables', len(re.findall(r'<table', txt)), 'links', sorted(set(re.findall(r'href=\"([^\"]+)\"', txt)))[:10])
PY

say "NSK WAP DUMP"
curl -sS -m 30 "https://m.nskgortrans.ru/index.php?m=13&tt=1&s=2133&r=A&p=1" -o wb3.html || true
wc -c wb3.html
# печатаем сырые байты; на панели тут видна настоящая кодировка
cat -v wb3.html | head -c 4000 || true
echo
echo "--- structure"
grep -oE '<(table|tr|td|div|span|b|a)[^>]*>' wb3.html | head -30 || true
echo "--- plain text via sed"
sed -e 's/<[^>]*>/ /g' wb3.html | tr -s ' ' | head -c 2000 || true

say "NSK FOREACH STOP"
python3 - <<'PY' || true
import json, subprocess, urllib.parse
d = json.load(open('t13.json', encoding='utf-8', errors='replace'))
u = d['trasses'][0]['r'][0]['u']
stops = [p for p in u if p.get('id')][:3]
print('stop ids:', [(p['id'], p['n']) for p in stops])
for p in stops:
    url = f"https://m.nskgortrans.ru/index.php?m=13&tt=1&s={p['id']}&r=A&p=1"
    out = subprocess.run(['curl','-sS','-m','30',url], capture_output=True).stdout
    print('=== stop', p['id'], p['n'], 'bytes', len(out))
    txt = out.decode('utf-8', errors='replace')
    import re
    cells = [re.sub(r'<[^>]+>','',c).strip() for c in re.findall(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', txt)]
    print('cells', cells[:30])
    if not cells:
        print('RAWHEAD', txt[:600].replace('\n',' '))
PY

say "DONE"
