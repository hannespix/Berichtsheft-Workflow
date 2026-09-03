// ═══════════════════════════════════════════════════════════════════
//  Bedienfluss & Sicherheit (Audit 5): Vorlagen/Textbausteine,
//  Dateinamen, Papierkorb (Azubi + Termin), Lösch-Logbuch
//  Ausführen:  node tests/workflow-test.mjs
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

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { push() {}, clear() {} },
  esc: (x) => String(x ?? ''), todayStr: () => '2026-09-15', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(read('src/js/modules/workflows.js') + '\n;globalThis.Workflows = Workflows;', sandbox, { filename: 'workflows.js' });
sandbox.KontrolleHandler = { activePruefer: 'Muster, Max' };
const { __App: App, Workflows } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
App.currentUser = 'Muster, Max';

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ── Testbestand ──
db.run(`INSERT INTO berufsschulen (id,name,ort) VALUES (1,'BS Freiburg, Hauptstelle','Freiburg')`);
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr,aktiv) VALUES (1,'S2027','Sommer',2027,1)`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung) VALUES (1,1,1,'G2a')`);
db.run(`INSERT INTO betriebe (id,name,betriebsnummer,email) VALUES (10,'Gärtnerei Beispiel','B-1','betrieb@example.org')`);
db.run(`INSERT INTO pruefer (name,email) VALUES ('Muster, Max','max.muster@rpf.bwl.de')`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt,ibykus_id) VALUES
  (1,'Muster','Anna',1,1,1,10,'2024-09-01','2027-08-31','93','IB-1'),
  (2,'Fremd','Ben',1,1,1,10,'2024-09-01','2027-08-31','94','IB-2')`);
db.run(`INSERT INTO kontrolltermine (id,klasse_id,jahrgang_id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (100,1,1,1,'2026-11-17','Muster, Max','geplant','schulkontrolle')`);
db.run(`INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (100,1)`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,fehltage_gesamt,bemerkung) VALUES
  (500,100,1,'nachholung_naechste_durchsicht',2,'Berichte teilweise ohne Datum'),(501,100,2,'in_ordnung',0,'')`);
db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (1,2,40,'F',0,1,500),(1,2,41,'B,H',2,1,500),(1,2,42,'',0,1,500)`);
db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (700,500,1,'nachholung','2026-12-15','offen')`);
db.run(`INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (700,'Telefonat mit Betrieb','Muster, Max')`);
db.run(`INSERT INTO schueler_bemerkungen (schueler_id,text,erstellt_von) VALUES (1,'Aktenvermerk','Muster, Max')`);
db.run(`INSERT INTO einstellungen (schluessel,wert) VALUES ('rp_adresse_post','Regierungspräsidium Freiburg\nAbt. 3'),('rp_email','berichtsheft@rpf.bwl.de')`);

console.log('══ Vorlagen / Textbausteine ══');
{
  check(Object.keys(App.VORLAGEN).length >= 10, `${Object.keys(App.VORLAGEN).length} Vorlagentypen vorhanden`);
  const v = App.getVorlage('schule_anfrage');
  check(v && !v.angepasst && v.body.includes('{schule}'), 'Standardtext wird geliefert, nicht als angepasst markiert');
  check(App.fuellePlatzhalter('Hallo {schule} – {unbekannt}', { schule: 'BS X' }) === 'Hallo BS X – {unbekannt}', 'Unbekannte Platzhalter bleiben stehen, keine "undefined"');
  check(App.fuellePlatzhalter('{anzahl}', { anzahl: 0 }) === '0', 'Nullwert 0 wird eingesetzt (nicht als fehlend behandelt)');
  App.saveVorlage('schule_anfrage', 'Eigener Betreff {schule}', 'Eigener Text {datum}');
  const v2 = App.getVorlage('schule_anfrage');
  check(v2.angepasst && v2.betreff === 'Eigener Betreff {schule}', 'Angepasste Vorlage wird gespeichert und als angepasst erkannt');
  const r = App.renderVorlage('schule_anfrage', { schule: 'BS Y', datum: '01.02.2026' });
  check(r.betreff === 'Eigener Betreff BS Y' && r.body === 'Eigener Text 01.02.2026', 'renderVorlage füllt Betreff und Text');
  App.saveVorlage('schule_anfrage', v.betreff, v.body);
  check(!App.getVorlage('schule_anfrage').angepasst, 'Speichern des Standardtexts entfernt die Überschreibung');
  App.saveVorlage('schule_anfrage', 'x', 'y'); App.resetVorlage('schule_anfrage');
  check(!App.getVorlage('schule_anfrage').angepasst && App.getVorlage('schule_anfrage').body === v.body, 'resetVorlage stellt den Standardtext her');
  const abs = App.absenderCtx('Muster, Max');
  check(abs.pruefer_email === 'max.muster@rpf.bwl.de' && abs.rp_email === 'berichtsheft@rpf.bwl.de' && abs.rp_adresse.startsWith('Regierungspräsidium'), 'absenderCtx: Prüfer-E-Mail aus Stammdaten, RP-Adresse + Funktions-E-Mail aus Einstellungen');
  const ctx = (Workflows._ctxTermin(100) || {}).ctx;
  check(ctx && ctx.schule === 'BS Freiburg, Hauptstelle' && ctx.anzahl === '2', `_ctxTermin: Schule + Anzahl (${ctx && ctx.schule}, ${ctx && ctx.anzahl})`);
  check(ctx && ctx.datum === '17.11.2026' && /Dienstag/.test(ctx.wochentag), `_ctxTermin: Datum + Wochentag (${ctx && ctx.wochentag})`);
  const mail = App.renderVorlage('schule_anfrage', ctx);
  check(!/\{(schule|datum|anzahl|pruefer|rp_adresse)\}/.test(mail.body), 'Terminanfrage: alle Kern-Platzhalter gefüllt');
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('aemter_email','{\"94\":\"ab@rps.bwl.de\"}')");
  check(App.aemterEmails()['94'] === 'ab@rps.bwl.de', 'Ämter-E-Mails aus Einstellungen (JSON)');
}

console.log('══ Dateinamen ══');
{
  check(App.safeFilename(['Übergabe', 'Amt 94', 'BS Freiburg, Hauptstelle', '2026-11-17'], 'xlsx') === 'Uebergabe_Amt_94_BS_Freiburg_Hauptstelle_2026-11-17.xlsx', 'Umlaute transliteriert, Sonderzeichen → _, Endung angehängt');
  check(App.safeFilename('Straße/Weg:Test', '.pdf') === 'Strasse_Weg_Test.pdf', 'Pfad-Zeichen entschärft, Punkt der Endung toleriert');
  check(App.safeFilename(['', null, 'A']) === 'A', 'Leere Teile werden übersprungen');
}

console.log('══ Papierkorb: Azubi ══');
{
  const vorher = { ke: App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=1'), kw: App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1'),
    wv: App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=1'), not: App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=700'),
    bem: App.scalar('SELECT COUNT(*) FROM schueler_bemerkungen WHERE schueler_id=1') };
  App.deleteSchuelerKaskade(1);
  check(!App.scalar('SELECT COUNT(*) FROM schueler WHERE id=1') && !App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1') && !App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=700'), 'Kaskade löscht Azubi samt KW-Status, WV und Notizen');
  const pk = App.papierkorbListe();
  check(pk.length === 1 && pk[0].art === 'schueler' && pk[0].ref_id === 1 && pk[0].label.startsWith('Muster, Anna'), `Papierkorb-Eintrag angelegt (${pk[0] && pk[0].label})`);
  check(pk[0].geloescht_von === 'Muster, Max', 'Löschender Nutzer wird festgehalten');
  const log = App.query("SELECT * FROM aenderungslog WHERE schueler_id=1 AND aktion='geloescht'");
  check(log.length === 1 && /Muster, Anna/.test(log[0].alter_wert) && /IB-1/.test(log[0].alter_wert), 'Löschung steht im Änderungs-Logbuch (mit IBYKUS-ID)');
  check(App.scalar("SELECT COUNT(*) FROM bhk_tombstones WHERE tabelle='schueler' AND key='1'") === 1, 'Tombstone für den Azubi gesetzt');
  const r = App.papierkorbWiederherstellen(pk[0].id);
  check(r.ok && r.zeilen > 0, `Wiederherstellung meldet Erfolg (${r.zeilen} Zeilen)`);
  const nachher = { ke: App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=1'), kw: App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1'),
    wv: App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=1'), not: App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=700'),
    bem: App.scalar('SELECT COUNT(*) FROM schueler_bemerkungen WHERE schueler_id=1') };
  check(JSON.stringify(vorher) === JSON.stringify(nachher), `Alle abhängigen Zeilen wieder da (${JSON.stringify(nachher)})`);
  const s1 = App.query('SELECT * FROM schueler WHERE id=1')[0];
  check(s1 && s1.nachname === 'Muster' && s1.betrieb_id === 10 && s1.klasse_id === 1, 'Azubi mit ursprünglicher ID, Betrieb und Klasse zurück');
  check(App.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=100 AND schueler_id=1') === 500, 'Kontrollergebnis behält seine ID (Verknüpfungen intakt)');
  check(App.scalar("SELECT COUNT(*) FROM bhk_tombstones WHERE tabelle='schueler' AND key='1'") === 0, 'Tombstone durch Re-Anlage aufgehoben (kein Wieder-Löschen beim Abgleich)');
  check(App.papierkorbListe().length === 0, 'Papierkorb-Eintrag nach Wiederherstellung entfernt');
  check(App.query("SELECT * FROM aenderungslog WHERE schueler_id=1 AND aktion='wiederhergestellt'").length === 1, 'Wiederherstellung im Logbuch');
  // Doppelte Wiederherstellung: Azubi existiert bereits wieder
  App.deleteSchuelerKaskade(2);
  const pk2 = App.papierkorbListe()[0];
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (2,'Fremd','Ben',1)`);
  const r2 = App.papierkorbWiederherstellen(pk2.id);
  check(!r2.ok && r2.vorhanden, 'Wiederherstellung verweigert, wenn der Azubi inzwischen wieder existiert');
  App.papierkorbEintragLoeschen(pk2.id);
  App.deleteSchuelerKaskade(2, { ohnePapierkorb: true });
  check(App.papierkorbListe().length === 0, 'Option ohnePapierkorb legt keinen Eintrag an');
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id,zustaendiges_amt) VALUES (2,'Fremd','Ben',1,1,1,10,'94')`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,fehltage_gesamt) VALUES (501,100,2,'in_ordnung',0)`);
}

console.log('══ Papierkorb: Kontrolltermin ══');
{
  db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (100,2)`);
  App.deleteTerminKaskade(100);
  check(!App.scalar('SELECT COUNT(*) FROM kontrolltermine WHERE id=100') && !App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=100') && !App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE id=700'), 'Termin-Kaskade entfernt Termin, Ergebnisse und WV');
  const pk = App.papierkorbListe();
  check(pk.length === 1 && pk[0].art === 'termin' && /2026-11-17/.test(pk[0].label) && /BS Freiburg/.test(pk[0].label), `Termin-Eintrag im Papierkorb (${pk[0] && pk[0].label})`);
  const r = App.papierkorbWiederherstellen(pk[0].id);
  check(r.ok, 'Termin wiederhergestellt');
  check(App.scalar('SELECT berufsschule_id FROM kontrolltermine WHERE id=100') === 1, 'Termin mit Schule zurück');
  check(App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=100') === 2, 'Beide Kontrollergebnisse zurück');
  check(App.scalar('SELECT COUNT(*) FROM kontrolltermin_klassen WHERE kontrolltermin_id=100') === 1 && App.scalar('SELECT COUNT(*) FROM kontrolltermin_schueler WHERE kontrolltermin_id=100') === 1, 'Klassen- und Einzel-Zuordnung zurück');
  check(App.scalar("SELECT status FROM wiedervorlagen WHERE id=700") === 'offen' && App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=700') === 1, 'Wiedervorlage samt Notiz zurück');
  check(App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1') === 3, 'KW-Status des Azubis war vom Termin-Löschen nie betroffen');
}

console.log('══ Papierkorb: Größenschutz & Aufräumen ══');
{
  const alt = App.PAPIERKORB_MAX_BYTES;
  App.PAPIERKORB_MAX_BYTES = 50;
  App.deleteTerminKaskade(100);
  check(App.papierkorbListe().length === 0, 'Zu großes Paket wird nicht abgelegt (Löschen funktioniert trotzdem)');
  App.PAPIERKORB_MAX_BYTES = alt;
  db.run("INSERT INTO bhk_papierkorb (art,ref_id,label,daten,geloescht_am) VALUES ('schueler',999,'alt','{}',datetime('now','localtime','-100 days'))");
  App.migrateDB();
  check(App.papierkorbListe().length === 0, 'Einträge älter als 90 Tage werden beim Start bereinigt');
  check(App.ID_TABLES.has('bhk_papierkorb'), 'bhk_papierkorb vergibt globale IDs (Mehrbenutzer)');
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
