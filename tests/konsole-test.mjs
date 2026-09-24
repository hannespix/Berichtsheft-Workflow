// ═══════════════════════════════════════════════════════════════════
//  Diagnose: Ereignisspur (BhkSpur), Fehlerarten, Drosselung übersprungener
//  Takte, Instrumentierung von Präsenz/Chat/Netz, Konsolenbefehle (bhk.*),
//  Verbindungstest mit Schreibsperre und Uhrversatz, Zustandsbild
//  Ausführen:  node tests/konsole-test.mjs
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
const CHAT_SRC = read('src/js/modules/chat.js');
const KONSOLE_SRC = read('src/js/modules/konsole.js');

// ── Fake-Netzlaufwerk: Schreibfehler und Uhrversatz einstellbar ──
const enc = new TextEncoder(), dec = new TextDecoder();
const store = new Map(); // name → { data, mtime, kind }
let schreibFehler = null;   // Error, der bei createWritable geworfen wird
let mtimeVersatz = 0;       // Millisekunden, die der „Server" der lokalen Uhr voraus ist
const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
const handle = (name) => ({
  kind: (store.get(name) || {}).kind || 'file', name,
  async getFile() {
    const f = store.get(name); if (!f) throw nf();
    return { size: f.data.length, lastModified: f.mtime, async text() { return f.data; }, slice(von) { const t = f.data.slice(von); return { async text() { return t; } }; } };
  },
  async createWritable(opts) {
    if (schreibFehler) throw schreibFehler;
    let buf = (opts && opts.keepExistingData && store.has(name)) ? store.get(name).data : '';
    return {
      async write(x) { if (x && x.type === 'write') buf = buf.slice(0, x.position) + dec.decode(x.data); else buf = typeof x === 'string' ? x : dec.decode(x); },
      async close() { store.set(name, { data: buf, mtime: Date.now() + mtimeVersatz }); },
      async abort() {},
    };
  },
});
const fakeDir = {
  async getFileHandle(name, opts) {
    if (!store.has(name)) { if (!(opts && opts.create)) throw nf(); store.set(name, { data: '', mtime: Date.now() + mtimeVersatz }); }
    return handle(name);
  },
  async removeEntry(name) { store.delete(name); },
  async *entries() { for (const name of [...store.keys()]) yield [name, handle(name)]; },
};

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const konsole = { logs: [], warns: [], tabellen: [] };
const timer = [];           // aufgeschobene setTimeout-Aufrufe (nur wenn zeitQueue)
let zeitQueue = false;
const speicher = {};
let modalHtml = '';
const sandbox = {
  console: { log: (...a) => konsole.logs.push(a.map(String).join(' ')), warn: (...a) => konsole.warns.push(a.map(String).join(' ')), error() {}, table: (z) => konsole.tabellen.push(z) },
  setTimeout: (f, ms) => { if (typeof f !== 'function') return 0; if (zeitQueue) { timer.push(f); return timer.length; } f(); return 0; }, clearTimeout() {}, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener(art, fn) { (sandbox.__docHandler = sandbox.__docHandler || {})[art] = fn; }, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
  Melden: { oeffnen() { sandbox.__meldenGeoeffnet = true; } }, _makeModalWide: () => {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App; globalThis.__Spur = BhkSpur;', sandbox, { filename: 'app-core.js' });
vm.runInContext(CHAT_SRC + '\n;globalThis.Chat = Chat;', sandbox, { filename: 'chat.js' });
vm.runInContext(KONSOLE_SRC + '\n;globalThis.Konsole = Konsole;', sandbox, { filename: 'konsole.js' });
const { __App: App, __Spur: Spur, Chat: C, Konsole: K } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = (t, html, footer) => { modalHtml = String(t) + String(html) + String(footer || ''); }; App.closeModal = () => {};
let kopiert = '';
App.kopieren = async (t) => { kopiert = String(t); return true; };
App.dirHandle = fakeDir; App.bhkDirHandle = fakeDir; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.currentView = 'planung'; App.currentUser = 'Anna';
App.dbFileHandle = { name: 'test.sqlite', async getFile() { return { size: 4096, lastModified: Date.now() }; } };
App.db.run("INSERT INTO einstellungen (schluessel,wert) VALUES ('kollegen_anzeige','1')"); // Präsenz und Chat für diese Suite einschalten

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const err = (name, msg) => { const e = new Error(msg); e.name = name; return e; };

console.log('══ Ereignisspur: Fehlerarten ══');
{
  check(Spur && Array.isArray(Spur.eintraege) && Spur.MAX >= 200, 'Spur vorhanden');
  check(Spur.fehlerArt(err('AbortError', 'Failed to perform Safe Browsing check.')) === 'safebrowsing', 'Safe-Browsing-Abbruch erkannt');
  check(Spur.fehlerArt(err('InvalidStateError', 'x')) === 'zustand' && Spur.fehlerArt(err('UnknownError', 'An operation that depends on state cached in an interface object was made')) === 'zustand', 'Zustandsfehler an Name oder Text erkannt');
  check(Spur.fehlerArt(new Error('Oplog-Append Timeout')) === 'timeout', 'Zeitlimit');
  check(Spur.fehlerArt(err('NotFoundError', '')) === 'nicht-gefunden' && Spur.fehlerArt(err('NotAllowedError', '')) === 'verweigert' && Spur.fehlerArt(err('NotReadableError', '')) === 'nicht-lesbar', 'NotFound / NotAllowed / NotReadable');
  check(Spur.fehlerArt(err('NoModificationAllowedError', '')) === 'gesperrt' && Spur.fehlerArt(err('AbortError', 'weg')) === 'abgebrochen', 'Gesperrt / abgebrochen');
  check(Spur.fehlerArt(null) === '' && Spur.fehlerArt(err('SonstError', 'x')) === 'SonstError', 'Ohne Fehler leer, unbekannter Name bleibt stehen');
  check(/Safe Browsing/.test(Spur.artText('safebrowsing')) && Spur.artText('xy') === 'xy', 'Klartext je Fehlerart');
}

console.log('══ Ereignisspur: Einträge, Zähler, Drosselung ══');
{
  Spur.eintraege.length = 0; Object.keys(Spur.stat).forEach(k => delete Spur.stat[k]);
  const e1 = Spur.notiere('test', 'Vorgang', { ok: true, ms: 120, info: 'a' });
  check(e1 && e1.ok && e1.ms === 120 && Spur.eintraege.length === 1 && Spur.stat.test.n === 1 && Spur.stat.test.gesamtMs === 120, 'Erfolg mit Dauer aufgehoben und gezählt');
  Spur.notiere('test', 'Vorgang', { ok: false, ms: 50, fehler: err('AbortError', 'Failed to perform Safe Browsing check') });
  const s = Spur.stat.test;
  check(s.n === 2 && s.fehler === 1 && s.letzteArt === 'safebrowsing' && /Safe Browsing/.test(s.letzterFehler) && Spur.eintraege[1].art === 'safebrowsing', 'Fehler mit Art gezählt');
  const vorher = Spur.eintraege.length;
  Spur.notiere('test', 'leise', { ok: true, ms: 10, nurStat: true });
  check(Spur.eintraege.length === vorher && Spur.stat.test.n === 3, 'nurStat: gezählt, aber nicht aufgehoben');
  const warnsVorher = konsole.warns.length;
  Spur.notiere('test', 'leise', { ok: true, ms: 4200, nurStat: true });
  check(Spur.eintraege.length === vorher + 1 && Spur.stat.test.langsam === 1 && konsole.warns.length === warnsVorher + 1 && /dauerte 4\.2 s/.test(konsole.warns.at(-1)), 'Langsamer Vorgang wird trotz nurStat aufgehoben und gewarnt');
  for (let i = 0; i < Spur.MAX + 20; i++) Spur.notiere('fuelle', 'x', { ok: true });
  check(Spur.eintraege.length === Spur.MAX && Spur.eintraege.at(-1).kat === 'fuelle', `Ringspeicher begrenzt auf ${Spur.MAX}`);
  Spur.eintraege.length = 0;
  const u1 = Spur.uebersprungen('takt', 'Fenster verdeckt');
  const u2 = Spur.uebersprungen('takt', 'Fenster verdeckt');
  Spur.uebersprungen('takt', 'Fenster verdeckt'); Spur.uebersprungen('takt', 'Fenster verdeckt');
  check(u1 && u1.grund === 'Fenster verdeckt' && u1.n === 1 && u2 === null && Spur.eintraege.length === 1, 'Übersprungener Takt: erster Eintrag sofort, Wiederholungen binnen einer Minute nicht');
  Spur._uebersprungen['takt|Fenster verdeckt'].t = Date.now() - 61000;
  const u3 = Spur.uebersprungen('takt', 'Fenster verdeckt');
  check(u3 && u3.n === 4 && /4×/.test(u3.info), 'Nach einer Minute ein Eintrag mit Zähler der ausgelassenen Takte');
  check(Spur.uebersprungen('takt', 'Anhängen läuft') !== null, 'Anderer Grund zählt getrennt');
  let geworfen = null;
  await Spur.messen('m', 'gut', async () => 7, (r) => ({ info: 'r=' + r }));
  try { await Spur.messen('m', 'schlecht', async () => { throw err('NotFoundError', 'weg'); }); } catch(e) { geworfen = e; }
  check(Spur.stat.m.n === 2 && Spur.stat.m.fehler === 1 && geworfen && geworfen.name === 'NotFoundError' && Spur.liste('m').find(e => e.info === 'r=7'), 'messen: Erfolg mit Zusatzinfo, Fehler wird notiert und weitergeworfen');
  const z = Spur.zusammenfassung().find(r => r.bereich === 'm');
  check(z && z.vorgaenge === 2 && z.fehler === 1 && /nicht-gefunden/.test(z.letzterFehler), 'Zusammenfassung je Bereich');
  const t = Spur.text(5);
  check(/Netz- und Dateivorgänge je Bereich/.test(t) && /Ereignisspur \(letzte 5/.test(t) && /FEHLER nicht-gefunden/.test(t), 'Textfassung mit Zusammenfassung und letzten Einträgen');
  check(Spur.liste('m', 1).length === 1 && Spur.liste(null, 3).length === 3, 'liste() filtert nach Bereich und Anzahl');
  Spur.setDebug(true); check(Spur.debug === true && speicher.bhk_debug === '1', 'Debug-Schalter bleibt gespeichert');
  const logsVorher = konsole.logs.length; Spur.notiere('d', 'sichtbar', { ok: true, ms: 3 });
  check(konsole.logs.length === logsVorher + 1 && /\[Spur:d\] sichtbar 3 ms/.test(konsole.logs.at(-1)), 'Mit Debug erscheint jeder Vorgang in der Konsole');
  Spur.setDebug(false); check(Spur.debug === false, 'Debug aus');
}

console.log('══ Sichtbarkeit und übersprungene Takte ══');
{
  const h = sandbox.__docHandler && sandbox.__docHandler.visibilitychange;
  check(typeof h === 'function', 'Sichtbarkeits-Handler installiert');
  sandbox.document.hidden = true; h();
  sandbox.document.hidden = false; h();
  const f = Spur.liste('fenster');
  check(f.length >= 2 && /verdeckt/.test(f.at(-2).was) && /sichtbar/.test(f.at(-1).was), 'Verdeckt und wieder sichtbar werden notiert');
  // Abgleich-Takt mit aufgeschobenen Timern durchspielen
  zeitQueue = true; timer.length = 0;
  App._v3Active = () => false; App._pollSyncMarker = async () => { sandbox.__gepollt = (sandbox.__gepollt || 0) + 1; };
  App.startPolling();
  check(timer.length >= 1, 'Takt eingeplant');
  sandbox.document.hidden = true;
  await timer.shift()();
  check(Spur.liste('takt').some(e => e.grund === 'Fenster verdeckt'), 'Verdecktes Fenster: Takt übersprungen, Grund notiert');
  sandbox.document.hidden = false; App._appendInProgress = true;
  await timer.shift()();
  check(Spur.liste('takt').some(e => e.grund === 'Anhängen läuft'), 'Laufendes Anhängen: Takt übersprungen, Grund notiert');
  App._appendInProgress = false; App._mergeInProgress = true;
  await timer.shift()();
  check(Spur.liste('takt').some(e => e.grund === 'Speichern/Kompaktierung läuft'), 'Laufende Kompaktierung: Grund notiert');
  App._mergeInProgress = false;
  await timer.shift()();
  check(sandbox.__gepollt === 1, 'Ohne Hindernis läuft der Abgleich');
  zeitQueue = false; timer.length = 0;
  try { if (App.pollInterval) sandbox.clearTimeout(App.pollInterval); } catch(e) {}
}

console.log('══ Instrumentierung: Präsenz, Netz, Chat ══');
{
  store.set('praesenz_test_client-BBBB.json', { data: JSON.stringify({ c: 'client-BBBB', p: 'Bernd', v: 'kontrolle', ts: Date.now() - 5000, seit: Date.now() - 60000 }), mtime: Date.now() - 5000 });
  check(await App._praesenzTakt(true) === true, 'Lebenszeichen geschrieben');
  check(App._praesenzLetzteOk > 0 && App._praesenzFehler === 0 && Spur.stat.praesenz && Spur.stat.praesenz.n >= 2 && Spur.stat.praesenz.fehler === 0, 'Präsenz: Schreiben und Lesen gezählt, letzter Erfolg gemerkt');
  schreibFehler = err('AbortError', 'Failed to perform Safe Browsing check.');
  App._praesenzLetzte = 0; App._verbFehler = 0;
  check(await App._praesenzTakt(true) === false, 'Blockiertes Schreiben: Takt scheitert');
  const p = Spur.liste('praesenz').at(-1);
  check(p && !p.ok && p.art === 'safebrowsing' && /1\. Fehler in Folge/.test(p.info) && App._praesenzFehler === 1, 'Fehlerart Safe Browsing mit Zähler in der Spur');
  const n = Spur.liste('netz').at(-1);
  check(n && !n.ok && /praesenz/.test(n.info) && n.art === 'safebrowsing', 'Netz: Verbindungsfehler mit Quelle gezählt');
  App._verbFehler = 0; App._netzWeg = false; App._safeBrowsingBis = 0; App._lastSaveDurationMs = 0;
  schreibFehler = null;
  check(await C.senden('Hallo') === true && Spur.liste('chat').at(-1).was === 'Nachricht anhängen' && Spur.liste('chat').at(-1).ok, 'Chat: Anhängen notiert');
  schreibFehler = err('InvalidStateError', 'state had changed since it was read from disk');
  App._handlesNeuHolen = async () => false;
  check(await C.senden('Zwei') === false, 'Chat: Senden scheitert bei Zustandsfehler');
  const c = Spur.liste('chat').at(-1);
  check(c && !c.ok && c.art === 'zustand', 'Chat: Zustandsfehler in der Spur');
  schreibFehler = null; App._verbFehler = 0; App._netzWeg = false;
  store.set('chat_test_client-BBBB.jsonl', { data: JSON.stringify({ id: 'b1', c: 'client-BBBB', von: 'Bernd', an: '', text: 'Moin', ts: Date.now() }) + '\n', mtime: Date.now() });
  check(await C.abholen() === 1 && Spur.liste('chat').at(-1).was === 'Nachrichten abholen' && /1 neu/.test(Spur.liste('chat').at(-1).info), 'Chat: Abholen mit neuer Nachricht notiert');
  const vorher = Spur.eintraege.length;
  await C.abholen();
  check(Spur.eintraege.length === vorher && Spur.stat.chat.n >= 4, 'Chat: Abholen ohne Neues nur gezählt');
}

console.log('══ Zustandsbild ══');
{
  const d = App.diagnose();
  check(d.sitzung.fensterVerdeckt === false && 'lebenszeichenZuletztOk' in d.verbindung && d.verbindung.lebenszeichenFehlerInFolge === 1 && 'letztesAnhaengenMs' in d.verbindung, 'Diagnose: Fenster, Lebenszeichen, Anhängen');
  const t = App.diagnoseText({ zeilen: 5 });
  check(/Netz- und Dateivorgänge je Bereich/.test(t) && /Ereignisspur/.test(t) && /praesenz: /.test(t), 'Zustandsbild enthält Spur und Zusammenfassung');
  check(!/Ereignisspur/.test(App.diagnoseText({ spur: false })), 'Spur abschaltbar');
}

console.log('══ Konsolenbefehle ══');
{
  check(sandbox.bhk === K, 'window.bhk zeigt auf die Konsole');
  check(konsole.logs.some(l => /bhk\.hilfe\(\)/.test(l)), 'Startmeldung nennt bhk.hilfe()');
  const h = K.hilfe();
  check(Array.isArray(h) && h.includes('bhk.test()') && konsole.tabellen.at(-1).some(z => /bhk\.status/.test(z.Befehl)), 'hilfe(): Tabelle der Befehle');
  const st = K.status();
  check(st.zustand && st.zustand.verbindung && Array.isArray(st.bereiche) && st.bereiche.some(b => b.bereich === 'praesenz'), 'status(): Zustand und Bereiche');
  check(konsole.tabellen.at(-2).some(z => z.Angabe === 'gesehen' && /Bernd/.test(z.Wert)), 'status(): gesehene Kollegen in der Tabelle');
  const sp = K.spur('chat', 2);
  check(sp.length === 2 && konsole.tabellen.at(-1).length === 2 && konsole.tabellen.at(-1)[0].Bereich === 'chat', 'spur(bereich, n): gefilterte Tabelle');
  check(K.spur(3).length === 3, 'spur(n): Zahl allein gilt als Anzahl');
  check(K.spur('gibtsnicht').length === 0 && /Keine Einträge/.test(konsole.logs.at(-1)), 'spur(): leerer Bereich gemeldet');
  const pr = K.praesenz();
  check(pr.length === 1 && konsole.tabellen.at(-1)[0].Wer === 'Bernd' && /online/.test(konsole.tabellen.at(-1)[0].Status), 'praesenz(): Tabelle der Kollegen');
  const ch = K.chat();
  check(ch.length >= 2 && konsole.tabellen.at(-1).some(z => z.Text === 'Moin'), 'chat(): Verlauf als Tabelle');
  store.set('oplog_test_client-BBBB_g0.jsonl.crswap', { data: '', mtime: Date.now() });
  store.set('meldungen', { data: '', mtime: Date.now(), kind: 'directory' });
  const dl = await K.dateien();
  const arten = Object.fromEntries(dl.map(z => [z.Name, z.Art]));
  check(arten['praesenz_test_client-BBBB.json'] === 'Lebenszeichen' && arten['chat_test_client-BBBB.jsonl'] === 'Chat' && arten['oplog_test_client-BBBB_g0.jsonl.crswap'] === 'Tauschdatei (Browser)' && arten['meldungen/'] === 'Ordner', 'dateien(): Einträge nach Art benannt');
  check(dl.every(z => 'Alter' in z) && Spur.liste('probe').at(-1).was.startsWith('Ordner auflisten'), 'dateien(): Alter je Datei, Vorgang in der Spur');
  store.delete('meldungen');
  Spur.setDebug(true); K.debug(false); check(Spur.debug === false && K.debug(true) === true && Spur.debug === true, 'debug(): schaltet um'); K.debug(false);
  await K.kopieren();
  check(/Ereignisspur/.test(kopiert) && /Konsolenprotokoll/.test(kopiert), 'kopieren(): Zustandsbild samt Spur und Protokoll');
  K.melden(); check(sandbox.__meldenGeoeffnet === true, 'melden(): öffnet das Melde-Fenster');
  const j = await K.jetzt();
  check(j.praesenz === true && typeof j.nachrichten === 'number', 'jetzt(): Lebenszeichen und Nachrichten sofort');
}

console.log('══ Verbindungstest ══');
{
  App._v3Ready = false;
  // Fehler der vorigen Abschnitte zurücksetzen – sie wären ein eigener Befund
  ['praesenz', 'chat', 'anhaengen'].forEach(k => { if (Spur.stat[k]) { Spur.stat[k].fehler = 0; Spur.stat[k].letzteArt = ''; } });
  const r = await K.test();
  check(r.schritte.length === 5 && r.schritte.every(s => s.Ergebnis === 'OK'), 'Alle fünf Schritte OK: ' + r.schritte.map(s => s.Schritt.split(' ')[0]).join(', '));
  check(r.befunde.length === 1 && /Keine Auffälligkeiten/.test(r.befunde[0]), 'Befund: keine Auffälligkeiten');
  check(![...store.keys()].some(n => n.startsWith('probe_')), 'Probedatei wieder gelöscht');
  check(typeof r.versatzMs === 'number' && Math.abs(r.versatzMs) < 2000, 'Uhrversatz geschätzt (hier ≈ 0)');
  schreibFehler = err('AbortError', 'Failed to perform Safe Browsing check.');
  App._verbFehler = 0;
  const r2 = await K.test();
  check(r2.schritte.find(s => /Schreibprobe/.test(s.Schritt)).Ergebnis === 'FEHLER' && /Schreiben blockiert/.test(r2.befunde[0]) && /Lebenszeichen/.test(r2.befunde[0]), 'Schreibsperre: Befund nennt Browser-Richtlinie und Folgen für die Kollegen');
  check(r2.schritte.find(s => /Ordner/.test(s.Schritt)).Ergebnis === 'OK', 'Lesen bleibt im Test OK');
  check(![...store.keys()].some(n => n.startsWith('probe_')), 'Keine Probedatei zurückgelassen');
  schreibFehler = null; App._verbFehler = 0; App._netzWeg = false; App._safeBrowsingBis = 0; App._lastSaveDurationMs = 0;
  mtimeVersatz = 5 * 60000;
  const r3 = await K.test();
  check(r3.versatzMs >= 4 * 60000 && r3.befunde.some(b => /Uhrversatz von etwa 5 min/.test(b)), 'Uhrversatz von 5 min wird als Befund genannt');
  mtimeVersatz = 0;
  App._tabIsPrimary = false;
  const r4 = await K.test();
  check(r4.befunde.some(b => /Zweit-Registerkarte/.test(b)), 'Zweit-Registerkarte als Befund');
  App._tabIsPrimary = true;
  App._praesenzFehler = 0; Spur.stat.praesenz.fehler = 0; Spur.stat.praesenz.letzteArt = '';
  const r5 = await K.testDialog();
  check(r5 && /Verbindungstest/.test(modalHtml) && /Befunde/.test(modalHtml) && /Schreibprobe/.test(modalHtml) && /bhk\.hilfe/.test(modalHtml), 'Dialog zeigt Schritte, Befunde und den Konsolenhinweis');
  check(/Verbindungstest/.test(K._letzterTest) && /Befunde:/.test(K._letzterTest), 'Ergebnis als Text zum Kopieren');
  const dh = App.bhkDirHandle; App.bhkDirHandle = null; App.dirHandle = null;
  const r6 = await K.test();
  check(r6.schritte.length === 0 && /Kein Ordner/.test(r6.befunde[0]), 'Ohne Ordner: klare Meldung statt Absturz');
  App.bhkDirHandle = dh; App.dirHandle = dh;
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
