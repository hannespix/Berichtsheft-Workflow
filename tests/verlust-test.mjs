// ═══════════════════════════════════════════════════════════════════
//  Verlustschutz: Absturzpuffer ohne Verzögerung (gebündelt), sofortiges
//  Anhängen beim Abschluss eines Berichtshefts, Kennzeichen „noch nicht auf
//  dem Netzlaufwerk“ je Azubi, Wächter gegen Hängen, Liste der wartenden
//  Änderungen
//  Ausführen:  node tests/verlust-test.mjs
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
const KONTROLLE_SRC = read('src/js/modules/kontrolle.js');

// ── Fake-Netzlaufwerk (Anhängen mit position + keepExistingData) ──
const enc = new TextEncoder(), dec = new TextDecoder();
const store = new Map();
let schreibFehler = null;
const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
const handle = (n) => ({
  kind: 'file', name: n,
  async getFile() { const f = store.get(n); if (!f) throw nf(); return { size: f.data.length, lastModified: f.mtime, async text() { return dec.decode(f.data); }, slice(von) { const t = f.data.slice(von); return { async text() { return dec.decode(t); } }; } }; },
  async createWritable(opts) {
    if (schreibFehler) throw schreibFehler;
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

// ── Fake-IndexedDB: nur was _persistDirtyOps / _getIDB brauchen ──
const idbStore = new Map();
let idbPuts = 0;
const fakeIDB = {
  open() {
    const req = {};
    const db = {
      objectStoreNames: { contains: () => true },
      transaction() { return { objectStore() { return { put(rec) { idbPuts++; idbStore.set(rec.id, rec); }, delete(k) { idbStore.delete(k); }, get(k) { const r = {}; setImmediate(() => { r.result = idbStore.get(k); r.onsuccess && r.onsuccess(); }); return r; } }; } }; },
    };
    setImmediate(() => { req.result = db; req.onsuccess && req.onsuccess(); });
    return req;
  },
};

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, an) { an ? this._s.add(c) : this._s.delete(c); } }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const docHandler = {};
const timer = []; let zeitQueue = false;
const speicher = {};
const toasts = [];
let modal = { titel: '', html: '', footer: '' };
const sandbox = {
  console: { log() {}, warn: (...a) => (sandbox.__warns = sandbox.__warns || []).push(a.join(' ')), error() {} },
  setTimeout: (f, ms) => { if (typeof f !== 'function') return 0; if ((ms || 0) >= 1000) return 0; if (zeitQueue) { timer.push(f); return timer.length; } f(); return 0; }, clearTimeout() {}, // Auto-Save-Timer (≥ 1 s) feuern im Test nie – geschrieben wird über sofortSpeichern
  setInterval: (f, ms) => { (sandbox.__intervalle = sandbox.__intervalle || []).push({ f, ms }); return sandbox.__intervalle.length; }, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener(art, fn) { docHandler[art] = fn; }, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } },
  indexedDB: fakeIDB,
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, PDFExport: {}, KWNav: {}, WiedervorlagenHandler: {}, NacherfassungHandler: {}, Workflows: {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App; globalThis.__Spur = BhkSpur;', sandbox, { filename: 'app-core.js' });
vm.runInContext(KONTROLLE_SRC + '\n;globalThis.KontrolleHandler = KontrolleHandler;', sandbox, { filename: 'kontrolle.js' });
const { __App: App, __Spur: Spur, KontrolleHandler: K } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]); App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = (t, html, footer) => { modal = { titel: String(t), html: String(html), footer: String(footer || '') }; }; App.closeModal = () => {};
App.renderCurrentView = () => {}; App._smartRefresh = () => {}; App._broadcastChange = () => {};
App.dirHandle = fakeDir; App.bhkDirHandle = fakeDir; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.dbFileHandle = { name: 'test.sqlite', async getFile() { return { size: 4096, lastModified: Date.now() }; } };
App._v3Ready = true; App._ownLogUids = new Set(); App._logOffsets = {}; App._myLogSize = 0; App._lastCompactCheck = Date.now();
App.db.run("INSERT INTO schueler (id,nachname,vorname) VALUES (1,'Adler','Anna'),(2,'Birke','Bernd'),(3,'Chur','Clara')");
App.db.run("INSERT INTO kontrolltermine (id,geplant_datum) VALUES (10,'2026-05-05')");
App.db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id) VALUES (100,10,1),(101,10,2),(102,10,3)");

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const tick = () => new Promise(r => setImmediate(r));
const ruhe = async () => { for (let i = 0; i < 20; i++) await tick(); };
const logZeilen = () => { const f = store.get(App._myOplogName()); return f ? dec.decode(f.data).split('\n').filter(Boolean) : []; };

console.log('══ Absturzpuffer sofort, gebündelt ══');
{
  idbPuts = 0;
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['1', 1]);
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['2', 1]);
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['3', 2]);
  check(App._persistLaeuft === true && App._persistErneut === true, 'Erste Eingabe startet den Puffer sofort, weitere merken einen Nachlauf vor');
  await ruhe();
  check(idbPuts === 2 && !App._persistLaeuft && !App._persistErneut, `Drei Eingaben → genau zwei Schreibvorgänge (Start + ein Nachlauf), nicht ${idbPuts}`);
  const rec = idbStore.get(App._idbOpsKey());
  check(rec && rec.ops.length === 3 && rec.ops.every(o => o.uid && o.ts), 'Alle drei Ops mit Kennung und Zeitstempel im Puffer');
  check(!/5000\)/.test(APP_SRC.split('_persistBald() {')[0].split('markDirty() {')[1] || ''), 'Keine 5-Sekunden-Verzögerung mehr im markDirty');
}

console.log('══ Kennzeichen „noch nicht auf dem Netzlaufwerk“ je Azubi ══');
{
  check(!App.azubiGesichert(1) && !App.azubiGesichert(2) && App.azubiGesichert(3), 'Azubis 1 und 2 ungesichert, 3 gesichert');
  check(App._dirtyOps.every(o => o.sid != null), 'Jede Op kennt ihren Azubi');
  App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft) VALUES (?,?,?,1) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET geprueft=1', [3, 1, 5]);
  check(!App.azubiGesichert(3), 'Upsert auf Wochenzeile markiert Azubi 3');
  App.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung' WHERE kontrolltermin_id=? AND schueler_id=?", [10, 2]);
  check(App._azubiAusOp("UPDATE kontrollergebnisse SET ergebnis='in_ordnung' WHERE kontrolltermin_id=? AND schueler_id=?", [10, 2]) === 2 && App._azubiAusOp('UPDATE einstellungen SET wert=? WHERE schluessel=?', ['x', 'y']) === null, 'Azubi aus Ergebnis-Op erkannt, Einstellungen ohne Azubi');
}

console.log('══ Sofort schreiben ══');
{
  const n = App._dirtyOps.length;
  const ok = await App.sofortSpeichern('Test');
  check(ok === true && App._dirtyOps.length === 0 && logZeilen().length === n, `Alle ${n} Ops sofort im Protokoll, Rückgabe true`);
  check(App.azubiGesichert(1) && App.azubiGesichert(2) && App.azubiGesichert(3), 'Danach gelten alle Azubis als gesichert');
  check(Spur.stat.anhaengen && Spur.stat.anhaengen.n >= 1, 'Anhängen in der Spur gezählt');
  check(await App.sofortSpeichern('leer') === true, 'Ohne offene Änderungen sofort true');
  // Schreibfehler: Ops bleiben, Rückgabe false, Azubi bleibt ungesichert
  schreibFehler = Object.assign(new Error('Failed to perform Safe Browsing check.'), { name: 'AbortError' });
  App._verbFehler = 0;
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['9', 3]);
  const ok2 = await App.sofortSpeichern('Fehler');
  check(ok2 === false && App._dirtyOps.length === 1 && !App.azubiGesichert(3), 'Bei Schreibfehler: false, Op bleibt, Azubi bleibt ungesichert');
  const s = Spur.liste('anhaengen').at(-1);
  check(s && !s.ok && s.art === 'offen' && /Fehler/.test(s.info), 'Spur: „Sofort schreiben“ mit offenen Änderungen');
  schreibFehler = null; App._verbFehler = 0; App._netzWeg = false; App._safeBrowsingBis = 0; App._lastSaveDurationMs = 0;
  check(await App.sofortSpeichern('nachher') === true && App.azubiGesichert(3), 'Nach Behebung schreibt der nächste Aufruf alles');
  App.offlineModus = true; App.run('UPDATE schueler SET telefon=? WHERE id=?', ['8', 3]);
  check(await App.sofortSpeichern('offline') === false && App._dirtyOps.length === 1, 'Offline-Modus: nichts anhängen, false');
  App.offlineModus = false; await App.sofortSpeichern('auf');
}

console.log('══ Kontrolle: Abschluss, Wechsel, Verlassen ══');
{
  K.currentTerminId = 10; K.activePruefer = 'Anna'; K.currentSchuelerList = App.query('SELECT * FROM schueler ORDER BY id'); K.currentIndex = 0;
  K.renderSchueler = () => {}; K.enterSchüler = () => {}; K.releaseLock = () => {}; K.isLockedByOther = () => null;
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['11', 1]);
  K.saveAndReleaseExplicit();
  await ruhe();
  check(App._dirtyOps.length === 0 && toasts.at(-1) && /auf dem Netzlaufwerk/.test(toasts.at(-1)[0]) && toasts.at(-1)[1] === 'success', '„Freigeben“ schreibt sofort und meldet es');
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['12', 1]);
  K.goTo(1);
  await ruhe();
  check(App._dirtyOps.length === 0 && K.currentIndex === 1, 'Azubi-Wechsel schreibt sofort');
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['13', 2]);
  K.loadTermin = KontrolleSrcLoadTermin();
  function KontrolleSrcLoadTermin() { return function(id) { if (this.currentTerminId && parseInt(id) !== this.currentTerminId && App.dbFileHandle && !App.demoMode) App.sofortSpeichern('Terminwechsel').catch(() => {}); this.currentTerminId = parseInt(id); }; }
  K.loadTermin(11);
  await ruhe();
  check(App._dirtyOps.length === 0 && /Terminwechsel/.test(KONTROLLE_SRC) && /sofortSpeichern\('Terminwechsel'\)/.test(KONTROLLE_SRC), 'Terminwechsel schreibt sofort (Quelle + Verhalten)');
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['14', 2]);
  K._liveSyncTimer = 1; K.currentTerminId = 10; K._bereich = null;
  K.stopLiveSync();
  await ruhe();
  check(App._dirtyOps.length === 0, 'Kontrolle verlassen schreibt sofort');
  // Kennzeichen in Schnellnavigation und Kopfzeile
  const b1 = el('b1'), b2 = el('b2'), b3 = el('b3');
  elemente.quickNavGrid = Object.assign(el('quickNavGrid'), { querySelectorAll: () => [b1, b2, b3] });
  K.currentIndex = 0;
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['15', 1]);
  K._gesichertAnzeigen();
  check(b1.classList.contains('qn-ungesichert') && !b2.classList.contains('qn-ungesichert') && /noch nicht auf dem Netzlaufwerk/.test(b1.title), 'Schnellnavigation markiert den ungesicherten Azubi');
  check(/wird geschrieben/.test(el('keGesichert').innerHTML), 'Kopf der Durchsicht zeigt „wird geschrieben“');
  await App.sofortSpeichern('Test');
  check(!b1.classList.contains('qn-ungesichert') && !/noch nicht/.test(b1.title) && /auf dem Netzlaufwerk/.test(el('keGesichert').innerHTML), 'Nach dem Anhängen: Markierung weg, „auf dem Netzlaufwerk“');
  check(/id="keGesichert"/.test(KONTROLLE_SRC) && /qn-ungesichert/.test(KONTROLLE_SRC) && /App\.azubiGesichert\(sc\.id\)/.test(KONTROLLE_SRC), 'Markup: Kennzeichen neben „Freigeben“ und in der Schnellnavigation');
}

console.log('══ Wächter gegen Hängen ══');
{
  const w = (sandbox.__intervalle || []).find(i => i.ms === 1000);
  check(!!w && Spur.HAENGER_MS === 4000, 'Sekundentakt-Wächter installiert, Schwelle 4 s');
  const vorher = Spur.liste('haenger').length;
  Spur._letzteAktion = 'button onclick="KontrolleHandler.goTo(3)" um 10:00:00';
  Spur.haenger(6500);
  const h = Spur.liste('haenger').at(-1);
  check(Spur.liste('haenger').length === vorher + 1 && !h.ok && h.art === 'haenger' && h.ms === 6500 && /goTo\(3\)/.test(h.info), 'Hänger mit Dauer und letzter Aktion in der Spur');
  const l = Spur.haengerListe();
  check(l.length >= 1 && l.at(-1).ms === 6500 && /goTo/.test(l.at(-1).aktion), 'Hänger im localStorage aufgehoben (überlebt den Tab)');
  check((sandbox.__warns || []).some(x => /stand 6\.5 s still/.test(x)), 'Konsole nennt den Hänger');
  for (let i = 0; i < 15; i++) Spur.haenger(4100);
  check(Spur.haengerListe().length === Spur.HAENGER_MAX, `Höchstens ${Spur.HAENGER_MAX} Hänger aufgehoben`);
  // Letzte Aktion aus Klick und Taste
  const knopf = { tagName: 'BUTTON', id: 'btnX', textContent: 'Alle OK', getAttribute: (a) => a === 'onclick' ? "KontrolleHandler.setAllPflichtOK()" : null, closest() { return this; } };
  docHandler.click({ type: 'click', target: knopf });
  check(/button#btnX KontrolleHandler\.setAllPflichtOK\(\)/.test(Spur._letzteAktion), 'Klick: Element und onclick gemerkt, kein Text (keine Namen)');
  const feld = { tagName: 'INPUT', id: '', textContent: 'Kirschbaum', getAttribute: () => null, closest() { return this; } };
  docHandler.keydown({ type: 'keydown', key: 'Enter', target: feld });
  check(/^Taste Enter in input/.test(Spur._letzteAktion) && !/Kirschbaum/.test(Spur._letzteAktion), 'Taste: nur Tastenname und Elementtyp, kein Feldinhalt');
  docHandler.keydown({ type: 'keydown', key: 'a', target: feld });
  check(/^Taste Enter/.test(Spur._letzteAktion), 'Buchstaben werden nicht gemerkt');
  // Drift-Erkennung: Tick mit 6 s Verspätung, sichtbar → Hänger; verdeckt → kein Hänger
  const n0 = Spur.liste('haenger').length;
  Spur._waechter = null; sandbox.__intervalle = [];
  Spur._waechterStarten();
  const tickFn = sandbox.__intervalle[0].f;
  const origNow = Date.now;
  // Tick 1 setzt die Basis, Tick 2 kommt 7 s später
  tickFn();
  Date.now = () => origNow() + 7000; tickFn(); Date.now = origNow;
  check(Spur.liste('haenger').length === n0 + 1 && Spur.liste('haenger').at(-1).ms >= 5900, 'Verspäteter Sekundentakt (7 s) wird als Hänger erkannt');
  sandbox.document.hidden = true;
  Date.now = () => origNow() + 20000; tickFn(); Date.now = origNow;
  check(Spur.liste('haenger').length === n0 + 1, 'Verdecktes Fenster (gedrosselte Timer) zählt nicht als Hänger');
  sandbox.document.hidden = false;
  // Zustandsbild nennt die Hänger
  const text = App.diagnoseText({ zeilen: 3 });
  check(/Hänger \(Oberfläche stand still/.test(text) && /goTo/.test(text), 'Zustandsbild enthält die Hänger-Liste mit letzter Aktion');
}

console.log('══ Liste der wartenden Änderungen ══');
{
  App.wartendeAenderungenDialog();
  check(/Alles auf dem Netzlaufwerk/.test(modal.titel) && /Keine wartenden/.test(modal.html) && !/Jetzt schreiben/.test(modal.footer), 'Ohne offene Änderungen: „Alles auf dem Netzlaufwerk“, kein Schreibknopf');
  App.run('UPDATE schueler SET telefon=? WHERE id=?', ['21', 1]);
  App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft) VALUES (?,?,?,1) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET geprueft=1', [2, 1, 7]);
  App.run("INSERT INTO einstellungen (schluessel,wert) VALUES ('x','y') ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert");
  App.wartendeAenderungenDialog();
  check(/\d+ Änderung\(en\) warten/.test(modal.titel) && parseInt(modal.titel.match(/(\d+) Änderung/)[1]) === App._dirtyOps.length && App._dirtyOps.length >= 3, 'Titel zählt die wartenden Änderungen (' + modal.titel + ')');
  check(/1 × Azubis/.test(modal.html) && /1 × Wochenzeilen/.test(modal.html) && /1 × Einstellungen/.test(modal.html), 'Je Tabelle gezählt, in Klartext');
  check(/Adler, Anna/.test(modal.html) && /Birke, Bernd/.test(modal.html) && !/Chur/.test(modal.html), 'Betroffene Azubis benannt');
  check(/Jetzt schreiben/.test(modal.footer) && /Änderungen als Datei/.test(modal.footer) && /sofortSpeichern\('von Hand'\)/.test(modal.footer), 'Knöpfe „Jetzt schreiben“ und „Änderungen als Datei“');
  check(/älteste von/.test(modal.html) && /Verbunden/.test(modal.html), 'Ältester Zeitstempel und Zustand');
  App._netzWeg = true; App.wartendeAenderungenDialog(); check(/nicht erreichbar/.test(modal.html), 'Netzabriss wird benannt'); App._netzWeg = false;
  await App.sofortSpeichern('Ende');
  check(/onclick="App\.wartendeAenderungenDialog\(\)"/.test(read('index.html')), 'Speicherstatus in der Kopfzeile öffnet die Liste');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
