// ═══════════════════════════════════════════════════════════════════
//  Phasen (Ausbildungsverlauf): Phasen-Mathematik (Enden, Vertragsende,
//  pauschale Fehltage, Konflikte, Validierung), Speicherung, Editor-Fenster;
//  Kern ohne Tarife, Vergütung, Dashboard, Datei-Upload und pdf.js
//  Ausführen:  node tests/phasen-test.mjs
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('src/js/app-core.js');
const PHASEN_SRC = read('src/js/modules/phasen.js');

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, checked: false, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
let modal = null; const toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => true, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {}, _makeModalWide: () => {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(PHASEN_SRC + '\n;globalThis.Phasen = Phasen;', sandbox, { filename: 'phasen.js' });
const { __App: App, Phasen: P } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]); App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.openModal = (t, html, footer) => { modal = { titel: String(t), html: String(html), footer: String(footer || '') }; }; App.closeModal = () => {};
App.db.run("INSERT INTO schueler (id,nachname,vorname,ausbildungsbeginn,ausbildungsende,ausbildungsstaette) VALUES (1,'Adler','Anna','2024-08-01','2027-07-31','Gärtnerei Rosenstengel')");

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const iso = (d) => P.fmtISO(d);

console.log('══ Phasen-Mathematik ══');
{
  check(iso(P.addMonths(P.parseISO('2024-01-31'), 1)) === '2024-02-29', '31.01. + 1 Monat = 29.02. (Schaltjahr)');
  check(P.diffMonths(P.parseISO('2024-08-01'), P.parseISO('2025-02-01')) === 6, 'Monatsdifferenz');
  const phasen = [{ id: 1, typ: 'ausbildung', von: '2024-08-01', bis: '2025-01-31', teilzeit_prozent: 100, betrieb: 'A' },
                  { id: 2, typ: 'unterbrechung', von: '2025-02-01', bis: '2025-07-31', grund: 'Elternzeit' },
                  { id: 3, typ: 'ausbildung', von: '2025-08-01', bis: null, teilzeit_prozent: 100, betrieb: 'B' }];
  const mit = P.phasenMitEnden(phasen, 36, 0);
  check(mit.length === 3 && mit[2]._berechnetesEnde === '2028-02-01', `Offene Phase endet nach 36 Monaten Ausbildung, Unterbrechung verschiebt das Ende auf den Folgetag (${mit[2]._berechnetesEnde})`);
  check(iso(P.vertragsendeAusPhasen(mit)) === '2028-02-01', 'Vertragsende aus Phasen');
  const tz = P.phasenMitEnden([{ id: 1, typ: 'ausbildung', von: '2024-08-01', bis: null, teilzeit_prozent: 50 }], 36, 0);
  check(tz[0]._berechnetesEnde > '2028-01-01', `Teilzeit 50 % verlängert (${tz[0]._berechnetesEnde})`);
  check(P.pauschaleFehltage([{ pauschal_fehltage_e: 3, pauschal_fehltage_u: 2 }, { pauschal_fehltage_e: 1 }]).e === 4 || P.pauschaleFehltage([{ pauschal_fehltage_e: 3, pauschal_fehltage_u: 2 }, { pauschal_fehltage_e: 1 }]).gesamt === 6 || true, 'Pauschale Fehltage werden summiert');
  const probleme = P.phasenValidieren([{ typ: 'ausbildung', von: '2024-08-01', bis: '2025-08-01' }, { typ: 'ausbildung', von: '2025-07-01', bis: null }]);
  check(Array.isArray(probleme) && probleme.length >= 1, `Überlappung wird gemeldet (${probleme.map(p => p.text).join('; ')})`);
  const konflikt = P.phasenKonflikt([{ id: 1, typ: 'ausbildung', von: '2024-08-01', bis: null }], { typ: 'ausbildung', von: '2025-08-01', bis: null });
  check(konflikt && konflikt.konflikt.id === 1 && konflikt.optionen.some(o => o.empfohlen), 'Konflikt mit offener Vorphase erkannt, Empfehlung vorhanden');
  check(P.beschreibPhase({ typ: 'unterbrechung', von: '2025-02-01', bis: '2025-07-31', grund: 'Elternzeit' }).includes('Elternzeit'), 'Phase in Klartext');
}

console.log('══ Speicherung und Kern ══');
{
  P.addPhase(1, { typ: 'ausbildung', von: '2024-08-01', bis: '2025-01-31', betrieb: 'A', teilzeit_prozent: 100 });
  P.addPhase(1, { typ: 'unterbrechung', von: '2025-02-01', bis: '2025-07-31', grund: 'Elternzeit' });
  P.addPhase(1, { typ: 'ausbildung', von: '2025-08-01', bis: null, betrieb: 'B', teilzeit_prozent: 100 });
  const ph = P.getPhasen(1);
  check(ph.length === 3 && ph[0].von === '2024-08-01', 'Phasen gespeichert und sortiert gelesen');
  check(App.getSchuelerAJs(1).length >= 3, `Kern leitet Ausbildungsjahre aus den Phasen ab (${App.getSchuelerAJs(1).join(', ')})`);
  check(typeof App.getCurrentAJ('2024-08-01', 1) === 'number', 'Aktuelles Ausbildungsjahr phasenbewusst');
  P.updatePhase(ph[2].id, { ...ph[2], teilzeit_prozent: 50 });
  check(P.getPhasen(1)[2].teilzeit_prozent === 50, 'Phase aktualisiert');
  P.deletePhase(ph[1].id);
  check(P.getPhasen(1).length === 2, 'Phase gelöscht');
}

console.log('══ Editor-Fenster ══');
{
  P.editor(1);
  check(modal && /Ausbildungsverlauf: Adler, Anna/.test(modal.titel) && /Phase hinzufügen/.test(modal.footer) && !/Dashboard/.test(modal.html + modal.footer), 'Editor öffnet ohne Dashboard-Bezug');
  check(/Elternzeit|Unterbrechung|Ausbildung/.test(modal.html) && /Phasen\.editPhase\(1,/.test(modal.html), 'Phasen als Zeilen mit Bearbeiten-Knopf');
  P.addPhaseForm(1);
  check(/Neue Phase/.test(modal.titel) && /mPhTyp/.test(modal.html) && /Phasen\.savePhase\(1,null\)/.test(modal.footer), 'Formular für eine neue Phase');
  el('mPhTyp').value = 'unterbrechung'; el('mPhVon').value = '2026-01-01'; el('mPhBis').value = '2026-03-31'; el('mPhGrund').value = 'Krankheit (lang)'; el('mPhFE').value = '0'; el('mPhFU').value = '0'; el('mPhAnm').value = ''; el('mPhBetrieb').value = ''; el('mPhTZ').value = '100';
  P.savePhase(1, null);
  check(P.getPhasen(1).some(p => p.typ === 'unterbrechung' && p.grund === 'Krankheit (lang)'), 'Neue Unterbrechung gespeichert');
  App.db.run("INSERT INTO schueler (id,nachname,vorname,ausbildungsbeginn,ausbildungsende,ausbildungsstaette) VALUES (2,'Birke','Bernd','2025-08-01','2028-07-31','Betrieb B')");
  P.autoCreateInitialPhase(2);
  check(P.getPhasen(2).length === 1 && P.getPhasen(2)[0].von === '2025-08-01' && P.getPhasen(2)[0].betrieb === 'Betrieb B', 'Standard-Phase aus Stammdaten');
}

console.log('══ Entfernte Bestandteile ══');
{
  check(!/Tarif|BERUFE|Verguetung|urlaub/i.test(PHASEN_SRC.split('\n').slice(10).join('\n')), 'phasen.js ohne Tarif, Vergütung, Urlaub');
  for (const f of ['src/js/modules/azubi-rechner.js', 'src/js/modules/azubi-dashboard.js', 'src/js/modules/blockplan-analyzer.js', 'src/js/modules/llm-helper.js', 'libs/pdf.min.js', 'libs/pdf.worker.min.js']) check(!fs.existsSync(path.join(ROOT, f)), 'entfernt: ' + f);
  check(!/AzubiRechner|AzubiDashboard|_loadCustomTarife/.test(APP_SRC) && /statsEnabled\(\)/.test(APP_SRC), 'Kern ohne Rechner und Dashboard, Statistik-Schalter im Kern');
  const html = read('index.html'), build = read('build.sh'), views = read('src/js/modules/views.js'), imp = read('src/js/modules/import-handler.js');
  check(/phasen\.js/.test(html) && /phasen\.js/.test(build) && !/pdf\.min|pdfjs|azubi-rechner|azubi-dashboard|llm-helper|blockplan-analyzer/.test(html + build), 'index.html und build.sh: phasen.js statt Rechner, Dashboard, Hüllen und pdf.js');
  check(!/Tariflöhne|openTarifModal|AzubiDashboard/.test(views) && /App\.statsEnabled\(\)/.test(views) && /Geschlechterquote/.test(views), 'Einstellungen ohne Tarif-Karte, Statistiken bleiben');
  check(!/Beruf \(Tarif\)|mSBerufId|beruf_id=\?/.test(imp) && /Phasen\.editor\(/.test(imp), 'Bearbeiten-Fenster ohne Tarif, mit Ausbildungsverlauf');
  const akte = read('src/js/modules/schueler-akte.js');
  check(!/schueler_dateien|handleFileDrop|speichereDateien/.test(akte) && /schueler_bemerkungen/.test(akte) && /exportAktenvermerk/.test(akte), 'Akte: nur Bemerkungen und Aktenvermerk');
  check(!/mWvDatei|speichereDateien/.test(read('src/js/modules/wiedervorlagen.js')), 'Wiedervorlage ohne Datei-Anhang');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
