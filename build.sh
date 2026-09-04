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
  "libs/pdf.min.js"
  "libs/chart.umd.min.js"
)
WASM_FILE="libs/sql-wasm.wasm"
PDF_WORKER="libs/pdf.worker.min.js"
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
  "src/js/modules/llm-helper.js"
  "src/js/modules/blockplan-analyzer.js"
  "src/js/modules/global-search.js"
  "src/js/modules/keyboard-shortcuts.js"
  "src/js/modules/bulk-schueler.js"
  "src/js/modules/bulk-wv.js"
  "src/js/modules/workflows.js"
  "src/js/modules/wiedervorlagen.js"
  "src/js/modules/berichte.js"
  "src/js/modules/table-sort.js"
  "src/js/modules/azubi-rechner.js"
  "src/js/modules/azubi-dashboard.js"
  "src/js/modules/schueler-view.js"
  "src/js/modules/schueler-akte.js"
)

# Prüfe ob alle Dateien existieren
MISSING=0
for f in "$CSS_FILE" "${LIBS[@]}" "$WASM_FILE" "$PDF_WORKER" "${FONT_FILES[@]}" "${LOGO_FILES[@]}" "${APP_MODULES[@]}"; do
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
echo "  PDF-Worker: $(du -h "$PDF_WORKER" | cut -f1)"
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

  # ── Embed PDF Worker inline (base64 to avoid backtick issues) ──
  echo "<script>"
  echo "if(window.pdfjsLib){"
  echo -n '  const _pdfWorkerCode=atob("'
  base64 -w0 "$PDF_WORKER"
  echo '");'
  echo "  const _pdfWorkerBlob=new Blob([_pdfWorkerCode],{type:'application/javascript'});"
  echo "  pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(_pdfWorkerBlob);"
  echo "}"
  echo "</script>"

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
  for mod in "${APP_MODULES[@]}"; do
    echo "// ── $(basename "$mod") ──"
    cat "$mod"
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

