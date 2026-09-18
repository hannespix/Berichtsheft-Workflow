// ═══════════════════════════════════════════════════════════════════
//  Problem melden: Ringspeicher, Fehlerabfang, Diagnose, Schwärzung,
//  Ablage in _bhk/meldungen/, Übersicht, Export, Aufbewahrung
//  Ausführen:  node tests/melden-test.mjs
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
const MELD_SRC = read('src/js/modules/melden.js');

// ── Fake-Ordner mit Unterordnern ──
const enc = new TextEncoder(), dec = new TextDecoder();
const mkDir = (name) => {
  const dateien = new Map(), ordner = new Map();
  return {
    kind: 'directory', name, dateien, ordner,
    async getDirectoryHandle(n, o) {
      if (!ordner.has(n)) { if (!(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } ordner.set(n, mkDir(n)); }
      return ordner.get(n);
    },
    async getFileHandle(n, o) {
      if (!dateien.has(n)) { if (!(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } dateien.set(n, { data: new Uint8Array(0), mtime: Date.now() }); }
      const f = dateien.get(n);
      return {
        kind: 'file', name: n,
        async getFile() { return { size: f.data.length, lastModified: f.mtime, type: '', async text() { return dec.decode(f.data); }, async arrayBuffer() { return f.data.buffer; } }; },
        async createWritable() { let buf = new Uint8Array(0); return { async write(x) { buf = x instanceof Uint8Array ? x : enc.encode(String(x)); }, async close() { dateien.set(n, { data: buf, mtime: Date.now() }); }, async abort() {} }; },
      };
    },
    async removeEntry(n) { dateien.delete(n); ordner.delete(n); },
    async *entries() {
      for (const [k, v] of ordner) yield [k, v];
      for (const k of dateien.keys()) yield [k, await this.getFileHandle(k)];
    },
  };
};
const bhk = mkDir('_bhk');

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
let modalHtml = '';
const downloads = [];
const toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN, Blob: class { constructor(p) { this.parts = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    createElement: (tag) => (tag === 'a' ? { set download(v) { downloads.push(v); }, get download() { return downloads.at(-1); }, href: '', click() {} } : el('tmp_' + tag)),
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
  },
  navigator: { userAgent: 'TestBrowser/1.0', language: 'de-DE' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => '2026-09-18', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
  _makeModalWide: () => {},
};
sandbox.window = { addEventListener(art, fn) { (sandbox.__handler = sandbox.__handler || {})[art] = fn; } };
Object.assign(sandbox.window, sandbox);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App; globalThis.__Log = BhkLog;', sandbox, { filename: 'app-core.js' });
vm.runInContext(MELD_SRC + '\n;globalThis.Melden = Melden;', sandbox, { filename: 'melden.js' });
const { __App: App, __Log: Log, Melden: M } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]);
App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = (t, html, footer) => { modalHtml = String(t) + String(html) + String(footer || ''); }; App.closeModal = () => {};
App.confirm = async () => true;
App.bhkDirHandle = bhk; App.dirHandle = bhk; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.currentView = 'kontrolle'; App.currentUser = 'Anna'; App._networkQuality = 'slow'; App._lastFileSize = 12345678;

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// Testdaten mit echten Namen
App.db.run("INSERT OR IGNORE INTO fachrichtungen (code,bezeichnung,typ) VALUES ('036','GaLaBau','Gärtner')");
App.db.run("INSERT INTO schueler (id,ibykus_id,nachname,vorname,aktiv,status) VALUES (1,'BAV-99887','Kirschbaum','Ferdinand',1,'aktiv'),(2,'BAV-11223','Zwetschge','Roswitha',0,'ap_bestanden')");
App.db.run("INSERT INTO betriebe (id,name,ort) VALUES (1,'Gärtnerei Rosenstengel','Oberdorf')");
App.db.run("INSERT INTO ausbilder (id,betrieb_id,nachname,vorname) VALUES (1,1,'Kirschbaum','Hubert')");
App.db.run("INSERT INTO kontrolltermine (id,geplant_datum) VALUES (1,'2026-10-01')");
App.db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id) VALUES (1,1,1)");

console.log('══ Ringspeicher und Fehlerabfang ══');
{
  check(Log && Array.isArray(Log.zeilen), 'Ringspeicher vorhanden');
  const vorher = Log.zeilen.length;
  sandbox.console.warn('[Test] etwas ist passiert', { a: 1 });
  sandbox.console.error('[Test] schlimm');
  check(Log.zeilen.length === vorher + 2, 'Konsolenmeldungen werden mitgeschnitten');
  const letzte = Log.zeilen.at(-2);
  check(letzte.s === 'warn' && /etwas ist passiert/.test(letzte.text) && /"a":1/.test(letzte.text) && letzte.t > 0, 'Stufe, Text, Objekte und Zeit werden festgehalten');
  const grenze = Log.MAX;
  for (let i = 0; i < grenze + 50; i++) sandbox.console.log('Fülle ' + i);
  check(Log.zeilen.length === grenze, `Ringspeicher begrenzt auf ${grenze} Zeilen`);
  check(/Fülle ${'' + (grenze + 49)}/.test(Log.zeilen.at(-1).text) || Log.zeilen.at(-1).text.includes('Fülle ' + (grenze + 49)), 'Die neuesten Zeilen bleiben erhalten');
  // Fehlerabfang über die installierten Handler
  const h = sandbox.__handler || {};
  check(typeof h.error === 'function' && typeof h.unhandledrejection === 'function', 'Globale Fehlerabfänge installiert');
  h.error({ message: 'Kaputt in Zeile X', error: { stack: 'at f()\nat g()' }, filename: 'app.js', lineno: 42 });
  h.unhandledrejection({ reason: { message: 'Zusage gebrochen', stack: 'at h()' } });
  check(Log.fehler.length === 2 && Log.fehler[0].art === 'Programmfehler' && /app\.js:42/.test(Log.fehler[0].quelle) && Log.fehler[1].art === 'Unbehandelte Zusage', 'Programmfehler und gebrochene Zusagen werden festgehalten');
  check(/at f\(\)/.test(Log.fehler[0].stack), 'Aufrufliste wird mitgeschnitten');
  check(sandbox.console.warn !== Log._orig_warn, 'Die echte Konsole wird weiterhin bedient (Aufsatz, kein Ersatz)');
}

console.log('══ Schwärzung ══');
{
  const s = (t) => App.schwaerzen(t);
  check(s('Fehler bei Kirschbaum, Ferdinand') === 'Fehler bei …, …', `Azubi-Namen werden geschwärzt (${s('Fehler bei Kirschbaum, Ferdinand')})`);
  check(!s('Ausbilder Hubert Kirschbaum hat angerufen').includes('Hubert'), 'Ausbildernamen ebenso');
  check(!s('Betrieb Rosenstengel meldet').includes('Rosenstengel'), 'Betriebsnamen ebenso');
  check(!s('Ident BAV-99887 fehlt').includes('99887'), 'IBYKUS-Kennungen ebenso');
  check(s("INSERT INTO schueler VALUES ('Geheim','Sehr')").includes("'…'") && !s("INSERT INTO schueler VALUES ('Geheim','Sehr')").includes('Geheim'), 'Zeichenketten aus SQL werden geschwärzt');
  check(s('Mail an vorname.nachname@rpf.bwl.de raus') === 'Mail an …@… raus', 'E-Mail-Adressen werden geschwärzt');
  check(s('{"nachname":"Meier","kw":12}').includes('"nachname":"…"'), 'Namensfelder in JSON werden geschwärzt');
  check(s('Kompaktierung nicht möglich: Sperre belegt') === 'Kompaktierung nicht möglich: Sperre belegt', 'Technische Meldungen bleiben unverändert lesbar');
  check(s('Gärtnerei Musterhausen KW 12') === 'Gärtnerei Musterhausen KW 12', 'Allerweltswörter wie „Gärtnerei" bleiben stehen');
  check(s(null) === '' && s(undefined) === '', 'Leere Eingaben sind unkritisch');
}

console.log('══ Diagnose ══');
{
  App._compactGrund = 'Sperre belegt von „Bernd" (seit 20 s)';
  App._bulkPending = true; App._tabIsPrimary = false;
  const d = App.diagnose();
  check(d.programm.version === App.VERSION && d.browser.kennung === 'TestBrowser/1.0', 'Version und Browser');
  check(d.sitzung.ansicht === 'kontrolle' && d.sitzung.zweitRegisterkarte === true && d.sitzung.datenbank === 'test.sqlite', 'Ansicht, Zweit-Registerkarte, Datenbank');
  check(d.verbindung.netzqualitaet === 'slow' && d.synchronisation.kompaktierungGrund.includes('Sperre belegt') && d.synchronisation.importOffen === true, 'Netzqualität, Kompaktierungsgrund, offener Import');
  check(d.datenbank.azubisAktiv === 1 && d.datenbank.azubisInaktiv === 1 && d.datenbank.termine === 1 && d.datenbank.ergebnisse === 1, 'Zahlen der Datenbank');
  const txt = App.diagnoseText({ zeilen: 5 });
  check(/programm:/.test(txt) && /verbindung:/.test(txt) && /Konsolenprotokoll/.test(txt) && /abgefangene Fehler/.test(txt), 'Textfassung enthält alle Abschnitte');
  sandbox.console.warn('Azubi Kirschbaum hat Mängel');
  const txt2 = App.diagnoseText({ zeilen: 20 });
  check(!txt2.includes('Kirschbaum'), 'Das mitgesendete Protokoll ist geschwärzt');
  check(!/nachname|vorname/i.test(JSON.stringify(App.diagnose())), 'Das Zustandsbild enthält keine Namensfelder');
  App._bulkPending = false; App._tabIsPrimary = true;
}

console.log('══ Melden: Ablage und Benachrichtigung ══');
{
  el('mdBeschreibung').value = 'Beim Speichern kam eine rote Meldung bei Kirschbaum';
  el('mdSchritte').value = 'Termin geöffnet, KW 12 gesetzt';
  el('mdDiagnose').value = 'verbindung:\n  netzqualitaet: slow';
  M._bild = { bytes: new Uint8Array([1, 2, 3, 4]), typ: 'image/png', name: 'bild.png', groesse: 4 };
  let chatText = '';
  sandbox.Chat = { aktiv: () => true, senden: async (t) => { chatText = t; return true; } };
  check(await M.senden() === true, 'Meldung wird abgelegt');
  const ordner = (await bhk.getDirectoryHandle('meldungen')).ordner;
  check(ordner.size === 1, 'Ein Ordner je Meldung');
  const eigen = [...ordner.values()][0];
  const json = JSON.parse(dec.decode(eigen.dateien.get('meldung.json').data));
  check(json.beschreibung.includes('rote Meldung') && !json.beschreibung.includes('Kirschbaum'), 'Beschreibung ist geschwärzt abgelegt');
  check(json.version === App.VERSION && json.von === 'Anna' && json.bild === 'bild.png', 'Version, Melder und Bildname stehen in der Meldung');
  check(eigen.dateien.has('meldung.txt') && eigen.dateien.has('bild.png'), 'Textfassung und Bild liegen daneben');
  check(eigen.dateien.get('bild.png').data.length === 4, 'Bild wird als eigene Datei geschrieben, nicht in die Chatdatei');
  check(/Neue Fehlermeldung/.test(chatText), 'Die anderen werden über den Chat benachrichtigt');
  check(M._bild === null, 'Bild wird nach dem Senden verworfen');
  el('mdBeschreibung').value = '';
  check(await M.senden() === undefined || toasts.at(-1)[1] === 'warning', 'Ohne Beschreibung wird nicht gesendet');
}

console.log('══ Übersicht, Export und Aufbewahrung ══');
{
  const liste = await M.liste();
  check(liste.length === 1 && liste[0]._ordner, 'Meldung wird gelesen');
  check(/Fehlermeldung/.test(M.alsText(liste[0])) && /Was ist passiert\?/.test(M.alsText(liste[0])) && /Zustand und Protokoll/.test(M.alsText(liste[0])), 'Textfassung mit Abschnitten für die Weitergabe');
  downloads.length = 0;
  await M.exportAlle();
  check(downloads.length === 1 && /Fehlermeldungen/.test(downloads[0]), 'Alle Meldungen als eine Textdatei');
  await M.renderCard();
  check(/Ansehen/.test(el('meldungenBox').innerHTML) && /Anna/.test(el('meldungenBox').innerHTML), 'Übersicht zeigt die Meldungen');
  await M.anzeigen(liste[0]._ordner);
  check(/Was ist passiert/.test(modalHtml) && /Zustand und Protokoll/.test(modalHtml), 'Einzelansicht öffnet sich');
  // Alte Meldung verfällt
  const dir = await bhk.getDirectoryHandle('meldungen');
  const alt = await dir.getDirectoryHandle('2020-01-01T00-00-00_zzzz', { create: true });
  await (await alt.getFileHandle('meldung.json', { create: true })).createWritable().then(async w => { await w.write(enc.encode('{"id":"alt","zeitpunkt":"2020-01-01T00:00:00Z"}')); await w.close(); });
  alt.dateien.get('meldung.json').mtime = Date.now() - (M.MELDUNG_TAGE + 5) * 86400000;
  const liste2 = await M.liste();
  check(liste2.length === 1 && !dir.ordner.has('2020-01-01T00-00-00_zzzz'), `Meldungen älter als ${M.MELDUNG_TAGE} Tage werden gelöscht`);
  await M.loeschen(liste2[0]._ordner);
  check(dir.ordner.size === 0 && (await M.liste()).length === 0, 'Löschen entfernt den ganzen Ordner');
}

console.log('══ Ohne Netzlaufwerk ══');
{
  const merk = App.bhkDirHandle;
  App.bhkDirHandle = null;
  el('mdBeschreibung').value = 'Geht auch ohne Laufwerk';
  downloads.length = 0;
  await M.senden();
  check(downloads.length === 1 && /Fehlermeldung/.test(downloads[0]) && toasts.some(t => /als Datei/i.test(t[0])), 'Ohne Netzlaufwerk wird die Meldung als Datei heruntergeladen');
  App.bhkDirHandle = merk;
}

console.log('══ Einbau ══');
{
  check(/BhkLog\.installieren\(\);/.test(APP_SRC) && APP_SRC.indexOf('BhkLog') < APP_SRC.indexOf('const App = {'), 'Ringspeicher wird VOR der App eingerichtet');
  check(/melden\.js/.test(read('index.html')) && /melden\.js/.test(read('build.sh')), 'Modul eingebunden und im Build');
  check(/Melden\.cardHtml\(\)/.test(read('src/js/modules/views.js')) && /Melden\.renderCard\(\)/.test(read('src/js/modules/views.js')), 'Karte in den Einstellungen');
  check(/e\.key === 'F2'/.test(read('src/js/modules/keyboard-shortcuts.js')) && /F2/.test(read('src/js/modules/global-search.js')), 'F2 öffnet das Melden und steht in der Kürzel-Hilfe');
  check(/geschwärzt/.test(read('src/js/modules/views.js')), 'Hilfetext nennt die Schwärzung');
  check(!/INSERT INTO|App\.run\(/.test(MELD_SRC), 'Meldungen landen NICHT in der Datenbank');
  check(/clipboardData/.test(MELD_SRC) && /ondrop/.test(MELD_SRC), 'Bildschirmfoto per Einfügen und Ziehen');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
