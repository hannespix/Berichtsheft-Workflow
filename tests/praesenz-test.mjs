// ═══════════════════════════════════════════════════════════════════
//  Präsenz: „Wer arbeitet gerade?“ – Lebenszeichen-Dateien je Rechner,
//  Online-Erkennung, Drosselung, Aufräumen, Anzeige in der Kopfzeile
//  Ausführen:  node tests/praesenz-test.mjs
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

// ── Fake-Verzeichnis (File System Access API, nur was die Präsenz braucht) ──
const store = new Map(); // name → { data, mtime }
let schreibZugriffe = 0;
const fakeDir = {
  async getFileHandle(name, opts) {
    if (!store.has(name)) { if (!(opts && opts.create)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; } store.set(name, { data: '', mtime: Date.now() }); }
    return {
      kind: 'file',
      async getFile() { const f = store.get(name); return { lastModified: f.mtime, size: f.data.length, async text() { return f.data; } }; },
      async createWritable() { let buf = ''; return { async write(d) { buf = String(d); }, async close() { schreibZugriffe++; store.set(name, { data: buf, mtime: Date.now() }); } }; },
    };
  },
  async removeEntry(name) { store.delete(name); },
  async *entries() { for (const name of [...store.keys()]) yield [name, await this.getFileHandle(name)]; },
};

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
let modalHtml = '';
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
const App = sandbox.__App;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.openModal = (t, html, footer) => { modalHtml = String(html) + String(footer || ''); }; App.closeModal = () => {};
App.dirHandle = fakeDir; App.bhkDirHandle = fakeDir; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.currentView = 'planung'; App.currentUser = 'Anna';

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const setFeldmodus = (v) => Object.defineProperty(App, 'feldmodus', { value: v, configurable: true, writable: true });
setFeldmodus(false);
const now = Date.now();
const eintrag = (c, p, v, ts) => JSON.stringify({ c, p, v, ts, seit: ts - 600000, fm: false });

console.log('══ Schalter: Kollegen-Anzeige standardmäßig aus ══');
{
  check(App.kollegenAn() === false, 'Ohne Einstellung ist die Kollegen-Anzeige aus');
  check(await App._praesenzTakt(true) === false && schreibZugriffe === 0, 'Kein Lebenszeichen, solange ausgeschaltet');
  App.db.run("INSERT INTO einstellungen (schluessel,wert) VALUES ('kollegen_anzeige','1')"); App._kollegenCache = null;
  check(App.kollegenAn() === true, 'Einstellung kollegen_anzeige=1 schaltet ein');
  App.setKollegenAnzeige(false); check(App.kollegenAn() === false && App.onlineNutzer().length === 0, 'setKollegenAnzeige(false) schaltet aus, niemand gilt als online');
  App.setKollegenAnzeige(true); check(App.kollegenAn() === true, 'setKollegenAnzeige(true) schaltet wieder ein');
  // Das Einschalten stößt ein Lebenszeichen an – abwarten, sonst kollidiert der nächste Takt damit
  for (let i = 0; i < 50 && App._praesenzLaeuft; i++) await new Promise(r => setImmediate(r));
  App._praesenzLetzte = 0; store.clear(); schreibZugriffe = 0;
}

console.log('══ Schreiben & Lesen ══');
{
  store.set('praesenz_test_client-BBBB.json', { data: eintrag('client-BBBB', 'Bernd', 'kontrolle', now - 20000), mtime: now - 20000 });
  store.set('praesenz_test_client-CCCC.json', { data: eintrag('client-CCCC', '', 'berichte', now - 10 * 60000), mtime: now - 10 * 60000 });
  store.set('praesenz_test_client-DDDD.json', { data: eintrag('client-DDDD', 'Dora', 'planung', now - 2 * 86400000), mtime: now - 2 * 86400000 });
  store.set('praesenz_andereDb_client-EEEE.json', { data: eintrag('client-EEEE', 'Emil', 'planung', now), mtime: now });
  store.set('oplog_test_client-BBBB_g1.jsonl', { data: '', mtime: now });
  const ok = await App._praesenzTakt(true);
  check(ok === true, 'Erzwungener Takt läuft durch');
  const eigen = store.get('praesenz_test_client-AAAA.json');
  const d = eigen && JSON.parse(eigen.data);
  check(d && d.c === 'client-AAAA' && d.p === 'Anna' && d.v === 'planung' && Math.abs(d.ts - Date.now()) < 5000 && d.seit <= d.ts, 'Eigene Präsenzdatei mit Prüfer, Ansicht, Zeitstempel und Sitzungsbeginn');
  const on = App.onlineNutzer();
  check(on.length === 1 && on[0].name === 'Bernd' && on[0].view === 'kontrolle', 'Bernd (20 s alt) ist online');
  check(App._praesenzAndere.length === 2 && App._praesenzAndere.find(a => a.client === 'client-CCCC' && !a.online), 'Rechner C (10 min alt) bekannt, aber nicht online');
  check(!store.has('praesenz_test_client-DDDD.json'), 'Datei älter als 24 h wird entfernt');
  check(!App._praesenzAndere.find(a => a.client === 'client-EEEE') && store.has('praesenz_andereDb_client-EEEE.json'), 'Präsenz anderer Datenbanken wird ignoriert und nicht angefasst');
  check(!App._praesenzAndere.find(a => a.client === 'client-AAAA'), 'Eigene Datei zählt nicht als anderer Nutzer');
  check(App.onlineNutzerText() === 'Bernd (Kontrolle)', `Kurztext: „${App.onlineNutzerText()}“`);
  check(App._praesenzLabel(App._praesenzAndere.find(a => a.client === 'client-CCCC')) === 'Rechner CCCC', 'Ohne Prüfername: Rechner-Kürzel');
  const e = elemente.onlineNutzer;
  check(e && e.style.display === '' && /dot-green/.test(e.innerHTML) && /Bernd/.test(e.innerHTML) && /Kontrolle/.test(e.title), 'Kopfzeile zeigt Bernd mit grünem Punkt und Tooltip');
}

console.log('══ Drosselung & Sperren ══');
{
  const vorher = schreibZugriffe;
  check(await App._praesenzTakt(false) === false && schreibZugriffe === vorher, 'Direkt danach kein zweiter Schreibzugriff (Takt 30 s)');
  App._praesenzDirty = true;
  check(await App._praesenzTakt(false) === false && schreibZugriffe === vorher, 'Ansichtswechsel schreibt nicht sofort (Mindestabstand 5 s)');
  App._praesenzLetzte = Date.now() - 6000;
  check(await App._praesenzTakt(false) === true && schreibZugriffe === vorher + 1 && App._praesenzDirty === false, 'Ansichtswechsel nach 6 s wird geschrieben, Merker zurückgesetzt');
  App._praesenzLetzte = Date.now() - 40000;
  check(await App._praesenzTakt(false) === true, 'Nach 40 s regulärer Takt');
  setFeldmodus(true); App._praesenzLetzte = Date.now() - 40000;
  check(await App._praesenzTakt(false) === false, 'Feldmodus: 40 s reichen nicht (Takt 60 s)');
  App._praesenzLetzte = Date.now() - 61000;
  check(await App._praesenzTakt(false) === true, 'Feldmodus: nach 61 s');
  setFeldmodus(false);
  App._netzWeg = true; check(await App._praesenzTakt(true) === false, 'Netzabriss: keine Präsenz'); App._netzWeg = false;
  App.offlineModus = true; check(await App._praesenzTakt(true) === false, 'Offline-Modus: keine Präsenz'); App.offlineModus = false;
  const dh = App.dirHandle; App.dirHandle = null; check(await App._praesenzTakt(true) === false, 'Ohne Ordner: keine Präsenz'); App.dirHandle = dh;
}

console.log('══ Online-Wechsel & Dialog ══');
{
  store.set('praesenz_test_client-BBBB.json', { data: eintrag('client-BBBB', 'Bernd', 'kontrolle', Date.now() - 4 * 60000), mtime: Date.now() - 4 * 60000 });
  await App._praesenzTakt(true);
  check(App.onlineNutzer().length === 0 && elemente.onlineNutzer.style.display === 'none', 'Bernd nach 4 min ohne Lebenszeichen nicht mehr online, Kopfzeile leer');
  App.onlineNutzerDialog();
  check(/Bernd/.test(modalHtml) && /vor 4 min/.test(modalHtml) && /Rechner CCCC/.test(modalHtml) && /Ich: Anna/.test(modalHtml), 'Dialog listet zuletzt gesehene Rechner mit Zeit und den eigenen Stand');
  store.set('praesenz_test_client-BBBB.json', { data: eintrag('client-BBBB', 'Bernd', 'wiedervorlagen', Date.now()), mtime: Date.now() });
  store.set('praesenz_test_client-FFFF.json', { data: eintrag('client-FFFF', 'Frida', 'import', Date.now()), mtime: Date.now() });
  await App._praesenzTakt(true);
  check(App.onlineNutzer().length === 2 && /Bernd, Frida|Frida, Bernd/.test(elemente.onlineNutzer.innerHTML), 'Zwei Nutzer online → beide Namen in der Kopfzeile');
}

console.log('══ Einbau ══');
{
  check(/await this\._praesenzTakt\(false\)/.test(APP_SRC.split('this._schedulePoll = () => {')[1] || ''), 'Präsenz hängt am Abgleich-Timer (kein eigener Timer)');
  check(/switchUser\(name\) \{\n    this\.currentUser = name;\n    this\._praesenzDirty = true;/.test(APP_SRC) && /if \(view !== this\.currentView\) this\._praesenzDirty = true;/.test(APP_SRC), 'Prüferwechsel und Ansichtswechsel merken sich als Änderung');
  check(/App\._praesenzDirty = true;/.test(read('src/js/modules/kontrolle.js')), 'Aktiver Prüfer in der Kontrolle meldet sich');
  check(/id="onlineNutzer"/.test(read('index.html')) && /App\.onlineNutzerDialog\(\)/.test(read('index.html')), 'Kopfzeile hat die Anzeige mit Klick auf den Dialog');
  check(/Gerade online:/.test(read('src/js/modules/views.js')), 'Einstellungen → Verbindung zeigt die Online-Liste');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
