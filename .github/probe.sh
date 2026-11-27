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

say "OVERPASS"
curl -sS -m 120 -G "https://overpass-api.de/api/interpreter" --data-urlencode 'data=[out:json][timeout:60];node(55.0,82.9,55.02,82.93)[public_transport=platform];out 3;' | head -c 900 || true

say "PROXY CODETABS"
curl -sS -m 40 -D - "https://api.codetabs.com/v1/proxy?quest=https://map.nskgortrans.ru/markers.php%3Fr%3D1-8-W-8" | head -c 900 || true

say "PROXY ALLORIGINS"
curl -sS -m 40 -D - "https://api.allorigins.win/raw?url=https%3A%2F%2Fmap.nskgortrans.ru%2Fmarkers.php%3Fr%3D1-8-W-8" | head -c 900 || true

say "DONE"
