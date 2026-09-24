// ═══════════════════════════════════════════════════════════════════
//  Sehr langsame Freigabe: hängende Anhänge-Versuche stapeln sich nicht,
//  später Erfolg wird verbucht, Zeitlimit ist kein Netzabriss, wachsende
//  Wartezeit, kein Abgleich/Anhängen während des Snapshot-Writes
//  Ausführen:  node tests/langsam-test.mjs
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

// ── Fake-Laufwerk: createWritable kann „hängen“ (Promise wird von außen aufgelöst) ──
const enc = new TextEncoder(), dec = new TextDecoder();
const store = new Map();
let haenger = null;          // { resolve, reject } des gerade hängenden createWritable
let haengeModus = false;     // true → nächstes createWritable hängt
let createWritableAufrufe = 0;
const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
const handle = (n) => ({
  kind: 'file', name: n,
  async getFile() { const f = store.get(n); if (!f) throw nf(); return { size: f.data.length, lastModified: f.mtime, async text() { return dec.decode(f.data); }, slice(von) { const t = f.data.slice(von); return { async text() { return dec.decode(t); } }; } }; },
  async createWritable(opts) {
    createWritableAufrufe++;
    if (haengeModus) { haengeModus = false; await new Promise((resolve, reject) => { haenger = { resolve, reject }; }); }
    let buf = (opts && opts.keepExistingData && store.has(n)) ? store.get(n).data : new Uint8Array(0);
    return {
      async write(x) { if (x && x.type === 'write') { const d = x.data; const neu = new Uint8Array(Math.max(buf.length, x.position + d.length)); neu.set(buf.slice(0, x.position)); neu.set(d, x.position); buf = neu; } else buf = x instanceof Uint8Array ? new Uint8Array(x) : enc.encode(String(x)); },
      async close() { store.set(n, { data: buf, mtime: Date.now() }); },
      async abort() {},
    };
  },
});
const fakeDir = {
  async getFileHandle(n, o) { if (!store.has(n)) { if (!(o && o.create)) throw nf(); store.set(n, { data: new Uint8Array(0), mtime: Date.now() }); } return handle(n); },
  async removeEntry(n) { store.delete(n); },
  async *entries() { for (const k of [...store.keys()]) yield [k, handle(k)]; },
};

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const timer = []; // aufgeschobene Timer: [fn, ms]
const toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: (f, ms) => { if (typeof f !== 'function') return 0; timer.push([f, ms || 0]); return timer.length; }, clearTimeout() {},
  setInterval: () => 0, clearInterval() {},
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
vm.runInContext(APP_SRC + '\n;globalThis.__App = App; globalThis.__Spur = BhkSpur;', sandbox, { filename: 'app-core.js' });
const { __App: App, __Spur: Spur } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]); App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = () => {}; App.closeModal = () => {}; App.renderCurrentView = () => {}; App._smartRefresh = () => {}; App._broadcastChange = () => {};
App._persistDirtyOps = async () => {}; App._updateNetworkUI = () => {};
App.dirHandle = fakeDir; App.bhkDirHandle = fakeDir; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.dbFileHandle = { name: 'test.sqlite', async getFile() { return { size: 4096, lastModified: Date.now() }; } };
App._v3Ready = true; App._ownLogUids = new Set(); App._logOffsets = {}; App._myLogSize = 0; App._lastCompactCheck = Date.now(); App._netzWeg = false;
App.db.run("INSERT INTO schueler (id,nachname,vorname) VALUES (1,'Adler','Anna'),(2,'Birke','Bernd')");

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const tick = () => new Promise(r => setImmediate(r));
const ruhe = async () => { for (let i = 0; i < 30; i++) await tick(); };
// Timer-Helfer: den Timeout-Timer (ms >= 30000) feuern bzw. alle kurzen Timer laufen lassen
const feuere = (pred) => { const i = timer.findIndex(([, ms]) => pred(ms)); if (i < 0) return false; const [f] = timer.splice(i, 1)[0]; f(); return true; };
const logZeilen = () => { const f = store.get(App._myOplogName()); return f ? dec.decode(f.data).split('\n').filter(Boolean) : []; };
const op = (tel, id) => { App._dirtyOps.push({ uid: 'u' + tel + '_' + id, ts: Date.now(), seq: App._dirtyOps.length + 1, sql: 'UPDATE schueler SET telefon=? WHERE id=?', params: [tel, id], sid: id }); App._ungesichertAzubis.add(id); };

console.log('══ Zeitlimit und Wartezeit ══');
{
  App._lastAppendMs = 0;
  check(App.appendTimeoutMs() === 30000, 'Zeitlimit mindestens 30 s');
  App._lastAppendMs = 20000; check(App.appendTimeoutMs() === 70000, 'Zeitlimit wächst mit der letzten Dauer (3× + 10 s)');
  App._lastAppendMs = 100000; check(App.appendTimeoutMs() === 180000, 'Zeitlimit höchstens 180 s');
  App._lastAppendMs = 0;
  App._langsamStufe = 1; check(App.langsamWartezeitMs() === 15000, 'Wartezeit Stufe 1: 15 s');
  App._langsamStufe = 3; check(App.langsamWartezeitMs() === 60000, 'Stufe 3: 60 s');
  App._langsamStufe = 6; check(App.langsamWartezeitMs() === 300000, 'Höchstens 5 min');
  App._langsamStufe = 0;
  check(!App._istVerbindungsFehler(new Error('Oplog-Append Timeout')), 'Zeitlimit ist kein Verbindungsfehler mehr');
}

console.log('══ Hängender Versuch: kein Stapeln, später Erfolg ══');
{
  op('1', 1); op('2', 2);
  haengeModus = true; timer.length = 0;
  const p = App._saveV3();
  await ruhe();
  check(createWritableAufrufe === 1 && App._appendInProgress === true, 'Erster Versuch hängt in createWritable');
  check(feuere(ms => ms >= 30000), 'Zeitlimit-Timer vorhanden und gefeuert');
  await p; await ruhe();
  check(App._appendHaengt !== null && App._appendInProgress === false && App._dirtyOps.length === 2, 'Nach dem Zeitlimit: Versuch gilt als hängend, Ops liegen wieder im Puffer');
  check(App._netzLangsam === true && App._langsamStufe === 1 && App._netzWeg === false && App._verbFehler === 0, 'Zustand „sehr langsam“, KEIN Netzabriss');
  check(/sehr langsam/.test(toasts.at(-1)[0]), 'Einmaliger Hinweis');
  check(/Langsam · 2 wartend/.test(el('dbStatusIndicator').innerHTML), 'Statusanzeige „Langsam · n wartend“');
  check(timer.some(([, ms]) => ms === 15000), 'Sicherheitsnetz: erneuter Versuch nach 15 s eingeplant');
  const aufrufe = createWritableAufrufe;
  op('3', 1);
  await App._saveV3(); await ruhe();
  check(createWritableAufrufe === aufrufe && Spur.liste('anhaengen').some(e => /hängt noch/.test(e.info || '')), 'Zweiter Versuch startet KEIN neues createWritable, sondern wartet');
  // Abgleich-Takt setzt aus, solange der Versuch hängt
  const takt = APP_SRC.split('this._schedulePoll = () => {')[1];
  check(/!this\._appendHaengt/.test(takt) && /Anhängen hängt/.test(takt), 'Abgleich-Takt setzt bei hängendem Anhängen aus');
  // Der hängende Versuch kommt doch durch
  haenger.resolve(); await ruhe(); await ruhe();
  check(App._appendHaengt === null && logZeilen().length === 2, 'Später Erfolg: beide Ops stehen genau einmal im Protokoll');
  check(App._dirtyOps.length === 1 && App._dirtyOps[0].uid === 'u3_1', 'Nur die danach gekommene Op wartet noch');
  check(App._ownLogUids.has('u1_1') && App._ownLogUids.has('u2_2') && App._myLogSize === store.get(App._myOplogName()).data.length, 'Kennungen als geschrieben verbucht, Dateigröße stimmt');
  check(App._netzLangsam === false && App._langsamStufe === 0 && !App._ungesichertAzubis.has(2) && App._ungesichertAzubis.has(1), 'Langsam-Zustand aufgehoben, Azubi 2 gesichert, Azubi 1 wartet noch');
  check(Spur.liste('anhaengen').some(e => /nachträglich gelungen/.test(e.was)), 'Spur: nachträglich gelungen');
  check(timer.some(([, ms]) => ms === 500), 'Nächster Versuch für die wartende Op eingeplant');
  await App._saveV3(); await ruhe();
  check(App._dirtyOps.length === 0 && logZeilen().length === 3, 'Wartende Op wird danach normal angehängt – kein Duplikat');
}

console.log('══ Hängender Versuch scheitert endgültig ══');
{
  op('4', 2); haengeModus = true; timer.length = 0;
  const p = App._saveV3(); await ruhe(); feuere(ms => ms >= 30000); await p; await ruhe();
  const stufe = App._langsamStufe;
  haenger.reject(Object.assign(new Error('Failed'), { name: 'UnknownError' })); await ruhe();
  check(App._appendHaengt === null && App._dirtyOps.length === 1 && stufe === 1, 'Scheitert der hängende Versuch, bleibt die Op im Puffer');
  check(Spur.liste('anhaengen').some(e => /Hängendes Anhängen gescheitert/.test(e.was)), 'Spur nennt das Scheitern');
  haengeModus = true; timer.length = 0;
  App._saveV3(); await ruhe(); feuere(ms => ms >= 30000); await ruhe();
  check(App._langsamStufe === 2 && timer.some(([, ms]) => ms === 30000), 'Zweites Zeitlimit: Wartezeit verdoppelt auf 30 s');
  haenger && haenger.resolve(); await ruhe(); await ruhe();
  check(App._dirtyOps.length === 0 && logZeilen().length === 4, 'Am Ende ist alles genau einmal geschrieben');
}

console.log('══ Snapshot-Write: Anhängen und Abgleich warten ══');
{
  App._snapshotSchreibt = true; timer.length = 0; const aufrufe = createWritableAufrufe;
  op('5', 1);
  await App._saveV3();
  check(createWritableAufrufe === aufrufe && App._dirtyOps.length === 1 && timer.some(([, ms]) => ms === 5000), 'Während des Snapshot-Writes kein Anhängen, Versuch in 5 s');
  const takt = APP_SRC.split('this._schedulePoll = () => {')[1];
  check(/!this\._snapshotSchreibt/.test(takt) && /Snapshot wird geschrieben/.test(takt), 'Abgleich-Takt setzt während des Snapshot-Writes aus');
  const kompakt = APP_SRC.split('  async _compact(reason) {')[1].split('  async _lockNochMeins() {')[0];
  check(/this\._snapshotSchreibt = true;/.test(kompakt) && /finally \{\n      if \(herzschlag\) clearInterval\(herzschlag\);\n      this\._snapshotSchreibt = false;/.test(kompakt), 'Kompaktierung setzt und löscht die Markierung (auch im Fehlerfall)');
  App._snapshotSchreibt = false;
  await App._saveV3(); await ruhe();
  check(App._dirtyOps.length === 0, 'Danach wird angehängt');
  App.wartendeAenderungenDialog && (App.openModal = (t, h) => { sandbox.__modal = String(h); });
  App._netzLangsam = true; App._langsamStufe = 2; op('6', 1); App.wartendeAenderungenDialog();
  check(/sehr langsam/.test(sandbox.__modal) && /30 s/.test(sandbox.__modal), 'Liste der wartenden Änderungen nennt die Wartezeit');
  const d = App.diagnose();
  check('netzLangsam' in d.verbindung && 'anhaengenHaengt' in d.verbindung, 'Zustandsbild kennt beide Zustände');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
