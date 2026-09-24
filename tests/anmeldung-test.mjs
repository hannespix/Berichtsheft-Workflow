// ═══════════════════════════════════════════════════════════════════
//  Anmeldung: Wer arbeitet an diesem Rechner? – Auswahl aus der Prüferliste
//  beim Start, Merken im Browser, Vorauswahl beim nächsten Start, neuer Name,
//  Wechsel oben rechts; kein Chat, keine Meldungen, keine Präsenz mehr
//  Ausführen:  node tests/anmeldung-test.mjs
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

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, options: [], classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const speicher = {};
let modal = null; let geschlossen = 0; const toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: '', currentTerminId: null },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
const App = sandbox.__App;
App.db = new SQL.Database(); App.db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
App.toast = (m, t) => toasts.push([String(m), t]); App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.openModal = (t, html, footer) => { modal = { titel: String(t), html: String(html), footer: String(footer || '') }; };
App.closeModal = () => { geschlossen++; };
App._restoreUserSettings = () => { App.__restored = (App.__restored || 0) + 1; };
App.db.run("INSERT INTO pruefer (name,aktiv) VALUES ('Pix, Hannes',1),('Zilz, Petra',1),('Alt, Egon',0)");

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

console.log('══ Erster Start: Auswahl ohne Vorauswahl ══');
{
  App.currentUser = '';
  App.anmeldung();
  check(modal && /Wer arbeitet an diesem Rechner/.test(modal.titel), 'Anmeldefenster erscheint');
  check(/Pix, Hannes/.test(modal.html) && /Zilz, Petra/.test(modal.html) && !/Alt, Egon/.test(modal.html), 'Nur aktive Prüfer zur Auswahl');
  check(!/Weiter als/.test(modal.footer) && !/\(zuletzt/.test(modal.html), 'Ohne gemerkte Person kein „Weiter“');
  check(/id="anmeldungNeu"/.test(modal.html), 'Feld für einen neuen Namen vorhanden');
  App.anmelden('Zilz, Petra');
  check(App.currentUser === 'Zilz, Petra' && speicher.bhk_current_user === 'Zilz, Petra', 'Auswahl gesetzt und im Browser gemerkt');
  check(geschlossen === 1 && App.__restored === 1 && sandbox.KontrolleHandler.activePruefer === 'Zilz, Petra', 'Fenster geschlossen, Einstellungen der Person geladen, Prüfer der Kontrolle gesetzt');
  check(toasts.at(-1) && /Angemeldet als Zilz, Petra/.test(toasts.at(-1)[0]), 'Rückmeldung');
}

console.log('══ Nächster Start: Vorauswahl ══');
{
  App.currentUser = speicher.bhk_current_user;
  App.anmeldung();
  check(/Weiter als Zilz, Petra/.test(modal.footer) && /data-name="Zilz, Petra"/.test(modal.footer), 'Gemerkte Person als „Weiter“-Knopf');
  check(/btn-primary[^>]*data-name="Zilz, Petra"/.test(modal.html) && /\(zuletzt an diesem Rechner\)/.test(modal.html), 'Gemerkte Person in der Liste hervorgehoben');
  App.anmelden('Zilz, Petra');
  check(App.currentUser === 'Zilz, Petra' && geschlossen === 2, 'Ein Klick genügt');
}

console.log('══ Neuer Name ══');
{
  App.anmeldung();
  el('anmeldungNeu').value = '  Neu, Nadine ';
  App.anmeldenNeu();
  check(App.currentUser === 'Neu, Nadine' && App.scalar("SELECT aktiv FROM pruefer WHERE name='Neu, Nadine'") === 1, 'Neuer Name wird als Prüfer angelegt und angemeldet');
  el('anmeldungNeu').value = '';
  App.anmeldenNeu();
  check(App.currentUser === 'Neu, Nadine' && /Namen eingeben/.test(toasts.at(-1)[0]), 'Leerer Name wird abgelehnt');
  App.anmelden('');
  check(App.currentUser === 'Neu, Nadine' && /Namen wählen/.test(toasts.at(-1)[0]), 'Leere Auswahl wird abgelehnt');
  check(App.anmelden('Alt, Egon') === undefined && App.currentUser === 'Alt, Egon', 'Wechsel auf eine andere Person');
}

console.log('══ Start-Ablauf und Aufräumen ══');
{
  const showApp = APP_SRC.split('  showApp() {')[1].split('\n  },')[0];
  check(/this\.anmeldung\(\)/.test(showApp) && /!this\.demoMode/.test(showApp.split('this.anmeldung()')[0].slice(-200)), 'showApp öffnet die Anmeldung, im Demo-Modus nicht');
  check(showApp.indexOf("localStorage.getItem('bhk_current_user')") < showApp.indexOf('this.anmeldung()'), 'Gemerkte Person wird vor der Anmeldung geladen (Vorauswahl)');
  check(!/_praesenzTakt|kollegenAn|onlineNutzer\(|Chat\.|Melden\./.test(APP_SRC), 'Kern ohne Präsenz, Chat und Meldungen');
  check(!fs.existsSync(path.join(ROOT, 'src/js/modules/chat.js')) && !fs.existsSync(path.join(ROOT, 'src/js/modules/melden.js')), 'Module chat.js und melden.js entfernt');
  const html = read('index.html'), build = read('build.sh');
  check(!/chat\.js|melden\.js|chatBadge|meldungBadge|onlineNutzer/.test(html) && !/chat\.js|melden\.js/.test(build), 'index.html und build.sh ohne die Module');
  const ks = read('src/js/modules/keyboard-shortcuts.js');
  check(!/F2|Melden|Chat/.test(ks), 'Keine Tastenkürzel F2 / Strg+M mehr');
  check(typeof App.diagnoseText === 'function' && /Konsolenprotokoll|Ereignisspur|programm:/.test(App.diagnoseText()), 'Zustandsbild (bhk.kopieren) bleibt als Weg zur Entwicklung');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
