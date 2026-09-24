// ═══════════════════════════════════════════════════════════════════
//  Azubi-Seite: eine Seite je Azubi statt drei Dialoge. Die Editoren
//  (Stammdaten bearbeiten, Ausbildungsverlauf, Akte) zeichnen über
//  App.oeffneEditor in Abschnitte der Seite, wenn sie offen ist, sonst in
//  den Dialog. Dazu Kontrollen und Wiedervorlagen des Azubis.
//  Ausführen:  node tests/azubi-seite-test.mjs
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { getSQL, makeSeed, APP_SRC } from './_sync-harness.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

const SQL = await getSQL();
const db = new SQL.Database(makeSeed(SQL, `
  INSERT INTO berufsschulen (id,name,ort) VALUES (1,'BS Freiburg','Freiburg');
  INSERT INTO klassen (id,berufsschule_id,klassenbezeichnung) VALUES (1,1,'GL2');
  UPDATE schueler SET klasse_id=1, ausbildungsstaette='Gärtnerei Test', ibykus_id='I-1', ausbildungsbeginn='2024-09-01', ausbildungsende='2027-08-31', telefon='0761 1', geburtsdatum='2006-05-04' WHERE id=1;
  INSERT INTO kontrolltermine (id,geplant_datum,durchgefuehrt_datum,status,berufsschule_id) VALUES (78,'2026-03-01','2026-03-01','durchgefuehrt',1);
  INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (501,77,1,'in_ordnung'),(502,78,1,'nachholung_naechste_durchsicht');
  INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (601,502,1,'nachreichen','2026-04-01','offen');
  INSERT INTO schueler_bemerkungen (schueler_id,text,erstellt_von) VALUES (1,'Alte Bemerkung','Anna');
`));

// DOM-Attrappe: je Kennung genau ein Element, damit Abschnitte gefunden werden
const elemente = new Map();
const modalAktiv = { an: false };
const el = (id) => {
  if (!elemente.has(id)) elemente.set(id, { id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false, style: {}, dataset: {},
    classList: { add(c) { if (id === 'modalOverlay' && c === 'active') modalAktiv.an = true; }, remove(c) { if (id === 'modalOverlay' && c === 'active') modalAktiv.an = false; }, contains: (c) => id === 'modalOverlay' && c === 'active' ? modalAktiv.an : false, toggle() {} },
    setAttribute() {}, getAttribute: () => null, appendChild() {}, remove() {}, focus() {}, scrollIntoView() {}, contains: () => false, closest: () => null, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] });
  return elemente.get(id);
};
const sandbox = {
  console: { log() {}, warn(...a) { sandbox.__warn.push(a.join(' ')); }, error(...a) { sandbox.__warn.push(a.join(' ')); } }, __warn: [],
  setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Number, String, Array, Object, RegExp,
  document: { getElementById: el, createElement: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { hash: '' }, history: { pushState() {}, back() {} }, innerWidth: 1200,
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => true, esc: (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  todayStr: () => '2026-09-24', dateStr: (d) => d.toISOString().slice(0, 10), formatDate: (d) => d ? String(d).slice(0, 10).split('-').reverse().join('.') : '',
  svgIcon: () => '', Papa: {}, XLSX: {},
  Views: { stammdaten() { sandbox.__views.push('stammdaten'); }, dashboard() {} }, __views: [],
  SchuelerView: { render() {} }, GlobalSearch: {}, WiedervorlagenHandler: { details() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/stammdaten.js', 'StammdatenTab'], ['src/js/modules/import-handler.js', 'ImportHandler'], ['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/schueler-akte.js', 'SchuelerAkte'], ['src/js/modules/azubi-seite.js', 'AzubiSeite']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, AzubiSeite, ImportHandler: IH, SchuelerAkte: SA, Phasen } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.updateBadges = () => {}; App.refreshJgDropdown = () => {}; App._hilfeLinkEinblenden = () => {}; App.kopfZeigen = () => {}; App.closeSidebar = () => {};
App.migrateDB();

console.log('══ Registrierung ══');
{
  check(/<script src="src\/js\/modules\/azubi-seite\.js"><\/script>/.test(read('index.html')) && /"src\/js\/modules\/azubi-seite\.js"/.test(read('build.sh')), 'Modul in index.html und build.sh eingetragen');
  check(/azubi: \(\) => AzubiSeite\.render\(\)/.test(APP_SRC) && /azubi: 'help_2'/.test(APP_SRC) && /const menuView = view === 'azubi' \? 'stammdaten' : view/.test(APP_SRC), 'Ansicht „azubi“ im Kern: Rendern, Hilfe-Kapitel, Menüpunkt Stammdaten bleibt markiert');
  check(/oeffneEditor\(abschnitt, id, title, bodyHtml, footerHtml = ''\) \{/.test(APP_SRC), 'App.oeffneEditor vorhanden');
  const ST = read('src/js/modules/stammdaten.js');
  check(/onclick="AzubiSeite\.oeffnen\(\$\{s\.id\}\)" title="Azubi-Seite/.test(ST) && />Öffnen<\/button>/.test(ST) && /AzubiSeite\.oeffnen\(\$\{s\.id\}, 'phasen'\)/.test(ST) && /AzubiSeite\.oeffnen\(\$\{s\.id\}, 'akte'\)/.test(ST), 'Azubi-Liste: Hauptknopf „Öffnen“, Menü springt zu Verlauf und Akte');
  check(/App\.oeffneEditor\('stammdaten', id,/.test(read('src/js/modules/import-handler.js')) && /App\.oeffneEditor\('phasen', schuelerId,/.test(read('src/js/modules/phasen.js')) && /App\.oeffneEditor\('akte', schuelerId,/.test(read('src/js/modules/schueler-akte.js')), 'Die drei Editoren gehen über App.oeffneEditor');
  check(/\.az-seite \{/.test(read('src/css/styles.css')) && /\.az-teil-fuss \{/.test(read('src/css/styles.css')), 'CSS der Seite vorhanden');
}

console.log('\n══ Seite rendern: Abschnitte statt Dialoge ══');
{
  AzubiSeite.oeffnen(1);
  const main = el('mainContent').innerHTML;
  check(App.currentView === 'azubi' && /id="azSeite"/.test(main), 'Ansicht „azubi“ mit Seite');
  check(/Mustermann, Max/.test(main) && /Gärtnerei Test/.test(main) && /GL2 · BS Freiburg/.test(main) && /<strong>2<\/strong> Kontrollen/.test(main) && /<strong>1<\/strong> offene Wiedervorlage</.test(main), 'Kopf: Name, Betrieb, Klasse/Schule, Zahlen (2 Kontrollen, 1 offene WV)');
  for (const k of ['uebersicht', 'kontrollen', 'wiedervorlagen', 'akte']) check(new RegExp(`id="azAbschnitt_${k}"`).test(main) && new RegExp(`id="azTeil_${k}"`).test(main), `Abschnitt ${k}`);
  check(!/id="azAbschnitt_stammdaten"/.test(main) && !/id="azAbschnitt_phasen"/.test(main) && /✎ Bearbeiten/.test(main), 'Formulare erst auf „Bearbeiten“ (Übersicht zuerst)');
  const ue = el('azTeil_uebersicht').innerHTML;
  check(/class="az-strahl"/.test(ue) && /az-strahl-fortschritt/.test(ue) && /1\. LJ/.test(ue) && /aria-label="Ausbildung vom/.test(ue), 'Übersicht: Zeitstrahl mit Lehrjahren und Fortschritt');
  check(/Gärtnerei Test/.test(ue) && /BS Freiburg/.test(ue) && /GL2/.test(ue) && /Kontrollstand/.test(ue) && /Letzte Kontrolle/.test(ue), 'Übersicht: Betrieb, Schule, Klasse, Kontrollstand');
  AzubiSeite.bearbeiten(true);
  const main2 = el('mainContent').innerHTML;
  check(/id="azAbschnitt_stammdaten"/.test(main2) && /id="azAbschnitt_phasen"/.test(main2) && /Bearbeiten beenden/.test(main2), 'Bearbeiten blendet Stammdaten- und Verlaufs-Formular ein');
  check(/id="mSTelefon"/.test(el('azTeil_stammdaten').innerHTML) && /ImportHandler\.updateSchueler\(1\)/.test(el('azTeil_stammdaten').innerHTML), 'Stammdaten-Formular liegt im Abschnitt (Speichern-Knopf)');
  check(!/data-nur-dialog/.test(el('azTeil_stammdaten').innerHTML) && !/App\.closeModal\(\)"/.test(el('azTeil_stammdaten').innerHTML), 'Knöpfe „Abbrechen“, „Akte“, „Phasen“ (nur für den Dialog) entfallen auf der Seite');
  check(/Phasen\.addPhaseForm\(1\)/.test(el('azTeil_phasen').innerHTML) && /Standard-Phase aus Stammdaten erzeugen/.test(el('azTeil_phasen').innerHTML), 'Ausbildungsverlauf liegt im Abschnitt');
  check(/id="mAkteNeueNotiz"/.test(el('azTeil_akte').innerHTML) && /Alte Bemerkung/.test(el('azTeil_akte').innerHTML) && !/App\.closeModal\(\)"/.test(el('azTeil_akte').innerHTML), 'Akte liegt im Abschnitt, ohne „Schließen“');
  check(/In Ordnung/.test(el('azTeil_kontrollen').innerHTML) && /Nachholung/.test(el('azTeil_kontrollen').innerHTML) && /AzubiSeite\.kontrolleOeffnen\(78, 1\)/.test(el('azTeil_kontrollen').innerHTML) && /\(abgeschlossen\)/.test(el('azTeil_kontrollen').innerHTML), 'Kontrollen: beide Ergebnisse mit Absprung in die Durchsicht');
  check(/01\.04\.2026/.test(el('azTeil_wiedervorlagen').innerHTML) && /offen/.test(el('azTeil_wiedervorlagen').innerHTML) && /WiedervorlagenHandler\.details\(601\)/.test(el('azTeil_wiedervorlagen').innerHTML), 'Wiedervorlagen mit Frist, Status und Details');
  check(modalAktiv.an === false, 'Kein Dialog geöffnet');
  check(sandbox.__warn.length === 0, `Keine Warnungen beim Rendern (${sandbox.__warn.slice(0, 2).join(' | ')})`);
}

console.log('\n══ Aktionen auf der Seite ══');
{
  el('mAkteNeueNotiz').value = 'Neue Bemerkung';
  SA.addBemerkung(1);
  check(/Neue Bemerkung/.test(el('azTeil_akte').innerHTML) && modalAktiv.an === false, 'Bemerkung speichern zeichnet den Abschnitt neu, kein Dialog');
  AzubiSeite.bearbeiten(true);
  el('mSTelefon').value = '0761 1'; el('mSNach').value = 'Mustermann'; el('mSVor').value = 'Max'; el('mSStatus').value = 'aktiv';
  IH.updateSchueler(1);
  check(App.scalar('SELECT telefon FROM schueler WHERE id=1') === '0761 1' && App.currentView === 'azubi' && /id="azSeite"/.test(el('mainContent').innerHTML), 'Stammdaten speichern bleibt auf der Seite');
  Phasen.addPhaseForm(1);
  check(modalAktiv.an === true, 'Das Phasen-Formular bleibt ein Dialog');
  Phasen.openPhasenEditor(1);
  check(modalAktiv.an === false && /Phasen\.addPhaseForm\(1\)/.test(el('azTeil_phasen').innerHTML), 'Zurück zur Liste schließt den Dialog und zeichnet den Abschnitt');
  AzubiSeite.oeffnen(1, 'akte');
  check(App.currentView === 'azubi' && AzubiSeite._bearbeiten === false, 'Öffnen mit Sprungziel (Übersichtsmodus)');
  AzubiSeite.oeffnen(1, 'phasen');
  check(AzubiSeite._bearbeiten === true && /id="azAbschnitt_phasen"/.test(el('mainContent').innerHTML), 'Sprungziel „phasen“ schaltet Bearbeiten ein');
  // Rückweg in die Durchsicht
  let geoeffnet = null; AzubiSeite.kontrolleOeffnen = (t, sid) => { geoeffnet = [t, sid]; };
  AzubiSeite.oeffnen(1, 'uebersicht', { zurueck: { terminId: 77, schuelerId: 1 } });
  check(/Zurück zur Durchsicht/.test(el('mainContent').innerHTML), 'Aus der Durchsicht geöffnet: Knopf „Zurück zur Durchsicht“');
  AzubiSeite.zurueck();
  check(geoeffnet && geoeffnet[0] === 77 && geoeffnet[1] === 1, 'Zurück führt in die Durchsicht zum selben Azubi');
  const K = read('src/js/modules/kontrolle.js');
  check(!/Phasen\.editor\(\$\{s\.id\}\)/.test(K) && (K.match(/AzubiSeite\.oeffnen\(\$\{s\.id\}, 'uebersicht', \{ zurueck: \{ terminId: /g) || []).length === 2, 'Durchsicht (Übersicht und Einzelansicht) verlinkt auf die Azubi-Seite mit Rückweg');
  AzubiSeite.oeffnen(1);
  AzubiSeite.zurueck();
  check(App.currentView === 'stammdaten' && sandbox.__views.includes('stammdaten'), 'Zurück zur Azubi-Liste');
  SA.open(1);
  check(modalAktiv.an === true, 'Außerhalb der Seite öffnet die Akte weiter als Dialog');
  App.closeModal();
  check(AzubiSeite.istOffen(1) === false && AzubiSeite.istOffen(2) === false, 'istOffen nur auf der Seite');
  AzubiSeite.oeffnen(2);
  check(AzubiSeite.istOffen(1) === false && AzubiSeite.istOffen(2) === true, 'istOffen nur für den gezeigten Azubi');
  AzubiSeite._id = 999; AzubiSeite.render();
  check(App.currentView === 'stammdaten', 'Unbekannter Azubi führt zurück zur Liste');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
