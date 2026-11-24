// ═══════════════════════════════════════════════════════════════════
//  Teil 1 des Berichtshefts (Pflichtteile und Hinweise), Umbau Nov. 2026:
//  Reihenfolge nach Nummern, Kennzeichnung Pflicht / § 43 / Hinweis,
//  neue Auswahlwerte (1.4 „Unterschrift fehlt“, 1.6 „Skizze nicht
//  vorhanden“), 1.5 als Anzahl + Zusammenstellung, kurze Sätze in der
//  Bemerkung und ausformulierte in Schreiben, „Erfahrungsberichte“,
//  Anzahl Pflanzenberichte, Nachweisweg „fehlendes Wetter“ entfallen
//  Ausführen:  node tests/pflichtteile-test.mjs
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
const K = read('src/js/modules/kontrolle.js');

let ok = 0, fehler = 0;
const check = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text); } else { fehler++; console.log('  ✗ FEHLER: ' + text); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const els = {};
const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { stapel: [], push(text, undo, redo) { this.stapel.push({ text, undo, redo }); }, clear() {} },
  confirm: () => true, esc: (x) => String(x ?? ''), todayStr: () => '2026-11-24',
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav'], ['src/js/modules/workflows.js', 'Workflows']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const App = sandbox.__App, KH = sandbox.KontrolleHandler, WF = sandbox.Workflows, Undo = sandbox.UndoManager;
App.db = db; App.demoMode = true; App.markDirty = () => {}; App.toast = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
KH.renderSchueler = () => {}; KH.renderUebersicht = () => {}; KH._pruefeAbgeschlossen = () => true; KH.isLockedByOther = () => false;
KH._wvNachErgebnis = () => null; KH.weiterModus = () => 'bleiben';

db.run("INSERT OR IGNORE INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (901,'T36','GaLaBau Test','Gärtner'),(902,'TZP','Zierpflanzenbau Test','Gärtner'),(903,'TFW','Fachwerker Gartenbau Test','Fachwerker')");
db.run("INSERT INTO schueler (id,nachname,vorname,aktiv,fachrichtung_id,ausbildungsbeginn,ausbildungsende) VALUES (1,'Adler','Anna',1,902,'2024-09-01','2027-08-31')");
db.run("INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-11-20','geplant')");
db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend,geprueft_kws) VALUES (101,10,1,'',1,'{}')");
KH.currentTerminId = 10; KH.currentSchuelerList = App.query('SELECT * FROM schueler'); KH.currentIndex = 0; KH.activePruefer = 'Pix';
const ke = () => App.query('SELECT * FROM kontrollergebnisse WHERE id=101')[0];

console.log('\n══ Reihenfolge und Kennzeichnung ══');
{
  check(App.PFLICHT_TEILE.map(t => t.nr).join(' ') === '1.1 1.2 1.4 1.5 1.6', 'Teile aufsteigend nach Nummern wie im Register');
  const art = (nr) => { const t = App.PFLICHT_TEILE.find(x => x.nr === nr); return `${t.art}${t.zul ? '+zul' : ''}`; };
  check(art('1.1') === 'pflicht+zul' && art('1.5') === 'pflicht+zul' && art('1.4') === 'pflicht' && art('1.2') === 'hinweis' && art('1.6') === 'hinweis', '1.1/1.5 Pflicht mit § 43, 1.4 Pflicht ohne Zulassungswirkung, 1.2/1.6 Hinweis');
  const karte = K.split('<!-- Teil 1 des Berichtshefts')[1].split('<!-- KW Grids -->')[0];
  const folge = [...karte.matchAll(/<span class="pfl-nr[^"]*">(\d\.\d)<\/span>/g)].map(m => m[1]).join(' ');
  check(folge === '1.1 1.2 1.4 1.5 1.6', `Karte zeichnet in dieser Reihenfolge (${folge})`);
  check(/pfl-marke--pflicht/.test(K) && /pfl-marke--hinweis/.test(K) && /class="pfl-zul"/.test(K) && /class="pfl-legende"/.test(karte), 'Marken „Pflicht“, „§ 43“, „Hinweis“ mit Legende');
  check(/aria-label="\$\{esc\(titel \|\| name\)\}"/.test(K) && /aria-label="Anzahl der ÜBA-Bescheinigungen"/.test(karte) && /aria-label="1\.5 Zusammenstellung der Bescheinigungen"/.test(karte), 'Auswahlen und Zahlenfeld sind beschriftet');
  const C = read('src/css/styles.css').split('/* Teil 1 des Berichtshefts')[1].split('/* Vorlage des Berichtshefts')[0];
  check(!/font-size: (?:[0-9]|1[01])px/.test(C) && /\.pfl-wahl:focus-visible/.test(C), 'Stile: Schrift ≥ 12 px, sichtbarer Fokus');
  check(/\.ke-zeile2 textarea \{[^}]*font-size: 14px/.test(read('src/css/styles.css')), 'Bemerkungsfeld mit 14 px Schrift');
}

console.log('\n══ Auswahlwerte ══');
{
  const opt = (f) => App.PFLICHT_OPTIONEN[f].map(o => o[1]).join(' / ');
  check(opt('p_1_1_ausbildungsplan') === 'vorhanden / nicht vorhanden' && App.pflichtWert('p_1_1_ausbildungsplan', 'nein') === 'nicht_vorhanden' && App.pflichtLabel('p_1_1_ausbildungsplan', 'nein') === 'nicht vorhanden', '1.1: vorhanden / nicht vorhanden – ein altes „Nein“ heißt „nicht vorhanden“');
  check(opt('p_1_4_auszubildende') === 'geführt / nicht geführt / Unterschrift fehlt / nicht vorhanden', '1.4: vier Werte');
  check(opt('zusammenstellung') === 'geführt / nicht geführt / nicht vorhanden', '1.5 Zusammenstellung: drei Werte');
  check(opt('f_1_6_ausbildungsbetrieb') === 'geführt / nicht geführt / Skizze nicht vorhanden / alles nicht vorhanden', '1.6: vier Werte');
  check(opt('f_1_2_vertragliche_regelungen') === 'Ja / Nein / Nicht vorhanden', '1.2 bleibt, wie es war');
  check(App.pflichtStufe('p_1_4_auszubildende', 'ja') === 'gut' && App.pflichtStufe('p_1_4_auszubildende', 'unterschrift') === 'teil' && App.pflichtStufe('f_1_6_ausbildungsbetrieb', 'nicht_vorhanden') === 'mangel' && App.pflichtStufe('p_1_4_auszubildende', '') === '', 'Farbstufe: gut / teilweise / Mangel');
  // Datenbank nimmt die neuen Werte an
  let fehlerText = '';
  try { App.run("UPDATE kontrollergebnisse SET p_1_4_auszubildende='unterschrift', f_1_6_ausbildungsbetrieb='skizze' WHERE id=101"); } catch (e) { fehlerText = e.message; }
  check(!fehlerText && ke().p_1_4_auszubildende === 'unterschrift' && ke().f_1_6_ausbildungsbetrieb === 'skizze', 'Neue Datenbank speichert „unterschrift“ (1.4) und „skizze“ (1.6)');
  let abgewiesen = false;
  try { db.run("UPDATE kontrollergebnisse SET p_1_4_auszubildende='quatsch' WHERE id=101"); } catch (e) { abgewiesen = true; }
  check(abgewiesen, 'Unbekannte Werte weist die Datenbank weiter ab');
  App.run("UPDATE kontrollergebnisse SET p_1_4_auszubildende='', f_1_6_ausbildungsbetrieb='' WHERE id=101");
  // Alt-Datenbank mit der alten Prüfregel
  const alt = new SQL.Database();
  alt.run(`CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT '',
    p_1_4_auszubildende TEXT DEFAULT '' CHECK (p_1_4_auszubildende IN ('','ja','nein','nicht_vorhanden')),
    f_1_6_ausbildungsbetrieb TEXT DEFAULT ''  CHECK(f_1_6_ausbildungsbetrieb IN ('','ja','nein','nicht_vorhanden')), bemerkung TEXT DEFAULT '');
    INSERT INTO kontrollergebnisse (id, p_1_4_auszubildende) VALUES (1,'ja'),(2,'nein');`);
  let vorher = false; try { alt.run("UPDATE kontrollergebnisse SET p_1_4_auszubildende='unterschrift' WHERE id=1"); } catch (e) { vorher = true; }
  check(vorher && App._migratePflichtCheck(alt) === true, 'Alt-Datenbank weist den neuen Wert ab – die Migration erweitert die Regel');
  alt.run("UPDATE kontrollergebnisse SET p_1_4_auszubildende='unterschrift', f_1_6_ausbildungsbetrieb='skizze' WHERE id=1");
  const zeilen = alt.exec('SELECT id, p_1_4_auszubildende, f_1_6_ausbildungsbetrieb FROM kontrollergebnisse ORDER BY id')[0].values;
  check(JSON.stringify(zeilen) === '[[1,"unterschrift","skizze"],[2,"nein",""]]' && App._migratePflichtCheck(alt) === false, 'Danach speichert sie die neuen Werte, bestehende Zeilen bleiben; zweiter Lauf ändert nichts');
  check(/this\._migratePflichtCheck\(diskDb\)/.test(APP_SRC) && /this\._migratePflichtCheck\(this\.db\)/.test(APP_SRC), 'Migration läuft in migrateDB und _migrateDiskDb');
}

console.log('\n══ 1.5: Anzahl und eine Auswahl „Zusammenstellung“ ══');
{
  const z = (a, b) => App.zusammenstellung({ p_1_5_bescheinigungen: a, p_1_5_gefuehrt: b });
  check(z('ja', 'ja') === 'ja' && z('ja', '') === 'ja' && z('ja', 'nein') === 'nein' && z('nicht_vorhanden', 'ja') === 'nicht_vorhanden' && z('nein', '') === 'nicht_vorhanden' && z('', '') === '', 'Sicht auf die zwei Felder (alte „Ja“ = geführt)');
  Undo.stapel.length = 0;
  KH.zusammenstellungSetzen('nein');
  check(ke().p_1_5_bescheinigungen === 'ja' && ke().p_1_5_gefuehrt === 'nein' && /^1\.5 .*wird nicht geführt\.$/.test(ke().bemerkung), '„nicht geführt“: Seite da, nicht geführt – kurzer Satz in der Bemerkung');
  check(Undo.stapel.length === 1 && /Zusammenstellung \(1\.5\)/.test(Undo.stapel[0].text), 'Ein Rückgängig-Schritt für beide Felder');
  Undo.stapel[0].undo();
  check(ke().p_1_5_bescheinigungen === '' && ke().p_1_5_gefuehrt === '' && ke().bemerkung === '', 'Rückgängig stellt beide Felder und die Bemerkung zurück');
  KH.zusammenstellungSetzen('nicht_vorhanden');
  check(ke().p_1_5_bescheinigungen === 'nicht_vorhanden' && ke().bemerkung === '1.5 Zusammenstellung der ÜBA-Bescheinigungen fehlt.', '„nicht vorhanden“ setzt nur den Satz „fehlt“');
  KH.zusammenstellungSetzen('ja');
  check(ke().p_1_5_bescheinigungen === 'ja' && ke().p_1_5_gefuehrt === 'ja' && ke().bemerkung === '', '„geführt“ nimmt den Satz heraus');
  KH.saveField('bescheinigungen_anzahl', '');
  check(ke().bescheinigungen_anzahl === 0, 'Leeres Zahlenfeld = 0');
  KH.saveField('bescheinigungen_anzahl', '2');
  check(ke().bescheinigungen_anzahl === 2 && KH.pflichtteileOK({ ...ke(), p_1_1_ausbildungsplan: 'ja' }, App.getRequiredUBA(902)) === true, 'Anzahl 2 erfüllt das Soll im Produktionsgartenbau');
  check(App.getRequiredUBA(902) === 2 && App.ubaGruppe(902) === 'Produktion' && App.getRequiredUBA(901) === 6 && App.ubaGruppe(901) === 'GaLaBau' && App.getRequiredUBA(903) === 1 && App.ubaGruppe(903) === 'Fachwerker', 'Soll und Gruppe: GaLaBau 6, Produktion 2, Fachwerker 1');
  const stand = KH._ubaStandHtml({ fachrichtung_id: 903 }, 0);
  check(/0\/1 \(Fachwerker\)/.test(stand) && !/Prod/.test(stand) && /2\/2 \(Produktion\) ✓/.test(KH._ubaStandHtml({ fachrichtung_id: 902 }, 2)), 'Anzeige nennt die richtige Gruppe (Fachwerker stand vorher als „Prod.“)');
  check(!/pflichtOptHtml\('p_1_5_bescheinigungen'/.test(K) && /id="keUbaAnzahl"/.test(K) && /id="keZusammenstellung"/.test(K), 'Kein Dropdown mehr neben der Anzahl');
}

console.log('\n══ Sätze: kurz in der Bemerkung, ausformuliert in Schreiben ══');
{
  const laengste = Math.max(...Object.values(App.HINWEISE_KURZ).flatMap(o => Object.values(o)).map(t => t.length));
  check(laengste <= 70, `Kurze Sätze höchstens 70 Zeichen (längster: ${laengste})`);
  check(Object.keys(App.HINWEISE_KURZ).every(f => Object.keys(App.HINWEISE_KURZ[f]).every(v => App.HINWEISE_MAIL[f] && App.HINWEISE_MAIL[f][v] && /Bitte /.test(App.HINWEISE_MAIL[f][v]))), 'Zu jedem kurzen Satz gibt es eine ausformulierte Bitte');
  check(App.autoHinweisPflicht('p_1_4_auszubildende', 'unterschrift') === '1.4 Angaben zur/zum Auszubildenden: Unterschrift fehlt.' && App.autoHinweisPflicht('p_1_4_auszubildende', 'nein') === '1.4 Angaben zur/zum Auszubildenden nicht ausgefüllt.' && App.autoHinweisPflicht('p_1_4_auszubildende', 'nicht_vorhanden') === '1.4 Angaben zur/zum Auszubildenden fehlen.' && App.autoHinweisPflicht('p_1_4_auszubildende', 'ja') === null, '1.4: je Wert ein eigener Satz');
  check(App.autoHinweisPflicht('f_1_6_ausbildungsbetrieb', 'skizze') === '1.6 Betriebsskizze fehlt.' && /Betriebsskizze \(Teil 1\.6\) fehlt\. Bitte/.test(App.autoHinweisPflicht('f_1_6_ausbildungsbetrieb', 'skizze', 'mail')), '1.6 „Skizze nicht vorhanden“: kurz und für Schreiben');
  KH.saveField('p_1_4_auszubildende', 'unterschrift');
  check(ke().bemerkung === '1.4 Angaben zur/zum Auszubildenden: Unterschrift fehlt.', 'Auswahl schreibt den Satz in die Bemerkung');
  KH.saveField('p_1_4_auszubildende', 'nicht_vorhanden');
  check(ke().bemerkung === '1.4 Angaben zur/zum Auszubildenden fehlen.', 'Wechsel des Werts tauscht den Satz (keine zwei Sätze zu 1.4)');
  KH.saveField('p_1_4_auszubildende', 'ja');
  check(ke().bemerkung === '', '„geführt“ nimmt ihn heraus');
  // Alte lange Sätze bleiben als automatisch erkannt
  const altLang = App.HINWEISE_ALT.p_1_1_ausbildungsplan[0];
  check(App._autoZeileKey(altLang) === 'p_1_1_ausbildungsplan' && App._autoZeileKey(App.HINWEISE_ALT.p_1_4_auszubildende[0]) === 'p_1_4_auszubildende' && App._autoZeileKey('Eigener Text zum Plan') === null, 'Frühere lange Sätze gelten weiter als automatische Zeile');
  check(WF._bemerkungFuerBetrieb({ bemerkung: 'Bitte Heft ordentlicher führen\n' + altLang }).join('|') === 'Bitte Heft ordentlicher führen', 'Ein alter langer Satz geht nicht als „eigene Bemerkung“ an den Betrieb');
  check(App.bemerkungMitAutoZeilen('Eigener Text\n' + altLang, { p_1_1_ausbildungsplan: App.autoHinweisPflicht('p_1_1_ausbildungsplan', 'nicht_vorhanden') }) === 'Eigener Text\n1.1 Ausbildungsplan fehlt.', 'Beim nächsten Nachziehen ersetzt die kurze Fassung die lange');
  const block = WF._nachzuholen({ maengel: [], ke: { p_1_1_ausbildungsplan: 'ja', p_1_1_unterschrift: 'nein', p_1_4_auszubildende: 'nein' } });
  check(block.length === 2 && /^Im individuellen Ausbildungsplan \(Teil 1\.1\) fehlen Unterschriften\. Bitte/.test(block[0]) && /Teil 1\.4\) ist nicht ausgefüllt\. Bitte/.test(block[1]), 'E-Mail/Brief an den Betrieb: ausformulierte Sätze');
  check(KH.pflichtteileOK({ p_1_1_ausbildungsplan: 'ja', p_1_5_bescheinigungen: 'ja', bescheinigungen_anzahl: 2, p_1_4_auszubildende: 'nicht_vorhanden', f_1_6_ausbildungsbetrieb: 'skizze' }, 2) === true, '1.4 und 1.6 berühren die Berichtsheft-Voraussetzung der Zulassung nicht');
}

console.log('\n══ Erfahrungsberichte, Pflanzenberichte, Nachweiswege ══');
{
  const quellen = ['src/js/app-core.js', 'src/js/utils.js', 'index.html', ...fs.readdirSync(path.join(ROOT, 'src/js/modules')).map(f => 'src/js/modules/' + f)];
  // Erlaubt bleiben nur die Alt-Wortlaute, an denen die beiden Migrationen alte Texte erkennen
  const reste = quellen.flatMap(f => read(f).split('\n').filter(z => /Sachbericht/.test(z)).map(z => ({ f, z })));
  const inMigration = (r) => r.f === 'src/js/app-core.js' && (/Zusatzvereinbarung/.test(r.z) || /heißen „Erfahrungsberichte“/.test(r.z) || /replace\(\/Sachbericht\/g/.test(r.z));
  check(reste.length === 5 && reste.every(inMigration), `„Sachberichte“ steht nur noch in den Alt-Wortlauten der Migrationen (${reste.length} Zeilen)`);
  check(/Erfahrungsberichte:/.test(K) && /Pflanzenberichte:/.test(K) && /saveField\('pflanzenberichte_anzahl',this\.value\)/.test(K), 'Zählfelder „Erfahrungsberichte“ und „Pflanzenberichte“ unter den Fehltagen');
  check(App.query('PRAGMA table_info(kontrollergebnisse)').some(c => c.name === 'pflanzenberichte_anzahl') && (APP_SRC.match(/ADD COLUMN pflanzenberichte_anzahl INTEGER DEFAULT 0/g) || []).length === 2 && /'sachberichte_anzahl','pflanzenberichte_anzahl'/.test(APP_SRC), 'Spalte pflanzenberichte_anzahl: Schema, beide Migrationen, mergeColumns');
  KH.saveField('pflanzenberichte_anzahl', '7'); KH.saveField('sachberichte_anzahl', '');
  check(ke().pflanzenberichte_anzahl === 7 && ke().sachberichte_anzahl === 0, 'Beide Angaben freiwillig: leer = 0');
  // Gespeicherte Texte werden einmalig umbenannt
  App.run("DELETE FROM einstellungen WHERE schluessel='erfahrungsberichte_v1'");
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)", [JSON.stringify(['Sachberichte fehlen teilweise', 'Eigener Baustein'])]);
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('vorlage_betrieb_bcc_body','Bitte auch die Sachberichte mitbringen.')");
  App.migrateDB();
  check(JSON.stringify(App.getTextbausteine()) === '["Erfahrungsberichte fehlen teilweise","Eigener Baustein"]' && App.getVorlage('betrieb_bcc').body === 'Bitte auch die Erfahrungsberichte mitbringen.', 'Gespeicherte Textbausteine und Vorlagen tragen den neuen Namen');
  App.run("UPDATE einstellungen SET wert='Sachberichte von Hand' WHERE schluessel='vorlage_betrieb_bcc_body'");
  App.migrateDB();
  check(App.getVorlage('betrieb_bcc').body === 'Sachberichte von Hand', 'Die Umbenennung läuft nur einmal');
  App.run("DELETE FROM einstellungen WHERE schluessel IN ('vorlage_betrieb_bcc_body','textbausteine_bemerkung')");
  check(App.wegeWaehlbar('').map(w => w.val).join(' ') === 'naechste_durchsicht email post persoenlich', 'Nachweiswege: „fehlendes Wetter per E-Mail“ ist nicht mehr wählbar');
  check(App.wegeWaehlbar('email_sachberichte').length === 5 && App.ergebnisAus('maengel', 'email_sachberichte') === 'sachberichte_wetter_email', 'Ein altes Ergebnis mit diesem Weg bleibt les- und speicherbar');
  check(App.HINWEISE_CODES.D === 'Wetterangaben nachtragen', 'Fehlendes Wetter: Nachtrag (Code D)');
}

console.log('\n══ Ausgaben ══');
{
  const P = read('src/js/modules/pdf-export.js');
  check(/App\.pflichtLabel\(feld, v\)/.test(P) && /App\.pflichtStufe\(feld, v\)/.test(P) && !/valLabel/.test(P), 'Bogen nimmt Beschriftung und Farbe aus dem Kern');
  const arch = KH._pflichtArchiv({ p_1_1: 'nein', p_1_4: 'unterschrift', p_1_5: 'ja', g_1_5: 'nein', besch_anz: 1, f_1_2: 'ja', f_1_6: 'skizze' });
  check(arch.map(a => a[0]).join(' ') === '1.1 1.2 1.4 1.5 1.6' && arch[0][2] === 'nicht vorhanden' && arch[2][2] === 'Unterschrift fehlt' && arch[3][2] === '1 Stk. – Zusammenstellung nicht geführt' && arch[4][2] === 'Skizze nicht vorhanden', 'Archiv-Ansicht: aufsteigend, mit den Beschriftungen der Auswahl');
  const V = read('src/js/modules/views.js');
  check(/1\.4 „Der\/die Auszubildende“ ist Pflicht, aber nicht zulassungsrelevant/.test(V) && !/Wetter\/Erfahrungsberichte per E-Mail/.test(V), 'Hilfe beschreibt den neuen Block');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fehler} Fehler ═══`);
process.exit(fehler ? 1 : 0);
