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
  // Fehltage-Warnung: in der Standardliste UND in bestehenden Datenbanken nachgetragen
  check(/Achtung Fehltage/.test(App.TB_FEHLTAGE) && /10 %/.test(App.TB_FEHLTAGE), `Textbaustein zur Fehltage-Warnung: „${App.TB_FEHLTAGE}"`);
  const src = read('src/js/app-core.js');
  check(/'Ausbildungsnachweis nicht chronologisch geordnet',\n\s+this\.TB_FEHLTAGE/.test(src), 'Steht in der Standardliste für neue Datenbanken');
  check(/tb_fehltage_ergaenzt/.test(src) && /tb\.push\(this\.TB_FEHLTAGE\)/.test(src), 'Wird in bestehenden Datenbanken einmalig nachgetragen');
  // Nachtrag am echten Migrationspfad prüfen
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung','[\"Alter Baustein\"]')");
  App.run("DELETE FROM einstellungen WHERE schluessel='tb_fehltage_ergaenzt'");
  App.migrateDB();
  const tb = App.getTextbausteine();
  check(tb.includes('Alter Baustein') && tb.includes(App.TB_FEHLTAGE), 'Bestehende Liste bleibt erhalten, die Warnung kommt hinzu');
  const vorher = tb.length;
  App.migrateDB();
  check(App.getTextbausteine().length === vorher, 'Ein zweiter Start trägt ihn nicht erneut ein');
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung','[\"Nur einer\"]')");
  App.migrateDB();
  check(App.getTextbausteine().length === 1, 'Eine bewusste Löschung kommt nicht zurück (Merker gesetzt)');

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

console.log('\n══ Audit 7 Paket E: Nachbereitung und Bedienung ══');
{
  const K_SRC = read('src/js/modules/kontrolle.js');
  const V_SRC = read('src/js/modules/views.js');
  const W_SRC = read('src/js/modules/workflows.js');
  // E1: Vorlage je Betrieb – Abwesende sind keine „ohne Beanstandung"
  const gOk = { azubis: [{ ke: { ergebnis: 'in_ordnung' } }] };
  const gAbw = { azubis: [{ ke: { ergebnis: '', anwesend: 0 } }] };
  const gMix = { azubis: [{ ke: { ergebnis: 'in_ordnung' } }, { ke: { ergebnis: 'post_an_rp' } }] };
  check(Workflows._betriebVorlageTyp(gOk, true) === 'betrieb_ok' && Workflows._betriebVorlageTyp(gMix, true) === 'betrieb_maengel', 'Betrieb: ohne Beanstandung bzw. Mängelmitteilung nach der Kontrolle');
  check(Workflows._betriebVorlageTyp(gAbw, true) === 'nachholung', 'Betrieb mit nur abwesenden Azubis bekommt die Nachhol-Aufforderung');
  check(Workflows._betriebVorlageTyp(gOk, false) === 'betrieb_ankuendigung', 'Vor der Kontrolle: Ankündigung');
  check(/nicht anwesend/.test(Workflows._azubiBlock([{ nachname: 'A', vorname: 'B', ke: { ergebnis: '', anwesend: 0 } }], true)), 'Azubi-Block nennt Abwesende ausdrücklich');
  check(/const typ = isDone \? this\._betriebVorlageTyp\(g, true\) : 'brief_betrieb';/.test(W_SRC), 'PDF-Briefe nach der Kontrolle nutzen die Ergebnis-Vorlagen statt der Terminankündigung');
  // E5: fremde Ämter nicht anschreiben, Nachholungs-WV mit Nachhol-Text, Versandnachweis
  // eigener Bestand (Termin 100 wurde oben im Papierkorb-Test gelöscht)
  db.run(`INSERT INTO betriebe (id,name,betriebsnummer,email) VALUES (11,'Gärtnerei Zwei','B-2','zwei@example.org')`);
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt,ibykus_id) VALUES
    (801,'Eigen','Emma',1,1,1,11,'2024-09-01','2027-08-31','93','IB-801'),
    (802,'Fremd','Fritz',1,1,1,11,'2024-09-01','2027-08-31','94','IB-802')`);
  db.run(`INSERT INTO kontrolltermine (id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (800,1,'2026-10-06','Muster, Max','durchgefuehrt','schulkontrolle')`);
  db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (800,801),(800,802)`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend) VALUES (8001,800,801,'',0),(8002,800,802,'in_ordnung',1)`);
  App.invalidateTerminCache();
  const bt = Workflows._betriebeDesTermins(800, true);
  check(bt.fremde.length === 1 && bt.fremde[0].id === 802 && !bt.schueler.some(s => s.id === 802), `Azubi eines fremden Amts ist von Betriebs-Anschreiben ausgenommen (fremde: ${bt.fremde.length})`);
  check(bt.betriebe.length === 1 && Workflows._betriebVorlageTyp(bt.betriebe[0], true) === 'nachholung', 'Betrieb des abwesenden eigenen Azubis bekommt die Nachhol-Aufforderung');
  check(/if \(App\.istFremdesAmt\(s\)\) return;/.test(K_SRC), 'Abschluss-Assistent legt für fremde Ämter keine Nachhol-Wiedervorlage an');
  check(Workflows._wvVorlageTyp({ art: 'nachholung_naechste_durchsicht' }, false) === 'nachholung' && Workflows._wvVorlageTyp({ art: 'post_an_rp' }, false) === 'wv_mahnung' && Workflows._wvVorlageTyp({ art: 'nachholung' }, true) === 'wv_erinnerung', 'WV-Mail: Nachholung → Nachhol-Aufforderung, Mangel → Mängelmitteilung, überfällig → Erinnerung');
  const cols = App.query('PRAGMA table_info(wiedervorlagen)').map(c => c.name);
  check(cols.includes('versand_datum') && cols.includes('versand_art') && cols.includes('mahnstufe'), 'Wiedervorlagen tragen Versandnachweis und Mahnstufe');
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (850,8001,801,'nachholung_naechste_durchsicht','2026-10-27','offen')`);
  const notizenVorher = App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=850');
  Workflows.versandVermerken(850, 'email', 'nachholung');
  let w = App.query('SELECT * FROM wiedervorlagen WHERE id=850')[0];
  check(w.versand_datum === '2026-09-15' && w.versand_art === 'email' && w.mahnstufe === 1, `Erstes Anschreiben: Versanddatum + Mahnstufe 1 (${w.versand_datum}/${w.mahnstufe})`);
  Workflows.versandVermerken(850, 'email', 'wv_erinnerung', 'neue Frist 01.10.2026');
  w = App.query('SELECT * FROM wiedervorlagen WHERE id=850')[0];
  check(w.mahnstufe === 2, 'Erinnerung erhöht die Mahnstufe');
  check(App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=850') === notizenVorher + 2, 'Jeder Versand hinterlässt eine Notiz');
  check(/versandVermerken\(p\.wvId, 'email', p\.typ/.test(W_SRC), 'Öffnen der WV-Mail vermerkt den Versand');
  const diskDb = new SQL.Database();
  diskDb.run(`CREATE TABLE wiedervorlagen (id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER, frist_datum TEXT)`);
  for (const t of ['schueler','kontrolltermine','kontrollergebnisse','berufsschulen','klassen','abschlussjahrgaenge','fachrichtungen']) diskDb.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  App._migrateDiskDb(diskDb);
  const dCols = []; const st = diskDb.prepare('PRAGMA table_info(wiedervorlagen)'); while (st.step()) dCols.push(st.getAsObject().name); st.free();
  check(dCols.includes('versand_datum') && dCols.includes('mahnstufe'), 'Versand-Spalten auch auf der Disk-Datenbank');
  diskDb.close();
  // E2/E3/E4/E6: Quelltext-Prüfungen
  check((APP_SRC.match(/_modalBackPending/g) || []).length >= 5, 'Dialogwechsel: ausstehender Zurück-Schritt wird gemerkt und vom popstate konsumiert');
  check(APP_SRC.indexOf('// ── Restore current user ──') < APP_SRC.indexOf('// ── Restore last position after reload ──'), 'Benutzer wird VOR der letzten Ansicht wiederhergestellt');
  check(/async disconnectDB\(\) \{[\s\S]*?await this\.doAutoSave\(\);/.test(APP_SRC) && /App\.disconnectDB\(\)\.then\(\(\)=>App\.start\(\)\)/.test(APP_SRC), '„Verbindung trennen" wartet auf den Auto-Save');
  check(/_wartetAufPruefer = true;/.test(K_SRC) && /KontrolleHandler\._wartetAufPruefer\) KontrolleHandler\.loadTermin/.test(APP_SRC), 'Kontrolle verlangt einen gewählten Prüfer und lädt nach der Wahl nach');
  check((APP_SRC.match(/INSERT OR IGNORE INTO pruefer/g) || []).length === 1, 'Klarnamen-Prüfer nur noch im SEED_DATA neuer Datenbanken');
  check(!/8-Sekunden/.test(V_SRC) && !/Sperrsystem \(Locking\)/.test(V_SRC) && !/v2\.0/.test(V_SRC) && /App\.VERSION/.test(V_SRC), 'Hilfe: 3-s-Protokollabgleich, Bearbeitungshinweis statt Sperrsystem, Version aus App.VERSION');
}

console.log('\n══ Stufe 2 (3): Wiedervorlage-Nachweis, Akte-Dateien beim endgültigen Löschen ══');
{
  vm.runInContext(read('src/js/modules/wiedervorlagen.js') + '\n;globalThis.WiedervorlagenHandler = WiedervorlagenHandler;', sandbox, { filename: 'wiedervorlagen.js' });
  const WV = sandbox.WiedervorlagenHandler;
  App.closeModal = () => {}; App.openModal = () => {};
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (801,2,40,'A,C',0,1),(801,2,41,'D',0,1)`);
  App.run("UPDATE kontrollergebnisse SET ergebnis='post_an_rp', anwesend=1 WHERE id=8001");
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (851,8001,801,'post_an_rp','2026-10-20','offen')`);
  App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum='2026-09-15', erledigt_bemerkung='Test' WHERE id=850");
  check(App.getSchuelerAmpel(801).color === 'red', 'Vorher: Eskalation / WV offen (rot)');
  const r = await WV.doErledigen(851, { datum: '2026-10-05', bem: 'Heft per Post eingegangen', nachweis: 'post', behoben: true });
  const w = App.query('SELECT * FROM wiedervorlagen WHERE id=851')[0];
  check(w.status === 'erledigt' && w.erledigt_datum === '2026-10-05' && /^Nachweis \(Post\): Heft per Post/.test(w.erledigt_bemerkung), `Nachweis-Art und Bemerkung an der WV (${w.erledigt_bemerkung})`);
  check(r.behoben === 2 && App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=801 AND maengel_codes != ''") === 0 && App.scalar("SELECT behobene_codes FROM kw_status WHERE schueler_id=801 AND kalenderwoche=40") === 'A,C', 'Offene Mängel als behoben protokolliert (Historie bleibt)');
  const amp = App.getSchuelerAmpel(801);
  check(amp.color === 'green' && amp.nachgewiesen === true, `Ampel erkennt „nachgewiesen" (${amp.label})`);
  check(!/speichereDateien|mWvDatei/.test(read('src/js/modules/wiedervorlagen.js')) && !/schueler_dateien/.test(read('src/js/modules/schueler-akte.js')), 'Wiedervorlage ohne Datei-Anhang, Akte ohne Datei-Upload');
  check((APP_SRC.match(/_loescheAkteDateien\(/g) || []).length >= 5, 'Endgültiges Löschen (Papierkorb-Eintrag, Leeren, 90-Tage-Bereinigung, Kaskade ohne Papierkorb) entfernt die Akten-Dateien');
}

console.log('\n══ Stufe 3 (2): Ampeln, Sammel-Erinnerung, Hersendung, Kontexthilfe, Rollen ══');
{
  sandbox.wvArtLabel = (a) => ({ post_an_rp: 'Vorlage per Post im RP', nachholung_naechste_durchsicht: 'Nachholung' })[a] || a;
  const kz = App.betriebKennzahlen(11);
  check(kz.azubis === 2 && kz.mangelAzubis === 1 && kz.wvOffen === 0 && ['gelb', 'gruen', 'rot'].includes(kz.ampel), `Betriebs-Kennzahlen (${kz.mangelAzubis} Mangel-Azubi, Ampel ${kz.ampel}, Ø ${kz.nachweisTage} Tage)`);
  check(kz.ampel === 'gelb' && !kz.wiederholer, 'Ein Azubi mit Mängeln, keine offene WV → gelb, kein Wiederholungsbetrieb');
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status,typ,berufsschule_id) VALUES (801,'2026-06-01','durchgefuehrt','schulkontrolle',1)`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend) VALUES (8011,801,802,'nachholung_naechste_durchsicht',1)`);
  const kz2 = App.betriebKennzahlen(11);
  check(kz2.wiederholer && kz2.ampel === 'rot' && App.wiederholungsbetriebe().some(b => b.id === 11), 'Zwei Azubis mit Mängeln in 24 Monaten → Wiederholungsbetrieb (rot)');
  const sk = App.schuleKennzahlen(1);
  check(typeof sk.abdeckung === 'number' && typeof sk.mangelQuote === 'number' && ['rot', 'gelb', 'gruen', 'grau'].includes(sk.ampel), `Schul-Kennzahlen: Abdeckung ${sk.abdeckung} %, Mängelquote ${sk.mangelQuote} %, Ampel ${sk.ampel}`);
  // Sammel-Erinnerung
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (852,8001,801,'post_an_rp','2026-09-01','offen'),(853,8011,802,'nachholung_naechste_durchsicht','2026-10-30','offen')`);
  const gr = Workflows._sammelGruppen(false);
  const g11 = gr.find(g => g.betriebId === 11);
  check(g11 && g11.wvs.length === 1 && g11.wvs[0].id === 852, 'Sammel-Erinnerung gruppiert offene WV je Betrieb, fremde Ämter (Azubi 802) bleiben außen vor');
  check(Workflows._sammelGruppen(true).find(g => g.betriebId === 11)?.wvs.length === 1 && g11.wvs[0].ueberfaellig, 'Filter „nur überfällige" (Frist 01.09. < 15.09.)');
  check(/Frist 01\.09\.2026 \(überschritten\)/.test(Workflows._sammelBlock(g11)), `Azubi-Block nennt Art, Frist und Überschreitung (${Workflows._sammelBlock(g11)})`);
  check(!!App.VORLAGEN.wv_sammel && /\{azubi_block\}/.test(App.VORLAGEN.wv_sammel.body), 'Vorlage „Sammel-Erinnerung" vorhanden');
  // Hersendung, Kontexthilfe, Rollen (Quelltext)
  check(/istEinsendung \? 'Heft da' : 'Anw\.'/.test(read('src/js/modules/kontrolle.js')) && /Erinnerung: \$\{fehlendeHefte\.length\} Heft\(e\) fehlen/.test(read('src/js/modules/kontrolle.js')), 'Hersendung: Eingangsliste „Heft da" und Erinnerung an Betriebe fehlender Hefte');
  check(App.HILFE_MAP.kontrolle === 'help_5' && App.HILFE_MAP.wiedervorlagen === 'help_6' && App.HILFE_MAP.wartung === 'help_10' && /App\.kontextHilfe\(\)/.test(read('src/js/modules/keyboard-shortcuts.js')) && /_hilfeLinkEinblenden/.test(APP_SRC), 'F1 und ?-Link führen zur Hilfe der aktuellen Ansicht');
  check(/id="help_neu"/.test(read('src/js/modules/views.js')), '„Was ist neu" in der Hilfe');
  check(App.ROLLEN.assistenz.features.kontrolle === false && App.ROLLEN.berater.features.kontrolle === true && App.SIDEBAR_FEATURES.kontrolle && /data-feature="kontrolle"/.test(read('index.html')), 'Rollenprofile über die Sidebar-Schalter (Assistenz ohne Durchführung)');
  check(/Anschreiben: \$\{w\.mahnstufe \|\| 1\}×/.test(read('src/js/modules/schueler-akte.js')), 'Aktenvermerk zeigt die Versandhistorie der Wiedervorlagen');
}

console.log('\n══ E-Mails an Betriebe: Arbeitsliste, kompakter Mängel-Block, Versandnachweis ══');
{
  const W_SRC = read('src/js/modules/workflows.js');
  // Kompakter Block: je Code eine Zeile mit Wochen (Wortlaut der automatischen Bemerkung), Pflichtteile, keine Fehltage-Zeile
  const a = { nachname: 'Kopp', vorname: 'Lukas', ke: { id: 1, ergebnis: 'berichte_bis_termin_email', anwesend: 1, p_1_1_ausbildungsplan: 'nein', f_1_2_vertragliche_regelungen: '' },
    maengel: [{ ausbildungsjahr: 2, kalenderwoche: 40, maengel_codes: 'F' }, { ausbildungsjahr: 2, kalenderwoche: 41, maengel_codes: 'B,F,H' }, { ausbildungsjahr: 2, kalenderwoche: 44, maengel_codes: 'D' }, { ausbildungsjahr: 1, kalenderwoche: 50, maengel_codes: 'I' }] };
  const block = Workflows._azubiBlock([a], true);
  check(/^  - Kopp, Lukas: Berichte per E-Mail nachreichen/.test(block), 'Azubi-Zeile mit Ergebnis');
  check(/→ Fehlende Tagesberichte nachholen \(2 Wochen: AJ 2: KW 40, 41\)/.test(block) && /→ Unterschriften des Ausbilders \/ der Ausbilderin nachholen \(1 Woche: AJ 2: KW 41\)/.test(block), 'Je Code eine Zeile mit den Wochen statt je Woche eine Zeile');
  check(block.indexOf('Ausbilders') < block.indexOf('Fehlende Tagesberichte'), 'Reihenfolge wie in der Bemerkung (B vor F)');
  check(/→ Wetterangaben nachtragen \(1 Woche: AJ 2: KW 44\) – Hinweis, ohne Zusatzvereinbarung nicht verbindlich/.test(block), 'Wetter ohne Zusatzvereinbarung als Hinweis gekennzeichnet');
  check(/→ Sonstige Beanstandungen, siehe Bemerkung \(1 Woche: AJ 1: KW 50\)/.test(block) && !/Fehltage/.test(block), 'Sonstiges mit Wochen, Fehltage ohne Zeile');
  check(/→ Individueller Ausbildungsplan \(1\.1\) fehlt\./.test(block), 'Fehlender Pflichtteil steht im Block');
  check(!/AJ 2, KW 40:/.test(block), 'Alte Wochen-Zeilen sind weg');
  check(/mit Zusatzvereinbarung/.test(Workflows._azubiBlock([{ ...a, ke: { ...a.ke, f_1_2_vertragliche_regelungen: 'ja' } }], true)) === false && /Wetterangaben nachtragen \(1 Woche: AJ 2: KW 44\)\n/.test(Workflows._azubiBlock([{ ...a, ke: { ...a.ke, f_1_2_vertragliche_regelungen: 'ja' } }], true) + '\n'), 'Mit Zusatzvereinbarung ist Wetter ein Mangel ohne Hinweis-Zusatz');
  // mailto-Grenze
  check(Workflows.mailtoPasst('a@b.de', 'Test', 'kurz') === true && Workflows.mailtoPasst('a@b.de', 'Test', 'ä'.repeat(400)) === false, 'mailtoPasst: kurz ja, 400 Umlaute (kodiert 2400 Zeichen) nein');
  sandbox.location = { href: '' };
  const clip = []; sandbox.navigator.clipboard = { writeText: async (t) => { clip.push(t); } };
  const toasts = []; App.toast = (m, t) => toasts.push(m);
  let r = Workflows.openMailto('a@b.de', 'Betreff', 'kurz');
  check(r.geoeffnet === true && r.zwischenablage === false && /^mailto:a@b\.de\?subject=Betreff&body=kurz$/.test(sandbox.location.href), 'Kurzer Text: kompletter Link');
  r = Workflows.openMailto('a@b.de', 'Betreff', 'ä'.repeat(400), '', '', { still: true });
  check(r.geoeffnet === true && r.zwischenablage === true && sandbox.location.href === 'mailto:a@b.de?subject=Betreff' && clip[clip.length - 1] === 'ä'.repeat(400) && toasts.length === 0, 'Langer Text: Link nur mit Betreff, Text in der Zwischenablage, mit still kein Toast');
  Workflows.openMailto('a@b.de', 'Betreff', 'ä'.repeat(400));
  check(toasts.some(m => /Strg\+V/.test(m)), 'Ohne still: der bekannte Hinweis als Toast');
  // Arbeitsliste an einem durchgeführten Termin: zwei Betriebe, einer ohne E-Mail
  sandbox.addDaysStr = (n) => { const d = new Date('2026-09-15T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  db.run(`INSERT INTO betriebe (id,name,betriebsnummer,email,ansprechpartner) VALUES (21,'Gärtnerei Mail','B-21','mail@example.org','Frau Grün'),(22,'Gärtnerei Brief','B-22','','')`);
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt,ibykus_id) VALUES
    (901,'Eins','Erik',1,1,1,21,'2024-09-01','2027-08-31','93','IB-901'),(902,'Zwei','Zoe',1,1,1,21,'2024-09-01','2027-08-31','93','IB-902'),(903,'Drei','Dora',1,1,1,22,'2024-09-01','2027-08-31','93','IB-903')`);
  db.run(`INSERT INTO kontrolltermine (id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (900,1,'2026-09-16','Muster, Max','durchgefuehrt','schulkontrolle')`);
  db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (900,901),(900,902),(900,903)`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend) VALUES (9001,900,901,'post_an_rp',1),(9002,900,902,'in_ordnung',1),(9003,900,903,'',0)`);
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (901,2,40,'A,F',0,1)`);
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (950,9001,901,'post_an_rp','2026-09-26','offen')`);
  App.invalidateTerminCache();
  let modal = null; App.openModal = (t, b, f) => { modal = { t, b, f }; }; App.closeModal = () => {};
  Workflows.emailBetriebIndividuell(900);
  check(modal && /E-Mails an 2 Betriebe/.test(modal.t) && /id="betriebMailListe"/.test(modal.b) && /id="betriebMailFuss"/.test(modal.f), 'Ein Dialog mit Liste und Fußzeile');
  check(/✉︎ Nächste öffnen \(1 von 1\)/.test(modal.f), 'Fußzeile: „Nächste öffnen (1 von 1)“ – der Betrieb ohne E-Mail zählt nicht');
  check(/Gärtnerei Mail/.test(modal.b) && /Mängelmitteilung/.test(modal.b) && /→ Unterschriften des\/der Auszubildenden nachholen \(1 Woche: AJ 2: KW 40\)/.test(modal.b) && /Keine E-Mail hinterlegt/.test(modal.b) && /▤ Brief/.test(modal.b), 'Zeilen: Vorlage, Nachzuholendes je Azubi, Brief-Knopf ohne E-Mail');
  check(!/E-Mail \$\{i\} von \$\{mit\.length\}/.test(W_SRC) && !/btnNaechsteMail/.test(W_SRC) && /_naechsteBetriebMail\(\) \{/.test(W_SRC), 'Keine Kette von Zwischendialogen mehr');
  const d = Workflows._individualData;
  check(Workflows._betriebMailOffen().length === 1 && Workflows._betriebMailOffen()[0].g.name === 'Gärtnerei Mail', 'Offen ist genau der Betrieb mit E-Mail');
  toasts.length = 0;
  Workflows._naechsteBetriebMail();
  check(d.status[0] && /^\d{2}:\d{2}$/.test(d.status[0].zeit) && /^mailto:mail@example\.org\?subject=/.test(sandbox.location.href), 'Nächste öffnen: Outlook-Link gestartet, Zeile als geöffnet gemerkt');
  const w950 = App.query('SELECT * FROM wiedervorlagen WHERE id=950')[0];
  check(w950.versand_datum === '2026-09-15' && w950.versand_art === 'email' && w950.mahnstufe === 1, `Versandnachweis an der Wiedervorlage des Azubis (${w950.versand_datum}, Stufe ${w950.mahnstufe})`);
  const notizen = () => App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=950');
  check(notizen() === 1 && /Mängelmitteilung per E-Mail versendet/.test(App.scalar('SELECT notiz FROM wiedervorlage_notizen WHERE wiedervorlage_id=950')), 'Notiz „Mängelmitteilung per E-Mail versendet“');
  check(App.scalar('SELECT nachbereitet_am FROM kontrolltermine WHERE id=900') === App._heuteIso(), 'Alle Betriebe mit E-Mail geöffnet → Termin nachbereitet');
  check(Workflows._betriebMailOffen().length === 0 && /Alle 1 E-Mails geöffnet/.test(Workflows._betriebMailFussHtml()), 'Fußzeile: alle geöffnet');
  check(/✓ geöffnet/.test(Workflows._betriebMailZeile(d.betriebe[0], 0)) && /Erneut öffnen/.test(Workflows._betriebMailZeile(d.betriebe[0], 0)), 'Zeile zeigt „geöffnet“ und „Erneut öffnen“');
  Workflows._openIndividualEmail(900, 0);
  check(notizen() === 1 && App.scalar('SELECT mahnstufe FROM wiedervorlagen WHERE id=950') === 1, 'Erneutes Öffnen ist kein zweites Anschreiben (keine zweite Notiz, Mahnstufe bleibt)');
  check(!toasts.some(m => /geöffnet$/.test(m)), 'Kein „E-Mail an … geöffnet“-Toast mehr – der Stand steht in der Zeile');
  // Zu langer Text: Zeile kündigt es an, Öffnen legt den Text in die Zwischenablage
  d.betriebe[0].azubis[0].maengel = Array.from({ length: 20 }, (_, i) => ({ ausbildungsjahr: 1 + (i % 3), kalenderwoche: 36 + i, maengel_codes: 'A,B,C,E,F,G' }));
  check(Workflows._betriebMailPasst(0) === false && /Text zu lang für den Link/.test(Workflows._betriebMailZeile(d.betriebe[0], 0).replace(/✓ geöffnet[^<]*/, '')) === false, 'Geöffnete Zeile zeigt den Vorab-Hinweis nicht mehr (Status hat Vorrang)');
  delete d.status[0];
  check(/Text zu lang für den Link → wird beim Öffnen kopiert/.test(Workflows._betriebMailZeile(d.betriebe[0], 0)), 'Nicht geöffnete Zeile kündigt „Text zu lang“ vorab an');
  clip.length = 0;
  Workflows._openIndividualEmail(900, 0);
  check(d.status[0].zwischenablage === true && clip.length === 1 && /Fehlende Tagesberichte nachholen/.test(clip[0]) && sandbox.location.href === 'mailto:mail@example.org?subject=' + encodeURIComponent('Berichtsheftkontrolle – Ergebnis für Eins, Erik / Zwei, Zoe'), 'Zu lang: Link nur mit Betreff, Text in der Zwischenablage, Zeile merkt es');
  check(/Text liegt in der Zwischenablage – in Outlook mit Strg\+V einfügen/.test(Workflows._betriebMailZeile(d.betriebe[0], 0)), 'Zeile sagt nach dem Öffnen: Strg+V in Outlook');
  Workflows._betriebMailKopieren(0);
  await new Promise(r => setTimeout(r, 0));
  check(/^An: mail@example\.org\nBetreff: /.test(clip[clip.length - 1]), '„▤ Text“ kopiert Empfänger, Betreff und Text');
  check(/E-Mails an die Betriebe nach der Kontrolle/.test(read('src/js/modules/views.js')), 'Hilfe beschreibt die Arbeitsliste');
  App.toast = () => {};
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
