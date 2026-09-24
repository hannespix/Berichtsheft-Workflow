// ═══════════════════════════════════════════════════════════════════
//  Zoom und Barrierefreiheit: Kontraste der Palette (≥ 4,5:1), keine
//  Schrift unter 12 px (Ausnahme Raster-Codes 11 px, Druck), feste Leisten
//  nur bei genug Fensterhöhe, Ergebnisleiste bündig, sichtbarer Fokus,
//  Beschriftungen für Symbolknöpfe und Menüs, Jahreskopf per Tastatur,
//  Einstellung „Große Schrift“
//  Ausführen:  node tests/a11y-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const CSS = read('src/css/styles.css'), APP = read('src/js/app-core.js'), K = read('src/js/modules/kontrolle.js'), V = read('src/js/modules/views.js'), ST = read('src/js/modules/stammdaten.js'), HTML = read('index.html');

// ── Kontrast nach WCAG ──
const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const root = CSS.split(':root {')[1].split('}')[0];
const farbe = (name) => (root.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
const F = { forest: farbe('clr-forest'), sage: farbe('clr-sage'), amber: farbe('clr-amber'), green: farbe('clr-green'), red: farbe('clr-red'), textLight: farbe('clr-text-light'), text: farbe('clr-text'), warm: farbe('clr-warm'), white: farbe('clr-white'), gelb: farbe('clr-gelb'), blue: farbe('clr-blue') };

console.log('══ Kontraste (mindestens 4,5:1 für normale Schrift) ══');
{
  const paare = [
    ['Weiß auf Grün (Fertig, Starten, Erledigt)', F.white, F.green],
    ['Weiß auf Orange (Fehltage-Marke, Warnknöpfe)', F.white, F.amber],
    ['Weiß auf Rot (Löschen, Sperre)', F.white, F.red],
    ['Weiß auf Schwarz (Hauptknopf)', F.white, F.forest],
    ['Grau (sage) auf Weiß (Nebenangaben, Kürzel)', F.sage, F.white],
    ['Grau (sage) auf Warm (Innenflächen)', F.sage, F.warm],
    ['Weiß auf Grau (Pille „offen“)', F.white, F.sage],
    ['Hilfstext auf Weiß', F.textLight, F.white],
    ['Hilfstext auf Warm', F.textLight, F.warm],
    ['Text auf Gelb (Kopfzeile)', F.forest, F.gelb],
    ['Blau auf Weiß (Links, Ämter)', F.blue, F.white],
  ];
  for (const [n, a, b] of paare) { const k = kontrast(a, b); check(k >= 4.5, `${n}: ${k.toFixed(2)}:1`); }
  check(/\.btn-success:hover \{ background: #2B4904; \}/.test(CSS), 'Hover-Grün noch dunkler');
}

console.log('\n══ Schriftgrößen ══');
{
  const ohneDruck = CSS.split('@media print {')[0];
  const klein = [...ohneDruck.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n < 12);
  const codesRegeln = (ohneDruck.match(/\.kw-cell \.kw-codes \{ font-size: 11px;/g) || []).length;
  check(klein.length === codesRegeln && klein.every(n => n === 11) && codesRegeln >= 1, `CSS: keine Schrift unter 12 px außer den Raster-Codes (11 px) – gefunden: ${klein.join(', ') || 'keine'}`);
  const module = fs.readdirSync(path.join(ROOT, 'src/js/modules')).filter(f => f.endsWith('.js')).map(f => 'src/js/modules/' + f).concat(['src/js/app-core.js', 'index.html']);
  const reste = [];
  for (const m of module) { const t = read(m); const k = [...t.matchAll(/font-size:\s*(\d+)px/g)].map(x => +x[1]).filter(n => n < 12); if (k.length) reste.push(`${m} (${k.length})`); }
  check(reste.length === 0, `Oberfläche: keine Inline-Schrift unter 12 px${reste.length ? ' – Reste: ' + reste.join(', ') : ''}`);
  check(/\.kw-cell \.kw-num \{ font-size: 12px;/.test(CSS) && /\.erg-pill kbd \{ font-size: 12px;/.test(CSS), 'Rasterzahlen und Kürzel-Hinweise 12 px');
}

console.log('\n══ Zoom: feste Leisten nur bei genug Platz, Leiste bündig ══');
{
  check(/@media \(max-height: 720px\), \(max-width: 720px\) \{\n  \.azubi-sticky, \.kw-legend, \.ke-leiste \{ position: static;/.test(CSS), 'Ab 720 px Fensterhöhe oder -breite scrollen Azubi-Kopf, Kürzel-Leiste und Ergebnisleiste mit');
  check(/\.ke-leiste \{ position: sticky; bottom: calc\(-1 \* var\(--gutter-unten\)\);/.test(CSS) && (CSS.match(/:root \{ --gutter: \d+px; --gutter-unten: \d+px; --gutter-kopf: \d+px; \}/g) || []).length === 4, 'Ergebnisleiste überbrückt den Seitenabstand über das Randmaß (vier Stufen je Breite)');
  check(/\.kw-bereich-select \{ width: auto !important; min-width: 78px; \}/.test(CSS) && /class="form-control kw-bereich-select" aria-label="Bereich von Kalenderwoche"/.test(K), 'Bereichsauswahl im Raster wird nicht abgeschnitten');
  check(/prefers-reduced-motion: reduce/.test(CSS), 'Bewegung reduziert, wenn das System es wünscht');
}

console.log('\n══ Tastatur und Vorleseprogramm ══');
{
  check(/\.btn:focus-visible, \.btn-icon:focus-visible, \.tab-btn:focus-visible[^{]*\{ outline: 3px solid var\(--clr-gelb\); outline-offset: 2px;/.test(CSS), 'Sichtbarer gelber Fokus auf Knöpfen, Reitern, Menüs und Links');
  check(/class="card-header aj-kopf"[^>]*role="button" tabindex="0" aria-expanded="\$\{zu \? 'false' : 'true'\}"[^>]*onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/.test(K), 'Jahreskopf ist per Tastatur erreichbar (Enter/Leertaste, aria-expanded)');
  for (const [name, re] of [['Vorheriger Azubi', /aria-label="Vorheriger Azubi"/], ['Nächster Azubi', /aria-label="Nächster Azubi"/], ['Nächster offener Azubi', /aria-label="Nächster offener Azubi"/], ['Zurück zur Übersicht', /aria-label="Zurück zur Übersicht"/], ['Kürzel ein/aus', /aria-label="Mängelcodes und Tastenkürzel ein- oder ausblenden" aria-controls="kwLegendBar"/], ['Kürzel ausblenden', /aria-label="Kürzel ausblenden"/], ['Einzelansicht öffnen (Übersicht)', /aria-label="Einzelansicht öffnen: \$\{esc\(s\.nachname\)\}/], ['Azubi entfernen (Übersicht)', /aria-label="Azubi aus dieser Kontrolle entfernen: /]]) check(re.test(K), `Kontrolle: Beschriftung „${name}“`);
  check(/aria-label="\$\{esc\(title \|\| 'Weitere Aktionen'\)\}" aria-haspopup="menu"/.test(APP), 'Menüknöpfe tragen Beschriftung und Menü-Rolle');
  const icons = [...ST.matchAll(/<button class="btn-icon btn-sm"[^>]*>/g)].map(m => m[0]);
  check(icons.length >= 8 && icons.every(b => /aria-label="/.test(b)), `Stammdaten: alle ${icons.length} Symbolknöpfe beschriftet`);
  check(/id="hamburgerBtn"[^>]*aria-label="Menü ein- oder ausblenden"/.test(HTML) && /aria-label="Suche öffnen \(Strg\+K\)"/.test(HTML), 'Kopfzeile: Menü und Suche beschriftet');
}

console.log('\n══ Große Schrift ══');
{
  check(/body\.grosse-schrift \{ zoom: 1\.2; \}/.test(CSS), 'Große Schrift vergrößert die ganze Oberfläche um 20 %');
  check(/get grosseSchrift\(\) \{ return this\.lsGet\('bhk_grosse_schrift'\) === '1'; \}/.test(APP) && /setGrosseSchrift\(an\) \{/.test(APP) && /document\.body\.classList\.toggle\('grosse-schrift', this\.lsGet\('bhk_grosse_schrift'\) === '1'\);/.test(APP), 'Einstellung je Rechner, wird beim Start angewendet');
  check(/onchange="App\.setGrosseSchrift\(this\.checked\)"/.test(V) && /Große Schrift \(dieser Rechner\)/.test(V), 'Schalter unter Einstellungen → Darstellung');
}

console.log('\n══ Feinschliff Durchsicht: eine haftende Zeile ══');
{
  check(/<div class="kopf-block" id="kopfBlock">/.test(HTML) && /<\/div><!-- \/kopf-block -->/.test(HTML) && /_kopfInit\(\) \{/.test(APP) && /body\.kopf-weg \.kopf-block \{ margin-top: calc\(-1 \* var\(--kopf-h, 110px\)\); \}/.test(CSS), 'Kopfzeile und Filterbalken gleiten beim Scrollen nach unten weg (Klasse kopf-weg, gemessene Höhe)');
  check(/if \(Date\.now\(\) < sperre\) return;/.test(APP) && /sperre = Date\.now\(\) \+ 350/.test(APP) && /this\.kopfZeigen\(\);/.test(APP.split('navigate(view, skipHash) {')[1].slice(0, 200)), 'Sperre gegen Hin und Her am unteren Rand, Seitenwechsel zeigt den Kopf wieder');
  check(/--gutter: 32px;/.test(CSS) && /\.main-content \{\n  flex: 1;\n  overflow-y: auto;\n  padding: 0 var\(--gutter\) var\(--gutter-unten\);/.test(CSS) && /padding: 0 var\(--gutter\);\n  margin: 0 calc\(-1 \* var\(--gutter\)\) 0;/.test(CSS) && /margin: 12px calc\(-1 \* var\(--gutter\)\) calc\(-1 \* var\(--gutter-unten\)\); padding: 6px var\(--gutter\) 8px;/.test(CSS), 'Ein Randmaß für Inhalt, Azubi-Kopf und Ergebnisleiste');
  check(!/\.main-content \{ padding: 0 \d+px \d+px; \}/.test(CSS) && !/\.ke-leiste \{ bottom: -\d+px;/.test(CSS), 'Keine festen Pixelabstände mehr in den Breakpoints');
  check(/class="ke-zeile2"/.test(K) && !/class="ke-bemerkung"/.test(K) && !/class="ke-fuss"/.test(K) && /\.ke-zeile2 textarea \{ flex: 1 1 260px;/.test(CSS), 'Ergebnisleiste hat zwei Zeilen: Ergebnis · Bemerkung mit Navigation');
  check(!/Auto-Weiter<\/label>/.test(K) && /Auto-Weiter nach „In Ordnung“/.test(K) && /autoWeiterUmschalten\(\) \{/.test(K) && /textbausteinEinfuegen\(i\) \{/.test(K), 'Auto-Weiter im ⋯-Menü, Textbausteine als Menü statt Auswahlfeld');
  check(/id="keGesichert" class="as-gesichert/.test(K) && /<i class="punkt"><\/i><span class="sr-only">/.test(K) && /el\.classList\.toggle\('offen', offen\);/.test(K) && /\.azubi-sticky \.as-gesichert\.offen \.punkt/.test(CSS), 'Speicherstatus als Punkt im Azubi-Kopf mit Text für Vorleseprogramme');
  check(/<div class="kw-legend-anker"><div class="kw-legend/.test(K) && /role="dialog" aria-label="Mängelcodes und Tastenkürzel"/.test(K) && /\.kw-legend-anker \{\n  position: sticky;\n  top: 33px;/.test(CSS) && /\.kw-legend \{\n  position: absolute;/.test(CSS) && /_legendeZuHandler/.test(K), 'Kürzel als Popover unter dem Azubi-Kopf, Klick daneben schließt');
  check(/\.page-header\.kompakt \{/.test(CSS) && /page-header'\)\?\.classList\.add\('kompakt'\)/.test(K) && /page-header'\)\?\.classList\.remove\('kompakt'\)/.test(K), 'Seitenkopf der Durchsicht wird mit geladenem Termin kompakt');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
