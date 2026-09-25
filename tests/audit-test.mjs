// ═══════════════════════════════════════════════════════════════════
//  Code-Audit (Regressionen): KW 53 in Stichtag und Rastergrenzen,
//  Parameterindex mit Wortgrenze, Kaskaden (Termin-Notizen, Schule/Betrieb
//  an Terminen), Klassen-Kollisionen, Phasen-Teilung, Mahnstufe absolut,
//  Sperre (Herzschlag fremd, kein Fail-open), Snapshot-Tausch mit laufendem
//  Anhängen, Kompaktierung nie im Import, hängendes Anhängen mit Frist,
//  Migrationsparität kw_status, Ortszeit-Datum, Oberflächen-Schutz (Quellen)
//  Ausführen:  node tests/audit-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { getSQL, makeStore, makeSeed, makeClient, makeChecker, APP_SRC } from './_sync-harness.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL, `
  INSERT INTO berufsschulen (id,name,ort) VALUES (1,'BS Eins','Ort'),(2,'BS Zwei','Ort');
  INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (5,'S2028','Sommer',2028);
  INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'036','GaLaBau','Gärtner');
  INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES (10,1,5,1,'GL1'),(11,2,5,1,'GL2');
  INSERT INTO betriebe (id,name) VALUES (7,'Gärtnerei Sieben');
  UPDATE schueler SET ausbildungsbeginn='2026-12-28', ausbildungsende='2029-12-31', klasse_id=10, betrieb_id=7 WHERE id=1;
  UPDATE kontrolltermine SET berufsschule_id=1, betrieb_id=7 WHERE id=77;
  INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (501,77,1,'nachholung_naechste_durchsicht');
  INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (601,501,1,'nachholung_naechste_durchsicht','2027-01-15','offen');
  INSERT INTO wiedervorlage_notizen (id,wiedervorlage_id,notiz,erstellt_von) VALUES (701,601,'Notiz','x');
`);
const store = makeStore();
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
const A = await makeClient(SQL, store, 'anna', new Uint8Array(seedBytes), { quiet: true });
const B = await makeClient(SQL, store, 'bernd', new Uint8Array(seedBytes), { quiet: true });

console.log('══ Datumsmathematik: KW 53 ══');
{
  // Stichtag in der KW 53 (28.12.2026–03.01.2027): geprüft bis KW 50 gehört ins laufende Jahr
  const r = A.ajKwFuerStichtag(1, new Date(2026, 11, 30), 50);
  check(A._isoKW(new Date(2026, 11, 30)) === 53 && r && r.kw === 50 && r.aj === A.getAJAtDate('2026-12-28', new Date(2026, 11, 30), 1), `Stichtag in KW 53: KW 50 bleibt im laufenden Ausbildungsjahr (AJ ${r && r.aj})`);
  const b = A.getAJKWBounds(1);
  const erstes = b[Object.keys(b)[0]];
  check(erstes.startKW === 52 && erstes.inactiveKWs.length > 0, `Ausbildungsbeginn in KW 53: Beginn auf 52 abgebildet, Wochen davor inaktiv (${erstes.inactiveKWs.length})`);
  check(/_heuteIso\(\) \{/.test(APP_SRC) && !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(APP_SRC), 'Heutiges Datum im Kern in Ortszeit (kein UTC-Vortag nach Mitternacht)');
  const h = A._heuteIso(); const d = new Date();
  check(h === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, '_heuteIso liefert das lokale Datum');
}

console.log('\n══ Parameterindex mit Wortgrenze ══');
{
  check(A._paramIndexForColumn('UPDATE schueler SET klasse_id=? WHERE id=?', 'id') === 1, '„id=?“ trifft nicht „klasse_id=?“');
  check(A._azubiAusOp('UPDATE schueler SET klasse_id=? WHERE id=?', [10, 3]) === 3, 'Betroffener Azubi ist die Zeile (3), nicht die Klasse (10)');
  check(A._paramIndexForColumn('UPDATE kw_status SET fehltage=? WHERE schueler_id=? AND kalenderwoche=?', 'schueler_id') === 1, 'schueler_id weiterhin gefunden');
}

console.log('\n══ Kaskaden ══');
{
  A.deleteTerminKaskade(77, { ohnePapierkorb: true });
  check(A.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE id=701') === 0 && A.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE id=601') === 0, 'Termin löschen nimmt Wiedervorlagen samt Notizen mit');
  A.db.run("INSERT INTO kontrolltermine (id,geplant_datum,status,berufsschule_id,betrieb_id) VALUES (78,'2027-01-01','geplant',2,7)");
  A.deleteSchuleKaskade(2);
  check(A.scalar('SELECT berufsschule_id FROM kontrolltermine WHERE id=78') === null, 'Schule löschen löst den Ort an Terminen');
  A.deleteBetriebKaskade(7);
  check(A.scalar('SELECT betrieb_id FROM kontrolltermine WHERE id=78') === null && A.scalar('SELECT betrieb_id FROM schueler WHERE id=1') === null, 'Betrieb löschen löst Betrieb an Terminen und Azubis');
}

console.log('\n══ Mahnstufe absolut, Migrationsparität, Snapshot-Stempel ══');
{
  const W = read('src/js/modules/workflows.js');
  check(!/COALESCE\(mahnstufe,0\)\+1/.test(W) && /const stufeNeu = erinnerung \? stufeAlt \+ 1/.test(W), 'Mahnstufe wird absolut geschrieben (doppelt eingespielte Op erhöht nicht zweimal)');
  const mig = APP_SRC.slice(APP_SRC.indexOf('  migrateDB() {'));
  const create = mig.slice(mig.indexOf('CREATE TABLE IF NOT EXISTS kw_status ('), mig.indexOf('CREATE TABLE IF NOT EXISTS kw_status (') + 900);
  check(/bemerkung TEXT DEFAULT ''/.test(create) && /kalenderwoche INTEGER CHECK/.test(create), 'migrateDB legt kw_status mit bemerkung und CHECKs an (wie _migrateDiskDb)');
  check(/ALTER TABLE durchsicht_snapshots ADD COLUMN kontrollergebnis_id INTEGER/.test(mig), 'migrateDB spiegelt die Snapshot-Spalten der Disk-Migration');
  A._rowStamps = null; A._maxSeenTs = 0;
  A.db.run('CREATE TABLE IF NOT EXISTS bhk_stamps (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  A.db.run("INSERT INTO bhk_stamps (k,v) VALUES ('schueler|id:1','telefon=9999999999999,x,1')");
  A._stampsLaden();
  check(A._maxSeenTs === 9999999999999 && A._stampTs() > 9999999999999, 'Lamport-Uhr übernimmt die Stempel aus dem Snapshot');
  A._maxSeenTs = 0; A._rowStamps = null; A.db.run('DELETE FROM bhk_stamps');
}

console.log('\n══ Sperre: Herzschlag überschreibt keine fremde Sperre, kein Fail-open ══');
{
  A._lockFileName = 'lock_test.json'; A._lockNonce = 'meine';
  store.files.set('lock_test.json', { data: new TextEncoder().encode(JSON.stringify({ u: 'Bernd', t: new Date().toISOString(), n: 'fremd' })), mtime: Date.now() });
  const ok = await A._refreshLock();
  const inhalt = JSON.parse(new TextDecoder().decode(store.files.get('lock_test.json').data));
  check(ok === false && inhalt.n === 'fremd', 'Fremde Sperre bleibt stehen, Herzschlag meldet false');
  store.files.set('lock_test.json', { data: new TextEncoder().encode(JSON.stringify({ u: 'Anna', t: new Date().toISOString(), n: 'meine' })), mtime: Date.now() });
  check((await A._refreshLock()) === true, 'Eigene Sperre wird aufgefrischt');
  store.files.delete('lock_test.json'); A._lockFileName = null; A._lockNonce = null;
  const CK = APP_SRC.slice(APP_SRC.indexOf('  async _compact(reason) {'), APP_SRC.indexOf('  async _lockNochMeins() {'));
  check(/if \(!this\._lockNonce\) return this\._compactAbgelehnt/.test(CK) && /herzschlag = setInterval/.test(CK) && /if \(!\(await this\._lockNochMeins\(\)\)\) throw new Error\('Sperre inzwischen/.test(CK), 'Kompaktierung: keine Sperre → keine Kompaktierung; Herzschlag ab Sperre; Prüfung unmittelbar vor dem Schreiben');
  check(/if \(this\._bulkImport\) return this\._compactAbgelehnt\('Import läuft/.test(CK) && /if \(this\._bulkPending \|\| \/import\|bereinigung\/\.test\(String\(reason\)\)\) this\._bulkOps = null;/.test(CK), 'Kompaktierung nie während eines Imports; Bulk-Ops nur nach Import/Bereinigung verworfen');
  A._bulkImport = true;
  check((await A._compact('start')) === false && /Import läuft/.test(A._compactGrund || ''), 'Start-Kompaktierung während eines Imports abgelehnt');
  A._bulkImport = false;
}

console.log('\n══ Snapshot-Tausch: laufendes Anhängen geht nicht verloren ══');
{
  // B kompaktiert; A hat Ops „in flight“ (Anhängen hängt) – der Tausch muss sie mit nachspielen
  A.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (1,'in-flight','x')");
  const claimed = A._dirtyOps.splice(0); A._opsInFlight = claimed; A._appendHaengt = Promise.resolve(); A._appendHaengtSeit = Date.now();
  B.run("UPDATE schueler SET telefon='von-B' WHERE id=2"); await B.mergeAndSave(true);
  check(await B._compact('stress'), 'B kompaktiert');
  A._appendInProgress = false;
  await A._pollOplogs();
  check(A.scalar("SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz='in-flight'") === 1 && A.scalar('SELECT telefon FROM schueler WHERE id=2') === 'von-B', 'Nach dem Tausch: In-Flight-Op ist da, B’s Stand auch');
  check(/_snapWechsel = true;/.test(APP_SRC) && /if \(this\._snapWechsel\) \{/.test(APP_SRC) && /const offen = \[\.\.\.\(this\._opsInFlight \|\| \[\]\), \.\.\.this\._dirtyOps\];/.test(APP_SRC), '_saveV3 wartet während des Tauschs; In-Flight-Ops werden nachgespielt');
  check(/if \(this\._bulkImport\) return;/.test(APP_SRC.slice(APP_SRC.indexOf('async _pruefeFremdenSnapshot'))), 'Kein Snapshot-Tausch während eines Imports');
  // Hängendes Anhängen: nach der Frist wird aufgegeben und rotiert
  A._appendHaengtSeit = Date.now() - A.APPEND_HAENGT_MAX_MS - 1000; A._dirtyOps = claimed; A._opsInFlight = null; const genVorher = A._logGen;
  await A.mergeAndSave(true);
  check(A._appendHaengt === null && A._logGen === genVorher + 1 && A._dirtyOps.length === 0, `Hängendes Anhängen nach ${A.APPEND_HAENGT_MAX_MS / 60000} min aufgegeben, neue Generation, Ops geschrieben`);
  await B._pollOplogs();
  check(B.scalar("SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz='in-flight'") === 1, 'B erhält die Op über die neue Generation genau einmal');
}

console.log('\n══ Oberfläche (Quellen) ══');
{
  const K = read('src/js/modules/kontrolle.js'), KS = read('src/js/modules/keyboard-shortcuts.js'), KN = read('src/js/modules/kw-nav.js');
  check(/const sidFest = s\.id;/.test(K) && /jetzt\.id !== sidFest/.test(K), 'saveField: Fortsetzung nach Rückfrage nur für denselben Azubi');
  check(/if \(this\.currentLock\) return; \/\/ Kollege bearbeitet/.test(K) && /KontrolleHandler\.currentLock\) return; \/\/ Kollegen-Sperre gilt auch für die Tastatur/.test(KN) && /if \(this\.currentLock\) return;\n      const c = \(fokusVorher/.test(K), 'Kollegen-Sperre gilt für Tastatur, Kürzel und Auto-Fokus');
  check(/if \(this\._lastWrittenPos !== posKey \|\| !this\._posSeit\) this\._posSeit = Date\.now\(\);/.test(K), 'Positions-Zeitpunkt ohne Komma-Operator');
  check(/const imFeld = \['INPUT', 'TEXTAREA', 'SELECT'\]/.test(KS) && /inEinzelansicht && !imFeld/.test(KS) && /if \(!document\.getElementById\('kontrolleContent'\)\) return;/.test(K), 'Ctrl+Pfeile nur in der Einzelansicht außerhalb von Feldern; enterSchüler nur in der Kontrolle');
  check(/fokusVorher && document\.querySelector\(`\.kw-cell\[data-aj="\$\{fokusVorher\.aj\}"\]\[data-kw="\$\{fokusVorher\.kw\}"\]`\)/.test(K), 'Neuzeichnen stellt die fokussierte Zelle wieder her');
  check(/'DELETE FROM wiedervorlagen WHERE kontrollergebnis_id=\?',\n       'DELETE FROM kw_maengel WHERE kontrollergebnis_id=\?'/.test(K), 'Azubi aus der Kontrolle entfernen räumt Wiedervorlagen, Mängel und Snapshots des Ergebnisses');
  check(/if \(!termin\) \{\n      \/\/ Ein Kollege hat den Termin gelöscht/.test(K) && /this\.renderKontrolleView\(\);\n  \},\n\n  \/\/ ── Kontrolle abschließen|Kontrolle wieder geöffnet', 'success'\);\n    this\.renderKontrolleView\(\);/.test(K), 'Gelöschter Termin wird abgefangen; Wieder öffnen nutzt die Ansichtswahl');
  check(/this\.currentTerminId === tidAuto\) this\.nextOffen\(\);/.test(K) && /`⊘ \$\{esc\(o\.pruefer\)\}/.test(K) && /!row\.fehltage && !row\.bemerkung\)/.test(K), 'Auto-Weiter nur im selben Kontext; Live-Leiste maskiert; Entfernen behält KW-Bemerkungen');
  const IH = read('src/js/modules/import-handler.js'), ST = read('src/js/modules/stammdaten.js'), PH = read('src/js/modules/phasen.js'), SA = read('src/js/modules/schueler-akte.js');
  check(/raw: false \}\);\n        const fields/.test(IH) && /String\(row\[telCol\] \?\? ''\)\.trim\(\)/.test(IH), 'Ausbilder-Import: Zahlenzellen als Text');
  check(/this\.closest\('\.ibykus-block'\)\.querySelectorAll\('\.ibykus-feld'\)/.test(IH), '„trotzdem ändern“ wirkt auch auf der Azubi-Seite');
  check(/<option value="\$\{esc\(col\)\}"/.test(IH) && /const z = \(k\) => esc\(r\[gm\(k\)\] \|\| '–'\);/.test(IH) && /esc\(\[\.\.\.stats\.schulen\]\.join/.test(IH), 'Import-Vorschau und Ergebnis maskieren CSV-Werte');
  check(/if \(vorschau\) \{ try \{ App\.db\.run\('ROLLBACK TO bhk_vorschau'\)/.test(IH.slice(IH.indexOf('   } finally {'))) && /if \(App\._dirtyOps && App\._dirtyOps\.length\) App\.scheduleAutoSave\(\)/.test(IH), 'Vorschau-Savepoint auch im Fehlerfall geschlossen, Auto-Save wieder angestoßen');
  check(/if \(!s\) return App\.toast\('Azubi nicht mehr vorhanden/.test(IH) && /treffer\.length === 1\) schuelerId = treffer\[0\]\.id/.test(IH), 'editSchueler ohne Datensatz; LFK-Zuordnung nur bei eindeutigem Treffer');
  check(/_klasseKollidiert\(id, bs, jg, fr\)/.test(ST) && /if \(!k \|\| this\._klasseKollidiert\(id, sid, k\.jahrgang_id, k\.fachrichtung_id\)\) \{ koll\+\+; return; \}/.test(ST) && /data-search="\$\{esc\(/.test(ST), 'Klassen-Kollisionen werden abgefangen; Suchattribut maskiert');
  check(/kannSplitten && bis/.test(PH) && /Phasen\.addPhase\(schuelerId, \{ \.\.\.alt, von: Phasen\.fmtISO\(nachTag\), bis: alt\.bis/.test(PH), 'Unterbrechung innerhalb einer Phase teilt sie statt den Rest zu verschlucken');
  check(/artLbl\[w\.art\] \|\| w\.art/.test(SA) && /w\.erledigt_bemerkung/.test(SA) && !/w\.beschreibung/.test(SA), 'Aktenvermerk liest die richtigen Wiedervorlage-Spalten');
  const V = read('src/js/modules/views.js'), WV = read('src/js/modules/wiedervorlagen.js'), BW = read('src/js/modules/bulk-wv.js'), PE = read('src/js/modules/pdf-export.js'), NE = read('src/js/modules/nacherfassung.js'), BE = read('src/js/modules/berichte.js'), PL = read('src/js/modules/planung.js'), WF = read('src/js/modules/workflows.js');
  check(/App\.run\('DELETE FROM bhk_papierkorb WHERE id=\?', \[pkId\]\)/.test(V) && /if \(App\.scalar\("SELECT COUNT\(\*\) FROM wiedervorlagen WHERE status='offen' AND frist_datum != '' AND frist_datum < \?"/.test(V), 'Papierkorb-Rest ohne Dateilöschung; Überfällig-Update nur bei Treffern (und nie ohne Datum)');
  check(/erledigt_datum=\?, erledigt_bemerkung='Alle Mängel behoben' WHERE id=\?", \[todayStr\(\), wvId\]/.test(WV) && /`Wiedervorlage: \$\{esc\(w\.nachname\)\}/.test(WV), 'Automatische Erledigung mit Datum (kein „Invalid Date“); Dialogtitel maskiert');
  check(/if \(!datum\) return App\.toast/.test(BW) && /if \(!frist\) return App\.toast/.test(BW), 'Bulk-Erledigen/Frist verlangen ein Datum');
  check(/const ortBs = App\.getTerminSchule \? App\.getTerminSchule\(terminId\) : null;/.test(PE), 'Einzel-PDF nimmt den Termin-Ort');
  check(/w\.kontrollergebnis_id IS NOT NULL AND w\.kontrollergebnis_id != \?/.test(NE), 'Nacherfassung schließt keine Wiedervorlagen ohne Ergebnis');
  check(/if \(!klasse\) return App\.toast\('Bitte eine Klasse wählen'/.test(BE) && /'Gesamtpaket – ' \+ esc\(klassenStr\)/.test(BE) && /drawFooter\(doc, doc\.internal\.getNumberOfPages\(\)\)/.test(BE) && /setTimeout\(\(\) => \{ \/\/ Allow spinner to render\n    try \{/.test(BE), 'Berichte: Klassen-Guard, Titel maskiert, Seitenzahl, Fehlerbehandlung im Timer');
  check(/title="\$\{esc\(schuelerNames \+ moreHint\)\}"/.test(PL), 'Standort-Tooltip maskiert');
  check(/Workflows\._individualData\.betriebe\[\$\{idx\}\]\.key/.test(WF) && /Workflows\._nachholung\.betroffen\[\$\{idx\}\]\.key/.test(WF) && /status IN \('offen','ueberfaellig'\) AND w\.frist_datum != '' ORDER BY w\.frist_datum LIMIT 1/.test(WF) && /if \(yz > 270\)/.test(WF), 'Serienbrief: Schlüssel per Index statt Zeichenkette, Frist auch bei überfällig, Seitenumbruch');
  const BS = read('src/js/modules/bulk-schueler.js'), AZ = read('src/js/modules/azubi-seite.js');
  check(/if \(cnt\) cnt\.textContent = ids\.length;/.test(BS) && /zeile\(esc\(a\.funktion\) \|\| 'Ausbilder'/.test(AZ), 'Bulk-Leiste ohne Elemente wirft nicht; Ausbilder-Funktion maskiert');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
