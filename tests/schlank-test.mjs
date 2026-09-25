// ═══════════════════════════════════════════════════════════════════
//  Schlanke Datei: kompakte Durchsichts-Snapshots (Schreiber, Leser für
//  alte und neue Fassung, Verdichtung im Aufräumen), kompakte Sync-Stempel
//  mit Obergrenze, Änderungslog ohne Import-Flut
//  Ausführen:  node tests/schlank-test.mjs
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
const DBT_SRC = read('src/js/modules/db-tools.js');
const KONTROLLE_SRC = read('src/js/modules/kontrolle.js');
const NACH_SRC = read('src/js/modules/nacherfassung.js');
const IMPORT_SRC = read('src/js/modules/import-handler.js');

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, checked: false, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(DBT_SRC + '\n;globalThis.DbTools = DbTools;', sandbox, { filename: 'db-tools.js' });
const { __App: App, DbTools: T } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App._sqlJsFactory = SQL; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.db.run("INSERT INTO schueler (id,nachname,vorname) VALUES (1,'Adler','Anna'),(2,'Birke','Bernd')");
App.db.run("INSERT INTO kontrolltermine (id,geplant_datum) VALUES (10,'2026-05-05')");
App.db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id) VALUES (100,10,1),(101,10,2)");
// 150 Wochenzeilen je Azubi, 12 davon mit Inhalt
for (const sid of [1, 2]) for (let aj = 1; aj <= 3; aj++) for (let kw = 1; kw <= 50; kw++) App.db.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,bemerkung,erstellt_bei) VALUES (?,?,?,?,?,?,1,?,?)', [sid, aj, kw, kw % 25 === 0 ? 'A,C' : '', kw === 10 ? 'B' : '', kw === 11 ? 2 : 0, kw === 12 && aj === 1 ? 'Nachtrag' : '', 100]);

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const cnt = (sql, p) => App.scalar(sql, p || []);

console.log('══ Kompakter Snapshot: Schreiben und Lesen ══');
{
  const rows = App.query('SELECT * FROM kw_status WHERE schueler_id=1');
  const alt = JSON.stringify(rows);
  const neu = App.snapshotKompakt(rows);
  const d = JSON.parse(neu);
  check(d.v === 2 && d.n === 150 && Array.isArray(d.z), 'Neue Fassung mit Version, Zeilenzahl und Tupeln');
  const mitInhalt = rows.filter(r => r.maengel_codes || r.behobene_codes || r.fehltage || r.bemerkung).length;
  check(d.z.length === mitInhalt && mitInhalt === 13, `Nur Wochen mit Inhalt (${d.z.length} von 150)`);
  check(neu.length < alt.length / 10, `Unter einem Zehntel der alten Größe (${neu.length} statt ${alt.length} Bytes)`);
  const z = App.snapshotZeilen(neu);
  const zAlt = App.snapshotZeilen(alt);
  const wesentlich = (r) => `${r.ausbildungsjahr}|${r.kalenderwoche}|${r.maengel_codes || ''}|${r.behobene_codes || ''}|${Number(r.fehltage) || 0}|${r.bemerkung || ''}`;
  check(z.map(wesentlich).join(';') === zAlt.filter(r => r.maengel_codes || r.behobene_codes || r.fehltage || r.bemerkung).map(wesentlich).join(';'), 'Leser liefert aus der neuen Fassung dieselben Wochen mit Inhalt wie aus der alten');
  check(zAlt.length === 150 && z.every(r => r.geprueft === 1), 'Alte Fassung wird unverändert gelesen, neue Zeilen gelten als geprüft');
  check(z.find(r => r.kalenderwoche === 12 && r.ausbildungsjahr === 1).bemerkung === 'Nachtrag' && z.find(r => r.kalenderwoche === 11).fehltage === 2, 'Bemerkung und Fehltage bleiben erhalten');
  check(App.snapshotZeilen('kaputt').length === 0 && App.snapshotZeilen(null).length === 0 && App.snapshotZeilen({ kw_daten_json: '{}' }).length === 0, 'Unlesbare oder leere Inhalte ergeben eine leere Liste');
  check(App.snapshotIstAlt(alt) && !App.snapshotIstAlt(neu) && !App.snapshotIstAlt(''), 'Erkennung der alten Fassung');
  check(App.snapshotKompakt([]) === '{"v":2,"n":0,"z":[]}', 'Leeres Raster ergibt leeren Snapshot');
}

console.log('══ Schreiber und Leser im Code ══');
{
  check((KONTROLLE_SRC.match(/App\.snapshotKompakt\(kwRows\)/g) || []).length === 2 && !/JSON\.stringify\(kwRows\)/.test(KONTROLLE_SRC), 'Kontrolle schreibt beide Wege (INSERT und UPDATE) kompakt');
  check(/App\.snapshotKompakt\(kwRows\)/.test(NACH_SRC) && !/JSON\.stringify\(kwRows\)/.test(NACH_SRC), 'Nacherfassung schreibt kompakt');
  check((KONTROLLE_SRC.match(/App\.snapshotZeilen\(snap\)/g) || []).length === 2 && !/JSON\.parse\(snap\.kw_daten_json/.test(KONTROLLE_SRC), 'Archiv-Ansicht und Archiv-PDF lesen über den gemeinsamen Leser');
}

console.log('══ Aufräumen: Snapshots alter Fassung verdichten ══');
{
  const rows1 = App.query('SELECT * FROM kw_status WHERE schueler_id=1'), rows2 = App.query('SELECT * FROM kw_status WHERE schueler_id=2');
  App.db.run("INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json) VALUES (500,100,1,'2026-05-05',?)", [JSON.stringify(rows1)]);
  App.db.run("INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json) VALUES (501,101,2,'2026-05-05',?)", [App.snapshotKompakt(rows2)]);
  check(T.AUFRAEUMEN_OPTIONEN.snapshots && T.AUFRAEUMEN_OPTIONEN.snapshots.standard === true, 'Option „Snapshots verdichten“ ist Standard');
  const v = T.aufraeumenVorschau({ snapshots: true });
  const p = v.posten.find(x => x.key === 'snapshots');
  check(p && p.n === 1 && /KB|MB|B\)/.test(p.label) && v.snapshotBytes > 10000, `Vorschau zählt einen Snapshot alter Fassung (${p && p.label})`);
  const vorher = cnt('SELECT LENGTH(kw_daten_json) FROM durchsicht_snapshots WHERE id=500');
  const r = T._aufraeumenAusfuehren({ waisen: false, sitzungen: false, klassen: false, blockplan: false, log: false, importDetails: false, stamps: false, snapshots: true, betriebe: false, papierkorb: false });
  const nachher = cnt('SELECT LENGTH(kw_daten_json) FROM durchsicht_snapshots WHERE id=500');
  check(r.snapshots === 1 && nachher < vorher / 10, `Ein Snapshot verdichtet (${vorher} → ${nachher} Bytes)`);
  const z = App.snapshotZeilen(App.query('SELECT kw_daten_json FROM durchsicht_snapshots WHERE id=500')[0].kw_daten_json);
  check(z.length === 13 && z.some(r => r.maengel_codes === 'A,C'), 'Inhalt nach der Verdichtung vollständig lesbar');
  check(T.aufraeumenVorschau({ snapshots: true }).posten.find(x => x.key === 'snapshots').n === 0, 'Zweiter Lauf findet nichts mehr');
  check(cnt("SELECT COUNT(*) FROM durchsicht_snapshots WHERE kw_daten_json LIKE '{%'") === 2, 'Beide Snapshots liegen in der neuen Fassung');
}

console.log('══ Kompakte Sync-Stempel ══');
{
  App._rowStamps = new Map();
  App._notiereStamp('UPDATE schueler SET telefon=? WHERE id=?', ['1', 1], 1758000000000, 'client-AAAA', 5);
  App._notiereStamp('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [1, 1, 5, 'A', 0, 100], 1758000001000, 'client-BBBBt1x2', 7);
  App._stampsSpeichern();
  const rows = App.query('SELECT k, v FROM bhk_stamps ORDER BY k');
  check(rows.length === 2 && rows.every(r => !r.v.startsWith('{')) && /^maengel_codes=1758000001000,client-BBBBt1x2,7;fehltage=/.test(rows.find(r => r.k.startsWith('kw_status')).v), `Stempel als kompakter Text abgelegt (${rows.find(r => r.k.startsWith('kw_status')).v.slice(0, 60)}…)`);
  const alt = new Map(App._rowStamps);
  App._rowStamps = new Map();
  check(App._stampsLaden() === 2 && JSON.stringify([...App._rowStamps]) === JSON.stringify([...alt]), 'Laden stellt exakt dieselben Stempel her');
  // Alte JSON-Fassung wird weiter gelesen
  App.db.run("INSERT INTO bhk_stamps (k,v) VALUES ('schueler|id:9','{\"telefon\":{\"ts\":1700000000000,\"c\":\"client-CCCC\",\"seq\":1}}')");
  App._rowStamps = new Map();
  check(App._stampsLaden() === 3 && App._rowStamps.get('schueler|id:9').telefon.c === 'client-CCCC', 'Alte JSON-Stempel werden weiter gelesen');
  const jsonLaenge = JSON.stringify(alt.get('schueler|id:1')).length, textLaenge = App._stampText(alt.get('schueler|id:1')).length;
  check(textLaenge < jsonLaenge * 0.7, `Text spart Platz (${textLaenge} statt ${jsonLaenge} Zeichen)`);
  // Obergrenze: nur die jüngsten STAMPS_MAX Zeilen
  App._rowStamps = new Map();
  for (let i = 0; i < App.STAMPS_MAX + 500; i++) App._rowStamps.set('t|id:' + i, { x: { ts: 1000 + i, c: 'a', seq: i } });
  App._stampsSpeichern();
  check(cnt('SELECT COUNT(*) FROM bhk_stamps') === App.STAMPS_MAX && cnt("SELECT COUNT(*) FROM bhk_stamps WHERE k='t|id:0'") === 0 && cnt("SELECT COUNT(*) FROM bhk_stamps WHERE k='t|id:" + (App.STAMPS_MAX + 499) + "'") === 1, `Höchstens ${App.STAMPS_MAX} Stempel im Snapshot, die ältesten fallen weg`);
  check(App.STAMPS_MAX === 20000 && /this\.STAMPS_MAX \* 2\) this\._stampsEindampfen\(\)/.test(APP_SRC) && !/this\._rowStamps\.clear\(\)/.test(APP_SRC), 'Speicher-Obergrenze folgt STAMPS_MAX (verdrängen, nie alles verwerfen)');
}

console.log('══ Änderungslog ohne Import-Flut ══');
{
  check(/vonHand/.test(IMPORT_SRC) && /stammdaten_bearbeitet/.test(IMPORT_SRC.split('_logUeberschrieben(schuelerId, field, oldVal, newVal) {')[1].split('},')[0]), 'Import loggt Überschreibungen nur nach manueller Änderung');
  App.logChange = (sid, feld, alt, neu, aktion) => App.db.run("INSERT INTO aenderungslog (schueler_id,feld,alter_wert,neuer_wert,aktion) VALUES (?,?,?,?,?)", [sid, feld, String(alt), String(neu), aktion]);
  const ImportHandler = { _logUeberschrieben: null };
  vm.runInContext('globalThis.__f = (' + IMPORT_SRC.split('_logUeberschrieben(schuelerId, field, oldVal, newVal) {')[1].split('\n  },')[0].replace(/^/, 'function(schuelerId, field, oldVal, newVal) {') + '\n})', sandbox);
  ImportHandler._logUeberschrieben = sandbox.__f;
  ImportHandler._logUeberschrieben(1, 'email', 'a@x', 'b@x');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='import_ueberschrieben'") === 0, 'Ohne manuelle Vorgeschichte: kein Logeintrag');
  App.logChange(1, 'email', 'alt@x', 'a@x', 'stammdaten_bearbeitet');
  ImportHandler._logUeberschrieben(1, 'email', 'a@x', 'b@x');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='import_ueberschrieben' AND feld='email'") === 1, 'Nach manueller Änderung desselben Feldes: Überschreibung wird geloggt');
  ImportHandler._logUeberschrieben(1, 'telefon', '1', '2');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='import_ueberschrieben'") === 1, 'Anderes Feld ohne Vorgeschichte: kein Eintrag');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
