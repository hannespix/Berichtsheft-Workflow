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
  "fonts/dm-sans-latin.woff2"
  "fonts/dm-sans-italic-latin.woff2"
  "fonts/fraunces-latin.woff2"
)
APP_MODULES=(
  "src/js/app-core.js"
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
  "src/js/modules/schueler-view.js"
  "src/js/modules/schueler-akte.js"
  "src/js/utils.js"
)

# Prüfe ob alle Dateien existieren
MISSING=0
for f in "$CSS_FILE" "${LIBS[@]}" "$WASM_FILE" "$PDF_WORKER" "${FONT_FILES[@]}" "${APP_MODULES[@]}"; do
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

  # ── Fonts (base64-eingebettet) ──
  DM_SANS_B64=$(base64 -w0 "fonts/dm-sans-latin.woff2")
  DM_SANS_IT_B64=$(base64 -w0 "fonts/dm-sans-italic-latin.woff2")
  FRAUNCES_B64=$(base64 -w0 "fonts/fraunces-latin.woff2")
  cat <<FONTS
<style>
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('data:font/woff2;base64,${DM_SANS_B64}') format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
@font-face {
  font-family: 'DM Sans';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url('data:font/woff2;base64,${DM_SANS_IT_B64}') format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('data:font/woff2;base64,${FRAUNCES_B64}') format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
</style>
FONTS

  # ── Embed CSS ──
  echo "<style>"
  cat "$CSS_FILE"
  echo "</style>"
  echo "</head>"

  # ── Body (from index.html, lines between <body> and the script tags) ──
  # Extract the HTML body content from index.html
  sed -n '/<body>/,/<!-- ═══ APPLICATION MODULES ═══ -->/{ /<!-- ═══ APPLICATION MODULES/d; p }' index.html

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

