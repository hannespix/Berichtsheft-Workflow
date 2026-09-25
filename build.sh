#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  BUILD: All-in-One HTML aus modularen Quelldateien           ║
# ╠══════════════════════════════════════════════════════════════╣
# ║  Baut eine einzelne, offline-fähige HTML-Datei zusammen,     ║
# ║  die direkt auf dem Netzlaufwerk ohne Ordnerstruktur läuft.  ║
# ╚══════════════════════════════════════════════════════════════╝
#
# Verwendung:  ./build.sh
# Ausgabe:     dist/berichtsheftkontrolle.html

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DIST_DIR="dist"
OUTPUT="$DIST_DIR/berichtsheftkontrolle.html"

mkdir -p "$DIST_DIR"

echo "=== Berichtsheftkontrolle Build ==="
echo ""

# ── Sammle Dateien ──
CSS_FILE="src/css/styles.css"
LIBS=(
  "libs/sql-wasm.js"
  "libs/papaparse.min.js"
  "libs/xlsx.full.min.js"
  "libs/jspdf.umd.min.js"
  "libs/jspdf.plugin.autotable.min.js"
  "libs/pizzip.js"
  "libs/docxtemplater.js"
  "libs/FileSaver.min.js"
  "libs/chart.umd.min.js"
)
WASM_FILE="libs/sql-wasm.wasm"
FONT_FILES=(
  "fonts/BaWueSansWeb-Regular.woff2"
  "fonts/BaWueSansWeb-RegularItalic.woff2"
  "fonts/BaWueSansWeb-SemiBold.woff2"
  "fonts/BaWueSansWeb-Bold.woff2"
  "fonts/BaWueSerifWeb-Regular.woff2"
  "fonts/BaWueSerifWeb-Bold.woff2"
)
LOGO_FILES=(
  "assets/logo/rpf-logo.png"
  "assets/logo/rpf-logo-negativ.png"
)
APP_MODULES=(
  "src/js/app-core.js"
  "src/js/utils.js"
  "src/js/modules/views.js"
  "src/js/modules/stammdaten.js"
  "src/js/modules/import-handler.js"
  "src/js/modules/planung.js"
  "src/js/modules/nacherfassung.js"
  "src/js/modules/pdf-export.js"
  "src/js/modules/kontrolle.js"
  "src/js/modules/kw-nav.js"
  "src/js/modules/undo-manager.js"
  "src/js/modules/global-search.js"
  "src/js/modules/keyboard-shortcuts.js"
  "src/js/modules/bulk-schueler.js"
  "src/js/modules/bulk-wv.js"
  "src/js/modules/workflows.js"
  "src/js/modules/wiedervorlagen.js"
  "src/js/modules/berichte.js"
  "src/js/modules/table-sort.js"
  "src/js/modules/phasen.js"
  "src/js/modules/schueler-view.js"
  "src/js/modules/schueler-akte.js"
  "src/js/modules/azubi-seite.js"
  "src/js/modules/db-tools.js"
  "src/js/modules/konsole.js"
)

# Prüfe ob alle Dateien existieren
MISSING=0
for f in "$CSS_FILE" "${LIBS[@]}" "$WASM_FILE" "${FONT_FILES[@]}" "${LOGO_FILES[@]}" "${APP_MODULES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  FEHLT: $f"
    MISSING=1
  fi
done
if [ $MISSING -eq 1 ]; then
  echo "Abbruch: Fehlende Dateien!"
  exit 1
fi

# ── Build starten ──
echo "  Libraries:  ${#LIBS[@]} Dateien"
echo "  App-Module: ${#APP_MODULES[@]} Dateien"
echo "  WASM:       $(du -h "$WASM_FILE" | cut -f1)"
echo "  PDF-Worker: $(du -h | cut -f1)"
echo ""

{
  # ── HTML Head ──
  cat <<'HTMLHEAD'
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src data:; connect-src blob:">
<title>Berichtsheftkontrolle – Ausbildungsberater Gärtner</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2212%22%20fill=%22#FFFC00%22/%3E%3Crect%20x=%2214%22%20y=%2212%22%20width=%2236%22%20height=%2240%22%20rx=%224%22%20fill=%22none%22%20stroke=%22#2A2623%22%20stroke-width=%224%22/%3E%3Cpath%20d=%22M22%2024h20M22%2032h12%22%20stroke=%22#2A2623%22%20stroke-width=%224%22%20stroke-linecap=%22round%22/%3E%3Cpath%20d=%22M24%2044l7%207%2014-16%22%20fill=%22none%22%20stroke=%22#2A2623%22%20stroke-width=%225%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22/%3E%3C/svg%3E">
<!-- ═══ EMBEDDED LIBRARIES (offline-fähig) ═══ -->
HTMLHEAD

  # ── Embed Libraries ──
  for lib in "${LIBS[@]}"; do
    LIBNAME=$(basename "$lib")
    echo "<script>/* $LIBNAME */"
    cat "$lib"
    echo ""
    echo "</script>"
  done

  # ── Embed WASM Binary (base64) ──
  echo "<script>"
  echo -n 'window.__SQL_WASM_BINARY = Uint8Array.from(atob("'
  base64 -w0 "$WASM_FILE"
  echo '"), c => c.charCodeAt(0));'
  echo "</script>"

  # ── Library Init ──
  cat <<'INITSCRIPT'
<script>
  // Fix blurry charts on Windows DPI scaling (125%, 150%, etc.)
  if (typeof Chart !== 'undefined') {
    Chart.defaults.devicePixelRatio = Math.max(window.devicePixelRatio || 1, 2);
    Chart.defaults.font.family = "'DM Sans', sans-serif";
  }
</script>
INITSCRIPT


  # ── Fonts (base64-eingebettet) – BaWue Sans/Serif, Landes-CI ──
  B64_SANS_R=$(base64 -w0 "fonts/BaWueSansWeb-Regular.woff2")
  B64_SANS_I=$(base64 -w0 "fonts/BaWueSansWeb-RegularItalic.woff2")
  B64_SANS_SB=$(base64 -w0 "fonts/BaWueSansWeb-SemiBold.woff2")
  B64_SANS_B=$(base64 -w0 "fonts/BaWueSansWeb-Bold.woff2")
  B64_SERIF_R=$(base64 -w0 "fonts/BaWueSerifWeb-Regular.woff2")
  B64_SERIF_B=$(base64 -w0 "fonts/BaWueSerifWeb-Bold.woff2")
  cat <<FONTS
<style>
@font-face { font-family: 'BaWue Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('data:font/woff2;base64,${B64_SANS_R}') format('woff2'); }
@font-face { font-family: 'BaWue Sans'; font-style: italic; font-weight: 400; font-display: swap; src: url('data:font/woff2;base64,${B64_SANS_I}') format('woff2'); }
@font-face { font-family: 'BaWue Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('data:font/woff2;base64,${B64_SANS_SB}') format('woff2'); }
@font-face { font-family: 'BaWue Sans'; font-style: normal; font-weight: 700; font-display: swap; src: url('data:font/woff2;base64,${B64_SANS_B}') format('woff2'); }
@font-face { font-family: 'BaWue Serif'; font-style: normal; font-weight: 400; font-display: swap; src: url('data:font/woff2;base64,${B64_SERIF_R}') format('woff2'); }
@font-face { font-family: 'BaWue Serif'; font-style: normal; font-weight: 700; font-display: swap; src: url('data:font/woff2;base64,${B64_SERIF_B}') format('woff2'); }
</style>
FONTS

  # ── Embed CSS ──
  echo "<style>"
  cat "$CSS_FILE"
  echo "</style>"
  echo "</head>"

  # ── Body (from index.html, lines between <body> and the script tags) ──
  # Extract the HTML body content from index.html
  # Logo-Bilder (RPF-Logo, siehe assets/logo/LIZENZ.md) als Data-URI einbetten
  # (Base64 als Datei an awk übergeben – als Kommandozeilen-Argument wäre es zu lang)
  base64 -w0 "assets/logo/rpf-logo.png" > "$OUTPUT.logo-pos.b64"
  base64 -w0 "assets/logo/rpf-logo-negativ.png" > "$OUTPUT.logo-neg.b64"
  sed -n '/<body>/,/<!-- ═══ APPLICATION MODULES ═══ -->/{ /<!-- ═══ APPLICATION MODULES/d; p }' index.html \
    | awk -v posf="$OUTPUT.logo-pos.b64" -v negf="$OUTPUT.logo-neg.b64" '
        BEGIN { getline pos < posf; getline neg < negf; close(posf); close(negf) }
        { gsub(/assets\/logo\/rpf-logo-negativ\.png/, "data:image/png;base64," neg);
          gsub(/assets\/logo\/rpf-logo\.png/, "data:image/png;base64," pos);
          print }'
  rm -f "$OUTPUT.logo-pos.b64" "$OUTPUT.logo-neg.b64"

  # ── Embed App Modules ──
  echo "<script>"
  BUILD_STAMP="$(date -u +'%Y-%m-%d %H:%M UTC')"
  for mod in "${APP_MODULES[@]}"; do
    echo "// ── $(basename "$mod") ──"
    # Programmstand in App.BUILD eintragen (nur app-core.js enthält die Zeile)
    sed "s/BUILD: 'dev',/BUILD: '$BUILD_STAMP',/" "$mod"
    echo ""
  done
  echo "</script>"

  echo "</body>"
  echo "</html>"

} > "$OUTPUT"

# ── Ergebnis ──
SIZE=$(du -h "$OUTPUT" | cut -f1)
LINES=$(wc -l < "$OUTPUT")
echo "  Fertig: $OUTPUT"
echo "  Groesse: $SIZE ($LINES Zeilen)"
echo ""
echo "  Diese Datei kann direkt im Browser geoeffnet werden!"
echo "  Einfach auf das Netzlaufwerk kopieren - fertig."
echo ""

