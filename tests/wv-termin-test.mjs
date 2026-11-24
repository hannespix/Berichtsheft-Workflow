// ═══════════════════════════════════════════════════════════════════
//  Termin der Wiedervorlage ist freiwillig (Nov. 2026): leer = ohne
//  Termin; bei persönlicher Vorlage im RP ist das Datum ein Termin,
//  keine Frist, und wird nicht vorgeschlagen
//  Ausführen:  node tests/wv-termin-test.mjs
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
const K = read('src/js/modules/kontrolle.js');

let ok = 0, fehler = 0;
const check = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text); } else { fehler++; console.log('  ✗ FEHLER: ' + text); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const els = {};
const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { stapel: [], push(text, undo, redo) { this.stapel.push({ text, undo, redo }); }, clear() {} },
  confirm: () => true, esc: (x) => String(x ?? ''), todayStr: () => '2026-11-24',
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav'], ['src/js/modules/workflows.js', 'Workflows']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const App = sandbox.__App, KH = sandbox.KontrolleHandler, WF = sandbox.Workflows, Undo = sandbox.UndoManager;
App.db = db; App.demoMode = true; App.markDirty = () => {}; App.toast = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
KH.renderSchueler = () => {}; KH.renderUebersicht = () => {}; KH._pruefeAbgeschlossen = () => true; KH.isLockedByOther = () => false;
KH.weiterModus = () => 'bleiben';


const W = read('src/js/modules/workflows.js'), V = read('src/js/modules/views.js'), P = read('src/js/modules/pdf-export.js');
const heute = '2026-11-24';
const plus = (n) => { const d = new Date(heute + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
sandbox.addDaysStr = plus;
db.run("INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende) VALUES (1,'Adler','Anna',1,'2024-09-01','2027-08-31')");
db.run("INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-11-20','geplant')");
db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend,geprueft_kws) VALUES (101,10,1,'',1,'{}')");
KH.currentTerminId = 10; KH.currentSchuelerList = App.query('SELECT * FROM schueler'); KH.currentIndex = 0; KH.activePruefer = 'Pix';
KH._autoHinweiseCodes = () => ({});
const wv = () => App.query('SELECT * FROM wiedervorlagen WHERE kontrollergebnis_id=101 ORDER BY id DESC')[0];
const anzahl = () => App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=101');

console.log('\n══ Helfer: Datum · nächste Durchsicht · ohne Termin ══');
{
  const w = (art, frist) => ({ art, frist_datum: frist });
  check(App.wvFristArt(w('berichte_bis_termin_email', '2026-12-08')) === 'datum' && App.wvFristArt(w('nachholung_naechste_durchsicht', '')) === 'naechste' && App.wvFristArt(w('berichte_bis_termin_email', '')) === 'ohne' && App.wvFristArt(w('persoenliche_vorlage_rp', '')) === 'ohne', 'Leeres Datum: „nächste Durchsicht“ nur bei dieser Art, sonst „ohne Termin“');
  check(App.wvFristArt(w('', '')) === 'naechste' && App.wvFristArt(w('nachholung', '')) === 'naechste', 'Altbestand ohne Art bzw. „nachholung“ bleibt „nächste Durchsicht“');
  check(App.wvFristText(w('post_an_rp', '')) === 'ohne Termin' && App.wvFristText(w('nachholung_naechste_durchsicht', '')) === 'nächste Durchsicht' && App.wvFristText(w('post_an_rp', '2026-12-08')) === '08.12.2026', 'Text für Listen');
  check(App.wvIstTermin('persoenliche_vorlage_rp') && !App.wvIstTermin('post_an_rp') && App.wvFristText(w('persoenliche_vorlage_rp', '2026-12-08'), true) === 'Termin 08.12.2026' && App.wvFristText(w('post_an_rp', '2026-12-08'), true) === '08.12.2026', 'Persönliche Vorlage im RP: das Datum ist ein Termin');
  check(App.wvFristSatz(w('post_an_rp', '')) === 'zum vereinbarten Termin' && App.wvFristSatz(w('post_an_rp', '2026-12-08')) === '08.12.2026' && App.wvFristSatz(w('nachholung_naechste_durchsicht', '')) === 'zur nächsten Durchsicht', 'Satzbaustein „bis spätestens …“ in Anschreiben');
  check(App.wvFristAngabe(w('post_an_rp', '')) === 'ohne Termin' && App.wvFristAngabe(w('post_an_rp', '2026-12-08')) === 'Frist 08.12.2026' && App.wvFristAngabe(w('persoenliche_vorlage_rp', '2026-12-08')) === 'Termin 08.12.2026', 'Angabe in der Sammel-Erinnerung');
}

console.log('\n══ Durchsicht: Vorschlag, Leeren, Wechsel des Nachweiswegs ══');
{
  check(KH._wvDefaultFuer('berichte_bis_termin_email') === plus(28) && KH._wvDefaultFuer('post_an_rp') === plus(21) && KH._wvDefaultFuer('persoenliche_vorlage_rp') === '' && KH._wvDefaultFuer('nachholung_naechste_durchsicht') === '', 'Vorschlag: E-Mail/Post eine Frist, persönliche Vorlage und nächste Durchsicht kein Datum');
  KH.saveField('ergebnis', 'berichte_bis_termin_email');
  check(anzahl() === 1 && wv().frist_datum === plus(28) && wv().status === 'offen', 'Mängel per E-Mail: Wiedervorlage mit vorgeschlagenem Datum');
  KH.saveWV(101, '');
  check(anzahl() === 1 && wv().frist_datum === '' && wv().status === 'offen' && wv().art === 'berichte_bis_termin_email', 'Datum geleert: Wiedervorlage bleibt offen, ohne Termin');
  KH.saveField('ergebnis', 'post_an_rp');
  check(wv().art === 'post_an_rp' && wv().frist_datum === '', 'Wechsel E-Mail → Post: das bewusst geleerte Datum bleibt leer');
  KH.saveWV(101, '2026-12-08');
  KH.saveField('ergebnis', 'berichte_bis_termin_email');
  check(wv().frist_datum === '2026-12-08', 'Ein eingetragenes Datum bleibt beim Wechsel zwischen E-Mail und Post');
  KH.saveField('ergebnis', 'persoenliche_vorlage_rp');
  check(wv().art === 'persoenliche_vorlage_rp' && wv().frist_datum === '', 'Wechsel zu „persönliche Vorlage im RP“: die Frist wird nicht zum Termin – Datum leer');
  KH.saveWV(101, '2026-12-10');
  check(wv().frist_datum === '2026-12-10', 'Vereinbarter Termin lässt sich eintragen');
  KH.saveField('ergebnis', 'post_an_rp');
  check(wv().frist_datum === plus(21), 'Wechsel vom Termin zur Post: wieder der Fristvorschlag');
  KH.saveField('ergebnis', 'nachholung_naechste_durchsicht');
  check(wv().frist_datum === '' && App.wvFristText(wv()) === 'nächste Durchsicht', '„Nächste Durchsicht“ hat nie ein Datum');
  KH.saveField('ergebnis', 'berichte_bis_termin_email');
  check(wv().frist_datum === plus(28) && anzahl() === 1, 'Zurück zu E-Mail: Vorschlag, weiter genau eine Wiedervorlage');
  // überfällig → Termin entfernt → wieder offen
  App.run("UPDATE wiedervorlagen SET frist_datum='2026-10-01', status='ueberfaellig' WHERE kontrollergebnis_id=101");
  KH.saveWV(101, '');
  check(wv().status === 'offen' && wv().frist_datum === '', 'Überfällige Wiedervorlage ohne Termin ist wieder „offen“');
  check(App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE status='offen' AND frist_datum != '' AND frist_datum < ?", [heute]) === 0, 'Ohne Termin wird sie nie überfällig');
  KH.saveField('ergebnis', 'in_ordnung');
  KH.saveWV(101, '2026-12-24');
  check(wv().frist_datum === '' && wv().status === 'erledigt', '„In Ordnung“: kein Termin mehr setzbar, die Wiedervorlage ist erledigt');
  check(/id="wvLabel">\$\{this\._wvLabel\(ke\.ergebnis\)\}/.test(K) && KH._wvLabel('persoenliche_vorlage_rp') === 'Termin im RP' && KH._wvLabel('post_an_rp') === 'Wiedervorlage', 'Beschriftung in der Leiste: „Termin im RP“ bzw. „Wiedervorlage“');
  check(/id="wvLeeren"/.test(K) && /aria-label="Termin der Wiedervorlage entfernen"/.test(K) && /onclick="KontrolleHandler\.wvLeeren\(\$\{ke\.id\}\)"/.test(K), 'Knopf „✕“ entfernt den Termin (beschriftet)');
}

console.log('\n══ Termin abschließen: leeres Datum legt die Wiedervorlage ohne Termin an ══');
{
  App.run('DELETE FROM wiedervorlagen');
  App.run("UPDATE kontrollergebnisse SET ergebnis='post_an_rp' WHERE id=101");
  const zeile = { dataset: { wvKe: '101', wvSid: '1', wvArt: 'post_an_rp' }, querySelector: (s) => s === '.wv-auto' ? { checked: true } : { value: '' } };
  sandbox.document.querySelectorAll = (s) => s === '[data-wv-ke]' ? [zeile] : [];
  els.mAbschlDatum = { value: '2026-11-20' };
  App.openModal = () => {}; App.closeModal = () => {}; App.showLoading = () => {}; App.hideLoading = () => {}; App.terminSchritt = () => {};
  try { KH.doAbschliessen(); } catch (e) { console.log('    (doAbschliessen: ' + e.message + ')'); }
  check(anzahl() === 1 && wv().frist_datum === '' && wv().art === 'post_an_rp', 'Abschluss-Assistent: Zeile ohne Datum → Wiedervorlage ohne Termin (vorher wurde sie gar nicht angelegt)');
  check(/persoenliche_vorlage_rp: '',/.test(K) && /Leeres Datum = Wiedervorlage ohne Termin/.test(K), 'Assistent schlägt für die persönliche Vorlage kein Datum vor und erklärt das leere Feld');
  sandbox.document.querySelectorAll = () => [];
}

console.log('\n══ Anzeigen und Schreiben ══');
{
  check(/App\.wvFristText\(w, true\)/.test(V) && /App\.wvFristText\(w, true\)/.test(read('src/js/modules/termin-seite.js')) && /App\.wvFristText\(w, true\)/.test(read('src/js/modules/azubi-seite.js')) && /App\.wvFristText\(w\)/.test(read('src/js/modules/tabellen-export.js')), 'Wiedervorlagen-Liste, Termin-Seite, Azubi-Seite und Excel nennen „ohne Termin“');
  check(/'Wiedervorlage \(ohne Termin\)'/.test(P) && /Termin im RP am \$\{formatDate\(w0\.frist_datum\)\}/.test(P) && /'Vorlage im RP – Termin nach Absprache'/.test(P), 'Durchsichtsbogen: „Termin im RP am …“, „Termin nach Absprache“ bzw. „ohne Termin“');
  check(/frist: App\.wvFristSatz\(w\)/.test(W) && /App\.wvFristText\(wv\)/.test(W), 'Anschreiben zur Wiedervorlage und Brief-Übersicht ohne erfundenes Datum');
  check(/App\.wvFristArt\(w\) === 'naechste' \? 'Leer = bei der nächsten Durchsicht/.test(read('src/js/modules/wiedervorlagen.js')) && /App\.wvIstTermin\(w\.art\) \? 'Termin' : 'Frist'/.test(read('src/js/modules/wiedervorlagen.js')), 'Details und „Wieder öffnen“ unterscheiden Termin, Frist und ohne Termin');
  check(/\.ke-wv-x:focus-visible/.test(read('src/css/styles.css')) && !/\.ke-wv-x \{[^}]*font-size: (?:[0-9]|1[01])px/.test(read('src/css/styles.css')), 'Knopf mit sichtbarem Fokus, Schrift ≥ 12 px');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fehler} Fehler ═══`);
process.exit(fehler ? 1 : 0);
