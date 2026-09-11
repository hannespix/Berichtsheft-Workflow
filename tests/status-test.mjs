// ═══════════════════════════════════════════════════════════════════
//  Status-Modell und IBYKUS-Import (Audit 7 Paket B)
//  Ausführen:  node tests/status-test.mjs
//  Fährt den echten Import (ImportHandler.doImport) gegen die echte
//  App-Logik: ENDE + bestanden, Namens-Fallback mit fremder Ident,
//  Fehlende im Export, zentrales Status-Modell mit Wiedervorlagen.
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

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
db.run("INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'036','GaLaBau','Gärtner')");

let modalHtml = '';
const el = (id) => ({ id, value: id && id.startsWith('map_') ? id.slice(4) : '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => '2026-09-11', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: { importView() {} }, SchuelerView: { render() {} }, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: { azubis() {} }, GlobalSearch: {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/azubi-rechner.js', 'AzubiRechner'], ['src/js/modules/import-handler.js', 'ImportHandler']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, ImportHandler: IH } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.showLoading = () => {}; App.hideLoading = () => {}; App.fullSave = async () => {}; App.dbFileHandle = {};
App.openModal = (t, html) => { modalHtml = String(html); }; App.closeModal = () => {};
App.currentUser = 'Test';
App.migrateDB();

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const row = (o) => ({ nachname: '', vorname: '', ibykus_id: '', ausbildungsbeginn: '01.09.2024', ausbildungsende: '31.08.2027', beruf_code: '036', pruefungstermin: 'S2027',
  berufsschule: 'BS Testhausen', ausbildungsstaette: 'Gärtnerei Test', zustaendiges_amt: '93', bav_status: 'BESTAET', pruefungserfolg: '', ...o });
const s = (ident) => App.query('SELECT * FROM schueler WHERE ibykus_id=?', [ident])[0];

console.log('══ Import: Status-Ableitung aus BAV-Status und Prüfungserfolg ══');
{
  IH._datumsFormat = 'TMJ';
  await IH.doImport([
    row({ nachname: 'Aktiv', vorname: 'Anna', ibykus_id: 'I-1' }),
    row({ nachname: 'Fertig', vorname: 'Fritz', ibykus_id: 'I-2', bav_status: 'ENDE', pruefungserfolg: '1' }),
    row({ nachname: 'Weg', vorname: 'Willi', ibykus_id: 'I-3', bav_status: 'ENDE' }),
    row({ nachname: 'Bleibt', vorname: 'Berta', ibykus_id: 'I-4' }),
  ]);
  check(s('I-1') && s('I-1').aktiv === 1 && s('I-1').status === 'aktiv', 'BESTAET → aktiv');
  const f = s('I-2');
  check(f && f.aktiv === 0 && f.status === 'ap_bestanden' && f.ap_bestanden === 1, `ENDE + bestanden → AP bestanden (${f && f.status}, ap_bestanden=${f && f.ap_bestanden})`);
  check(f && f.inaktiv_datum === '2027-08-31' && /bestanden/.test(f.inaktiv_grund), `Inaktiv ab Vertragsende mit Grund (${f && f.inaktiv_datum}, ${f && f.inaktiv_grund})`);
  const w = s('I-3');
  check(w && w.aktiv === 0 && w.status === 'abgebrochen' && w.ap_bestanden === 0, 'ENDE ohne Erfolg → abgebrochen');
}

console.log('\n══ Re-Import: laufender Vertrag wird beendet; Ident-Fallback ══');
{
  db.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?, 'nachholung','2026-10-01','offen')", [s('I-1').id]);
  await IH.doImport([
    row({ nachname: 'Aktiv', vorname: 'Anna', ibykus_id: 'I-1', bav_status: 'ENDE', pruefungserfolg: '1' }),
    // Namenstreffer mit ANDERER Ident = Neuvertrag (Betriebswechsel) → neuer Datensatz
    row({ nachname: 'Bleibt', vorname: 'Berta', ibykus_id: 'I-44', ausbildungsstaette: 'Neuer Betrieb' }),
    // Namenstreffer OHNE Ident → bestehender Datensatz
    row({ nachname: 'Weg', vorname: 'Willi', ibykus_id: '', bav_status: 'BEARB' }),
  ]);
  const a = s('I-1');
  check(a.aktiv === 0 && a.status === 'ap_bestanden' && a.ap_bestanden === 1, `Re-Import ENDE+bestanden setzt AP bestanden (${a.status})`);
  check(App.scalar("SELECT COUNT(*) FROM schueler WHERE nachname='Bleibt'") === 2, 'Namenstreffer mit anderer BAV-Ident legt einen NEUEN Vertrag an (kein Überschreiben)');
  check(s('I-4').ausbildungsstaette === 'Gärtnerei Test' && s('I-44').ausbildungsstaette === 'Neuer Betrieb', 'Alter und neuer Vertrag bleiben getrennt');
  check(/Namenstreffer mit anderer BAV-Ident \(1\)/.test(modalHtml), 'Import-Ergebnis meldet den Neuvertrag');
  check(App.scalar("SELECT COUNT(*) FROM schueler WHERE nachname='Weg'") === 1 && s('I-3').bav_status === 'BEARB', 'Zeile ohne Ident trifft den bestehenden Datensatz über den Namen');
}

console.log('\n══ Fehlende im Export ══');
{
  // Nur Berta (I-44) im Export → I-3 (aktiv? nein, ENDE→abgebrochen, aber BEARB reaktiviert → aktiv) und I-4 fehlen
  await IH.doImport([row({ nachname: 'Bleibt', vorname: 'Berta', ibykus_id: 'I-44', ausbildungsstaette: 'Neuer Betrieb' })]);
  const fehl = IH._pendingFehlende || [];
  const namen = fehl.map(id => App.scalar('SELECT ibykus_id FROM schueler WHERE id=?', [id])).sort();
  check(namen.includes('I-4') && !namen.includes('I-44') && !namen.includes('I-1') && !namen.includes('I-2'), `Aktive Azubis mit Ident, die im Export fehlen, werden gemeldet (${namen.join(', ')}); beendete nicht`);
  check(/Nicht im Export enthalten/.test(modalHtml), 'Import-Ergebnis zeigt den Block „Nicht im Export enthalten"');
}

console.log('\n══ Zentrales Status-Modell ══');
{
  const id = s('I-4').id;
  db.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?, 'post_an_rp','2026-10-01','offen')", [id]);
  let r = App.setSchuelerStatus(id, 'verlaengert');
  check(r.aktiv === 1 && s('I-4').aktiv === 1 && s('I-4').status === 'verlaengert', 'Verlängerer bleibt aktiv (früher aktiv=0)');
  r = App.setSchuelerStatus(id, 'abgebrochen', { datum: '2026-09-01', grund: 'Kündigung', wvSchliessen: true });
  const x = s('I-4');
  check(x.aktiv === 0 && x.status === 'abgebrochen' && x.inaktiv_datum === '2026-09-01' && x.inaktiv_grund === 'Kündigung', 'Beenden setzt Status, aktiv, Datum, Grund');
  check(r.wvGeschlossen === 1 && App.scalar("SELECT status FROM wiedervorlagen WHERE schueler_id=?", [id]) === 'erledigt', 'Offene Wiedervorlage wird mit Bemerkung geschlossen');
  check(App.scalar("SELECT COUNT(*) FROM aenderungslog WHERE schueler_id=? AND feld='status'", [id]) >= 1, 'Statuswechsel steht im Änderungs-Logbuch');
  App.setSchuelerStatus(id, 'aktiv');
  const y = s('I-4');
  check(y.aktiv === 1 && y.inaktiv_datum === '' && y.inaktiv_grund === '', 'Reaktivieren räumt Datum und Grund');
  check(App.setSchuelerStatus(id, 'inaktiv').aktiv === 0 && s('I-4').status === 'abgebrochen', 'Unbekannter Status „inaktiv" wird auf „abgebrochen" abgebildet');
}

console.log('\n══ Quelltext-Zusicherungen (Sammelaktionen) ══');
{
  const st = read('src/js/modules/stammdaten.js'), bs = read('src/js/modules/bulk-schueler.js'), sv = read('src/js/modules/schueler-view.js');
  check(!/BulkSchueler\.getSelected = /.test(st), 'Stammdaten überschreiben BulkSchueler.getSelected nicht mehr (Bulk-Leiste der Schülerliste)');
  check(!/status='inaktiv'/.test(st), 'Sammelaktion schreibt keinen Status „inaktiv" mehr');
  check((bs.match(/this\._refresh\(\)/g) || []).length >= 3, 'Bulk-Aktionen aktualisieren die jeweils sichtbare Liste (_refresh)');
  check(/ImportHandler\.ausbildungBeenden\(ids/.test(sv) && /ImportHandler\.ausbildungBeenden\(ids/.test(st), 'Jahrgang abschließen und Sammel-Beenden nutzen den gemeinsamen Dialog');
}

console.log('\n══ Stufe 2 (3): Import-Vorschau schreibt nichts ══');
{
  await IH.doImport([row({ nachname: 'Bestand', vorname: 'Bruno', ibykus_id: 'I-91' })]);
  const vorher = { schueler: App.scalar('SELECT COUNT(*) FROM schueler'), betriebe: App.scalar('SELECT COUNT(*) FROM betriebe'), schulen: App.scalar('SELECT COUNT(*) FROM berufsschulen'), ops: (App._bulkOps || []).length, bruno: s('I-91').ausbildungsstaette };
  const v = await IH.doImport([
    row({ nachname: 'Vorschau', vorname: 'Vera', ibykus_id: 'I-90', berufsschule: 'BS Ganz Neu', ausbildungsstaette: 'Neuer Betrieb GmbH' }),
    row({ nachname: 'Bestand', vorname: 'Bruno', ibykus_id: 'I-91', ausbildungsstaette: 'Gewechselter Betrieb', email: 'bruno@example.org' }),
  ], { vorschau: true, stumm: true });
  check(v && v.diff.neu.length === 1 && v.diff.neu[0].name === 'Vorschau, Vera', 'Vorschau erkennt den neuen Azubi');
  check(v.diff.geaendert.length === 1 && v.diff.geaendert[0].name === 'Bestand, Bruno' && v.diff.geaendert[0].felder.some(x => x.f === 'ausbildungsstaette') && v.diff.geaendert[0].felder.some(x => x.f === 'email'), `Vorschau listet geänderte Felder (${v.diff.geaendert[0]?.felder.map(x => x.f).join(', ')})`);
  check(v.stats.schulen.has('BS Ganz Neu'), 'Vorschau nennt anzulegende Schulen');
  check(!s('I-90') && s('I-91').ausbildungsstaette === vorher.bruno, 'Nichts geschrieben: neuer Azubi fehlt, Bruno unverändert');
  check(App.scalar('SELECT COUNT(*) FROM schueler') === vorher.schueler && App.scalar('SELECT COUNT(*) FROM betriebe') === vorher.betriebe && App.scalar('SELECT COUNT(*) FROM berufsschulen') === vorher.schulen, 'Auch Betriebe/Schulen der Vorschau sind zurückgerollt');
  check((App._bulkOps || []).length === vorher.ops && App._bulkImport === false, 'Keine Bulk-Ops aus der Vorschau, Import-Modus wieder aus');
  await IH.doImport(v.data);
  check(!!s('I-90') && s('I-91').ausbildungsstaette === 'Gewechselter Betrieb', '„Jetzt importieren" schreibt denselben Stand');
  const IMP_SRC = read('src/js/modules/import-handler.js');
  check(/ImportHandler\.doImportVorschau\(window\._importData\)/.test(IMP_SRC) && /SAVEPOINT bhk_vorschau/.test(IMP_SRC) && /ROLLBACK TO bhk_vorschau/.test(IMP_SRC), 'Import-Schaltfläche führt über die Vorschau (Savepoint + Rollback)');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
