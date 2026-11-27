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

say "DONE"
