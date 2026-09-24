// ═══════════════════════════════════════════════════════════════════
//  Chat: Zurufe an gleichzeitig arbeitende Kolleginnen und Kollegen
//  Anhängen an die EIGENE Datei, Lesen ab Leseposition, Direktnachrichten,
//  Toast/Verlauf, Ungelesen-Stand, Aufbewahrung, Sperren
//  Ausführen:  node tests/chat-test.mjs
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

// ── Fake-Netzlaufwerk mit echtem Anhängen (position + keepExistingData) ──
const store = new Map(); // name → { data: Uint8Array, mtime }
const enc = new TextEncoder(), dec = new TextDecoder();
let schreibZugriffe = 0, fehlerEinmal = null;
const datei = (name) => {
  const f = store.get(name);
  return {
    kind: 'file',
    async getFile() {
      return {
        size: f.data.length, lastModified: f.mtime,
        async text() { return dec.decode(f.data); },
        slice(von) { const teil = f.data.slice(von); return { async text() { return dec.decode(teil); } }; },
        async arrayBuffer() { return f.data.buffer; },
      };
    },
    async createWritable(opts) {
      if (fehlerEinmal) { const e = fehlerEinmal; fehlerEinmal = null; throw e; }
      let basis = (opts && opts.keepExistingData) ? f.data : new Uint8Array(0);
      let puffer = basis;
      return {
        async write(x) {
          if (x && x.type === 'write') {
            const pos = x.position || 0, d = x.data;
            const neu = new Uint8Array(Math.max(puffer.length, pos + d.length));
            neu.set(puffer.slice(0, Math.min(puffer.length, pos)));
            neu.set(d, pos);
            puffer = neu;
          } else { puffer = x instanceof Uint8Array ? x : enc.encode(String(x)); }
        },
        async close() { schreibZugriffe++; store.set(name, { data: puffer, mtime: Date.now() }); },
        async abort() {},
      };
    },
  };
};
const fakeDir = {
  async getFileHandle(name, o) {
    if (!store.has(name)) { if (!(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } store.set(name, { data: new Uint8Array(0), mtime: Date.now() }); }
    return datei(name);
  },
  async removeEntry(name) { store.delete(name); },
  async *entries() { for (const n of [...store.keys()]) yield [n, datei(n)]; },
};

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = {
  id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, scrollTop: 0, scrollHeight: 100,
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  kinder: [], appendChild(c) { this.kinder.push(c); }, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [],
});
const speicher = {};
let modalHtml = '';
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ className: '', style: {}, title: '', innerHTML: '', onclick: null, remove() {} }),
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
  },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
  _makeModalWide: () => {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(CHAT_SRC + '\n;globalThis.Chat = Chat;', sandbox, { filename: 'chat.js' });
const { __App: App, Chat: C } = sandbox;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]);
App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = (t, html, footer) => { modalHtml = String(html) + String(footer || ''); }; App.closeModal = () => {};
App.dirHandle = fakeDir; App.bhkDirHandle = fakeDir; App.autoLoadedDbName = 'test.sqlite';
App._clientIdCache = 'client-AAAA'; App.currentUser = 'Anna';
const toasts = [];

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const zeilen = (name) => dec.decode(store.get(name).data).split('\n').filter(Boolean).map(JSON.parse);
const fremdSenden = (client, von, text, an, ts) => {
  const name = 'chat_test_' + client + '.jsonl';
  const alt = store.has(name) ? dec.decode(store.get(name).data) : '';
  const z = JSON.stringify({ id: client + '_' + (ts || Date.now()) + '_' + Math.random().toString(36).slice(2, 6), c: client, von, an: an || '', text, ts: ts || Date.now() }) + '\n';
  store.set(name, { data: enc.encode(alt + z), mtime: ts || Date.now() });
};

console.log('══ Schalter: Nachrichten standardmäßig aus ══');
{
  check(C.an() === false && C.aktiv() === false && /ausgeschaltet/.test(C._grund()), 'Ohne Einstellung ruht der Chat mit klarem Grund');
  check(await C.senden('geht nicht') === false && store.size === 0, 'Senden schreibt nichts, solange ausgeschaltet');
  C._render();
  check(/Problem melden/.test(el('chatBadge').innerHTML), 'Kopfzeile zeigt nur „Problem melden“');
  App.db.run("INSERT INTO einstellungen (schluessel,wert) VALUES ('kollegen_anzeige','1')"); App._kollegenCache = null;
  check(C.an() === true && C.aktiv() === true, 'Einstellung kollegen_anzeige=1 schaltet den Chat ein');
}

console.log('══ Senden: eigene Datei, Anhängen ══');
{
  check(C._dateiName() === 'chat_test_client-AAAA.jsonl', `Dateiname je Rechner (${C._dateiName()})`);
  check(C.absender() === 'Anna', 'Absender ist der aktive Prüfer');
  check(await C.senden('Hallo zusammen') === true, 'Nachricht gesendet');
  check(await C.senden('Zweite Nachricht') === true, 'Zweite Nachricht gesendet');
  const z = zeilen('chat_test_client-AAAA.jsonl');
  check(z.length === 2 && z[0].text === 'Hallo zusammen' && z[1].text === 'Zweite Nachricht', 'Beide Zeilen stehen angehängt in der EIGENEN Datei');
  check(z.every(x => x.c === 'client-AAAA' && x.von === 'Anna' && x.ts > 0 && x.id), 'Jede Zeile trägt Rechner, Absender, Zeit und Kennung');
  check(store.size === 1, 'Es wird nur in die eigene Datei geschrieben');
  check(C._nachrichten.length === 2, 'Eigene Nachrichten stehen sofort im Verlauf');
  check(await C.senden('   ') === false && zeilen('chat_test_client-AAAA.jsonl').length === 2, 'Leere Nachricht wird nicht gesendet');
  const lang = 'x'.repeat(C.MAX_LAENGE + 200);
  await C.senden(lang);
  check(zeilen('chat_test_client-AAAA.jsonl').pop().text.length === C.MAX_LAENGE, `Nachricht wird auf ${C.MAX_LAENGE} Zeichen gekürzt`);
}

console.log('══ Empfangen: Leseposition, eigene Zeilen, Direktnachrichten ══');
{
  const vorher = C._nachrichten.length;
  fremdSenden('client-BBBB', 'Bernd', 'Bin gleich im Termin');
  check(await C.abholen() === 1 && C._nachrichten.length === vorher + 1, 'Fremde Nachricht wird gelesen');
  check(await C.abholen() === 0, 'Zweiter Abruf liest nichts doppelt (Leseposition)');
  fremdSenden('client-BBBB', 'Bernd', 'Und noch eine');
  check(await C.abholen() === 1, 'Nur die neue Zeile wird nachgelesen');
  check(!C._nachrichten.some(n => n.c === 'client-AAAA' && C._offsets['chat_test_client-AAAA.jsonl'] === undefined), 'Eigene Datei wird nicht zurückgelesen');
  const eigeneVorLesen = C._nachrichten.filter(n => n.c === 'client-AAAA').length;
  await C.abholen();
  check(C._nachrichten.filter(n => n.c === 'client-AAAA').length === eigeneVorLesen, 'Eigene Nachrichten werden durch das Abholen nicht verdoppelt');
  fremdSenden('client-CCCC', 'Clara', 'Nur für Anna', 'client-AAAA');
  fremdSenden('client-CCCC', 'Clara', 'Nur für Bernd', 'client-BBBB');
  await C.abholen();
  check(C._nachrichten.some(n => n.text === 'Nur für Anna'), 'Direktnachricht an mich kommt an');
  check(!C._nachrichten.some(n => n.text === 'Nur für Bernd'), 'Direktnachricht an jemand anderen wird verworfen');
  // Kaputte Zeile darf den Rest nicht blockieren
  const nm = 'chat_test_client-DDDD.jsonl';
  store.set(nm, { data: enc.encode('{kaputt\n' + JSON.stringify({ id: 'd1', c: 'client-DDDD', von: 'Dora', text: 'Trotzdem da', ts: Date.now() }) + '\n'), mtime: Date.now() });
  await C.abholen();
  check(C._nachrichten.some(n => n.text === 'Trotzdem da'), 'Unlesbare Zeile wird übersprungen, gültige gelesen');
}

console.log('══ Toast, Verlauf und Ungelesen-Stand ══');
{
  elemente.toastContainer = elemente.toastContainer || el('toastContainer');
  elemente.toastContainer.kinder = [];
  C._offen = false;
  const vorher = C.ungelesen();
  fremdSenden('client-BBBB', 'Bernd', 'Schaust du mal drauf?');
  await C.abholen();
  check(elemente.toastContainer.kinder.length === 1, 'Geschlossenes Fenster: Nachricht erscheint als Hinweis');
  check(C.ungelesen() === vorher + 1, 'Ungelesen-Zähler steigt');
  check(elemente.chatBadge && /1|[0-9]+/.test(String(elemente.chatBadge.innerHTML)) && elemente.chatBadge.style.color === 'var(--clr-amber)', 'Kopfzeile zeigt den Zähler hervorgehoben');
  C.oeffnen();
  check(C._offen === true && /chatVerlauf/.test(modalHtml) && /Nicht vertraulich/.test(modalHtml) && /Automatische Löschung nach 7 Tagen/.test(modalHtml), 'Fenster mit Verlauf und Datenschutz-Hinweis');
  check(/Schaust du mal drauf\?/.test(elemente.chatVerlauf.innerHTML) && /Ich/.test(elemente.chatVerlauf.innerHTML), 'Verlauf zeigt fremde und eigene Nachrichten');
  check(C.ungelesen() === 0, 'Öffnen setzt den Ungelesen-Stand zurück');
  check(String(speicher['bhk_chat_gesehen_test'] || speicher[Object.keys(speicher).find(k => k.includes('chat_gesehen')) || ''] || '') !== '', 'Gelesen-Stand wird lokal gespeichert (kein Netzzugriff)');
  elemente.toastContainer.kinder = [];
  fremdSenden('client-BBBB', 'Bernd', 'Noch was');
  await C.abholen();
  check(elemente.toastContainer.kinder.length === 0 && C.ungelesen() === 0, 'Bei offenem Fenster kein Hinweis, direkt im Verlauf');
  C.schliessen();
  check(C._offen === false, 'Fenster geschlossen');
}

console.log('══ Aufbewahrung und Dateigröße ══');
{
  const alt = Date.now() - (C.AUFBEWAHRUNG_TAGE + 1) * 86400000;
  fremdSenden('client-EEEE', 'Emil', 'Uralt', '', alt);
  store.set('chat_test_client-EEEE.jsonl', { data: store.get('chat_test_client-EEEE.jsonl').data, mtime: alt });
  await C.abholen();
  check(!store.has('chat_test_client-EEEE.jsonl') && !C._nachrichten.some(n => n.text === 'Uralt'), `Dateien älter als ${C.AUFBEWAHRUNG_TAGE} Tage werden gelöscht und nicht gelesen`);
  // Eigene Datei künstlich über die Grenze bringen
  store.set(C._dateiName(), { data: new Uint8Array(C.DATEI_MAX_BYTES + 10), mtime: Date.now() });
  await C.senden('Nach dem Überlauf');
  const z = zeilen(C._dateiName());
  check(z.length === 1 && z[0].text === 'Nach dem Überlauf', 'Zu große eigene Datei wird ersetzt statt endlos zu wachsen');
  check(store.get(C._dateiName()).data.length < 1000, 'Neue Datei ist wieder klein');
}

console.log('══ Sperren und Störfälle ══');
{
  App.offlineModus = true;
  check(C.aktiv() === false && /Offline/.test(C._grund()), 'Offline-Modus: Chat ruht');
  check(await C.senden('geht nicht') === false && toasts.at(-1)[1] === 'warning', 'Senden im Offline-Modus wird abgelehnt');
  check(await C.abholen() === 0, 'Kein Abruf im Offline-Modus');
  App.offlineModus = false;
  App._netzWeg = true;
  check(C.aktiv() === false && /Netzlaufwerk/.test(C._grund()) && await C.senden('auch nicht') === false, 'Netzabriss: Chat ruht');
  App._netzWeg = false;
  const vorher = zeilen(C._dateiName()).length;
  fehlerEinmal = Object.assign(new Error('An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.'), { name: 'InvalidStateError' });
  App._handlesNeuHolen = async () => true;
  check(await C.senden('nach Cache-Fehler') === true && zeilen(C._dateiName()).length === vorher + 1, 'Veralteter Zugriffspunkt: erneuern und einmal wiederholen');
  check(C.aktiv() === true, 'Danach wieder aktiv');
  // Dauerhafter Cache-Fehler: höchstens ein zweiter Versuch, keine Endlosschleife
  let n = 0;
  const echtesCreate = fakeDir.getFileHandle.bind(fakeDir);
  fakeDir.getFileHandle = async (name, o) => {
    const h = await echtesCreate(name, o);
    const orig = h.createWritable.bind(h);
    h.createWritable = async () => { n++; const e = new Error('state had changed since it was read from disk'); e.name = 'InvalidStateError'; throw e; };
    return h;
  };
  check(await C.senden('geht dauerhaft schief') === false && n === 2, `Genau ein Wiederholungsversuch beim Senden (${n} Versuche)`);
  fakeDir.getFileHandle = echtesCreate;
  check(/_anhaengen\(n, 1\)/.test(CHAT_SRC) && /versuch === 0/.test(CHAT_SRC), 'Die Begrenzung steht im Quelltext');
}

console.log('══ Symbol immer sichtbar, Melde-Link ══');
{
  C._nachrichten = [];
  App.offlineModus = true;
  C._render();
  const b = elemente.chatBadge;
  check(b.style.display === '' && /Nachrichten/.test(b.innerHTML), 'Symbol bleibt sichtbar, auch offline und ohne Nachrichten');
  check(b.style.opacity === '0.55' && /Offline/.test(b.title), 'Offline wird durch blasse Darstellung und Hinweis kenntlich');
  App.offlineModus = false;
  C._render();
  check(elemente.chatBadge.style.opacity === '' && /Strg\+M/.test(elemente.chatBadge.title) && /F2/.test(elemente.chatBadge.title), 'Beschriftung nennt beide Tastenkürzel');
  sandbox.Melden = { oeffnen() { sandbox.__meldenOffen = true; } };
  C.oeffnen();
  check(/Problem melden/.test(modalHtml) && /Melden\.oeffnen\(\)/.test(modalHtml), 'Melde-Link steht im Nachrichtenfenster');
  check(/id="chatBadge"/.test(read('index.html')) && !/id="chatBadge" style="display:none/.test(read('index.html')), 'Kopfzeile blendet das Symbol nicht mehr aus');
}

console.log('══ Einbau ══');
{
  check(/await Chat\.abholen\(\)/.test(APP_SRC.split('this._schedulePoll = () => {')[1] || ''), 'Abruf hängt am Abgleich-Takt (kein eigener Timer)');
  check(/id="chatBadge"/.test(read('index.html')) && /Chat\.oeffnen\(\)/.test(read('index.html')) && /chat\.js/.test(read('index.html')), 'Kopfzeile und Skript eingebunden');
  check(/chat\.js/.test(read('build.sh')), 'Modul im Build');
  check(/toast-chat/.test(read('src/css/styles.css')) && /toast-chat/.test(CHAT_SRC), 'Eigene Toast-Gestaltung für Nachrichten');
  check(/e\.key === 'm'/.test(read('src/js/modules/keyboard-shortcuts.js')) && /Ctrl\+M/.test(read('src/js/modules/global-search.js')), 'Strg+M öffnet die Nachrichten und steht in der Kürzel-Hilfe');
  check(/Nicht vertraulich/.test(read('src/js/modules/views.js')), 'Hilfetext nennt die fehlende Vertraulichkeit');
  check(!/INSERT INTO|App\.run\(/.test(CHAT_SRC), 'Der Chat schreibt NICHTS in die Datenbank');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
