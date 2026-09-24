// ═══════════════════════════════════════════════════════════════════
//  Sparsame Leitung: Änderungszeiger statt Rundgang je Takt, ein Zugriff
//  je Takt, Rundgang nur bei Änderung oder als Sicherheitsnetz, eigener
//  Tipp mit genau einem Rundgang (Rennen), gescheiterter Tipp ohne Verlust,
//  Verbindungsstufen (auto/langsam/getaktet), Sammelpause ohne Verhungern,
//  Positionen im Rundgang, Positionsdatei mit Mindestabstand, Sicherung
//  nicht über getaktete Leitung, Snapshot tippt den Zeiger an
//  Ausführen:  node tests/sparsam-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, APP_SRC, makeStore, FakeDir, FakeFileHandle, getSQL, makeSeed, makeClient, makeChecker } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const K_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
const V_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
const SQL = await getSQL();
const store = makeStore();
const seed = makeSeed(SQL);

// Zugriffszähler: Auflistungen, Handle-Suchen, Datei-Abfragen
const z = { entries: 0, handle: 0, getFile: 0 };
const origEntries = FakeDir.prototype.entries, origHandle = FakeDir.prototype.getFileHandle, origGetFile = FakeFileHandle.prototype.getFile;
FakeDir.prototype.entries = function () { z.entries++; return origEntries.call(this); };
FakeDir.prototype.getFileHandle = function (n, o) { z.handle++; return origHandle.call(this, n, o); };
FakeFileHandle.prototype.getFile = function () { z.getFile++; return origGetFile.call(this); };
const reset = () => { z.entries = 0; z.handle = 0; z.getFile = 0; store.reads = 0; store.writes = 0; };
const summe = () => z.entries + z.handle + z.getFile;

const A = await makeClient(SQL, store, 'Anna', seed, { quiet: true, clientId: 'A', keepAutoSave: true });
const B = await makeClient(SQL, store, 'Bernd', seed, { quiet: true, clientId: 'B' });
const op = (app, sql, params, sid) => { app._dirtyOps.push({ uid: 'u' + Math.random().toString(36).slice(2), ts: Date.now(), seq: (app._seq = (app._seq || 0) + 1), sql, params, sid }); };
const zeiger = () => { const f = store.files.get('zeiger_test.txt'); return f ? new TextDecoder().decode(f.data) : null; };

console.log('══ Änderungszeiger: ein Zugriff je Takt ══');
{
  check(zeiger() === null, 'Vor dem ersten Takt gibt es keinen Zeiger');
  reset();
  const r1 = await A._abgleichTakt();
  check(r1 === true && zeiger() !== null && /A \d+ start/.test(zeiger()), 'Erster Takt: Zeiger angelegt (start) und ein Rundgang');
  check(A._zeigerEigenOffen === false, 'Nach dem Start-Tipp ist kein weiterer eigener Rundgang offen');
  reset();
  const r2 = await A._abgleichTakt();
  check(r2 === false, 'Zweiter Takt ohne Änderung: kein Rundgang');
  check(z.entries === 0 && z.handle === 1 && z.getFile === 1 && store.reads === 1, `Nur der Zeiger wird gelesen (Auflistungen ${z.entries}, Handles ${z.handle}, Abfragen ${z.getFile})`);
  reset();
  for (let i = 0; i < 20; i++) await A._abgleichTakt();
  check(summe() === 40 && z.entries === 0, '20 stille Takte: 40 Zugriffe, keine Auflistung');
}

console.log('\n══ Kollege schreibt: Zeiger ändert sich, Rundgang holt die Änderung ══');
{
  await B._abgleichTakt();   // B kennt den Zeiger jetzt
  op(B, "UPDATE schueler SET nachname=? WHERE id=?", ['Zeiger-Test', 1], 1);
  await B._saveV3();
  check(/B \d+ anhaengen/.test(zeiger()), 'Anhängen tippt den Zeiger an');
  reset();
  const r = await A._abgleichTakt();
  check(r === true && A.query('SELECT nachname FROM schueler WHERE id=1')[0].nachname === 'Zeiger-Test', 'A: Zeiger geändert → Rundgang → Änderung übernommen');
  check(z.entries === 1, 'Genau eine Auflistung im Rundgang');
  reset();
  check((await A._abgleichTakt()) === false && summe() === 2, 'Danach wieder still');
}

console.log('\n══ Eigenes Antippen: genau ein Rundgang (Rennen mit dem Kollegen) ══');
{
  op(A, "UPDATE schueler SET vorname=? WHERE id=?", ['Eigen', 1], 1);
  await A._saveV3();
  check(/A \d+ anhaengen/.test(zeiger()) && A._zeigerEigenOffen === true, 'Eigener Tipp merkt einen offenen Rundgang');
  // Rennen: B tippt dazwischen, A überschreibt den Zeiger mit dem eigenen Tipp
  op(B, "UPDATE schueler SET nachname=? WHERE id=?", ['Rennen', 2], 2);
  await B._saveV3();
  op(A, "UPDATE schueler SET vorname=? WHERE id=?", ['Eigen2', 1], 1);
  await A._saveV3();
  check(/^A /.test(zeiger()), 'Zeiger trägt zuletzt A – B-Tipp überschrieben');
  const r = await A._abgleichTakt();
  check(r === true && A.query('SELECT nachname FROM schueler WHERE id=2')[0].nachname === 'Rennen', 'A macht nach eigenem Tipp einen Rundgang und sieht B-Änderung trotz überschriebenem Zeiger');
  check((await A._abgleichTakt()) === false, 'Der zweite Takt nach dem eigenen Tipp ist still');
  await B._abgleichTakt();
  check(B.query('SELECT vorname FROM schueler WHERE id=1')[0].vorname === 'Eigen2', 'B sieht A-Änderung');
}

console.log('\n══ Gescheiterter Tipp: Sicherheitsnetz holt die Änderung ══');
{
  store.writeFail = (n) => n === 'zeiger_test.txt';
  op(B, "UPDATE schueler SET nachname=? WHERE id=?", ['Netz', 3], 3);
  await B._saveV3();
  check(B._dirtyOps.length === 0 && !/Netz/.test(zeiger() || ''), 'Anhängen gelingt, obwohl der Zeiger nicht angetippt werden konnte');
  store.writeFail = () => false;
  check((await A._abgleichTakt()) === false, 'A sieht keinen geänderten Zeiger');
  A._letzterRundgang = Date.now() - A.rundgangIntervallMs() - 1;
  check((await A._abgleichTakt()) === true && A.query('SELECT nachname FROM schueler WHERE id=3')[0].nachname === 'Netz', 'Sicherheitsnetz-Rundgang übernimmt die Änderung');
  check(A._rundgangNoetig === '' && (A._rundgangNoetig = 'Test', (await A._abgleichTakt()) === true) && A._rundgangNoetig === '', 'Von außen angemeldeter Rundgang läuft genau einmal');
}

console.log('\n══ Verbindungsstufen ══');
{
  check(A.verbindungsStufe === 'auto' && A.feldmodus === false && A.getaktet === false, 'Standard: automatisch');
  A._networkQuality = 'good';
  check(A._pollIntervallBerechnen() === 3000 && A.rundgangIntervallMs() === 60000 && A.appendMindestabstandMs() === 1500 && A.posMindestabstandMs() === 0, 'Gut: Takt 3 s, Rundgang 60 s, Sammelpause 1,5 s, Position sofort');
  A._networkQuality = 'slow';
  check(A._pollIntervallBerechnen() === 10000 && A.rundgangIntervallMs() === 120000 && A.appendMindestabstandMs() === 10000, 'Langsam gemessen: 10 s / 120 s / 10 s');
  A._networkQuality = 'very-slow';
  check(A._pollIntervallBerechnen() === 30000 && A.rundgangIntervallMs() === 300000 && A.appendMindestabstandMs() === 30000, 'Sehr langsam gemessen: 30 s / 300 s / 30 s');
  A._networkQuality = 'good';
  A.lsSet('bhk_feldmodus', '1');
  check(A.verbindungsStufe === 'langsam' && A.feldmodus === true, 'Alte Einstellung „Feldmodus“ wird als „Langsame Leitung“ gelesen');
  check(A._pollIntervallBerechnen() === 30000 && A.appendMindestabstandMs() === 10000 && A.posMindestabstandMs() === 10000 && A.rundgangIntervallMs() === 300000, 'Langsame Leitung: 30 s / 10 s / 10 s / 300 s');
  check(/langsame Leitung \(Einstellung\)/.test(A._kompaktGebremst()), 'Langsame Leitung bremst die Kompaktierung');
  A.setVerbindung('getaktet');
  check(A.verbindungsStufe === 'getaktet' && A.getaktet && A.feldmodus && A.lsGet('bhk_feldmodus') === '1', 'Getaktet setzt beide Schlüssel');
  check(A._pollIntervallBerechnen() === 60000 && A._liveSyncIntervallBerechnen() === 60000 && A.appendMindestabstandMs() === 60000 && A.posMindestabstandMs() === 60000, 'Getaktet: Takt 60 s, Sammelpause 60 s, Position je Minute');
  check(/getaktete Verbindung/.test(A._kompaktGebremst()), 'Getaktet bremst die Kompaktierung');
  A.backupsDirHandle = new FakeDir(store); A.lastBackupTime = 0; A._backupNeueste = 0;
  check((await A._backupFaellig()) === false, 'Getaktet: keine Sicherung von diesem Rechner');
  A.setVerbindung('auto'); A._networkQuality = 'very-slow';
  check((await A._backupFaellig()) === false, 'Sehr langsame Leitung: keine Sicherung');
  A._networkQuality = 'good';
  check(A.verbindungsStufe === 'auto' && A.lsGet('bhk_feldmodus') === '0', 'Zurück auf automatisch');
  A.setFeldmodus(true); check(A.verbindungsStufe === 'langsam', 'setFeldmodus(true) ist die Stufe „langsam“'); A.setFeldmodus(false);
  check(A.verbindungsText('getaktet') === 'Getaktete Verbindung' && A.verbindungsText() === 'Automatisch', 'Klartext der Stufen');
  check(/case 'getaktet'|value="getaktet"/.test(V_SRC) && /App\.setVerbindung\(this\.value\)/.test(V_SRC) && !/setFeldmodus\(this\.checked\)/.test(V_SRC), 'Einstellungen: Auswahl mit drei Stufen statt Feldmodus-Häkchen');
}

console.log('\n══ Sammelpause ohne Verhungern ══');
{
  const delays = [];
  const sb = A._sandbox;
  const origTimeout = sb.setTimeout;
  sb.setTimeout = (f, ms) => { delays.push(ms); return 1; };
  sb.clearTimeout = () => {};
  A._lastSaveDurationMs = 0; A._wartetSeit = 0; A.autoSaveTimer = null;
  A.scheduleAutoSave();
  check(delays.at(-1) === 1500 && A._wartetSeit > 0, 'Gut: erste Änderung wartet 1,5 s');
  A.setVerbindung('langsam');
  A._wartetSeit = Date.now() - 9000; A.scheduleAutoSave();
  check(Math.abs(delays.at(-1) - 1000) <= 50, 'Langsam: nach 9 s Warten nur noch 1 s bis zum Anhängen – Tippen verschiebt nicht endlos');
  A._wartetSeit = Date.now() - 20000; A.scheduleAutoSave();
  check(delays.at(-1) === 300, 'Frist überschritten: Anhängen in 300 ms');
  A.setVerbindung('getaktet'); A._wartetSeit = 0; A.scheduleAutoSave();
  check(delays.at(-1) === 60000, 'Getaktet: 60 s Sammelpause');
  A.setVerbindung('auto'); A._wartetSeit = 0;
  sb.setTimeout = origTimeout;
  op(A, "UPDATE schueler SET vorname=? WHERE id=?", ['Pause', 3], 3);
  A._wartetSeit = Date.now() - 5000;
  await A._saveV3();
  check(A._wartetSeit === 0, 'Anhängen setzt die Wartefrist zurück');
}

console.log('\n══ Positionen im Rundgang, Positionsdatei mit Mindestabstand ══');
{
  let live = 0;
  A._sandbox.KontrolleHandler = { activePruefer: 'Anna', currentTerminId: 10, _liveSyncTimer: 1, doLiveSync() { live++; } };
  B._sandbox.KontrolleHandler = { activePruefer: 'Bernd' };
  await B._writePositionFile('Bernd', 10, 5, 'Fünf', Date.now(), null);
  check(store.files.has('pos-Bernd.json') && /B \d+ position/.test(zeiger()), 'Positionsdatei geschrieben und Zeiger angetippt');
  reset();
  const r = await A._abgleichTakt();
  check(r === true && (A._otherPositions || []).some(p => p.pruefer === 'Bernd' && p.schuelerId === 5) && live === 1, 'Rundgang liest die Position des Kollegen aus derselben Auflistung und stößt die Live-Anzeige an');
  check(z.entries === 1, 'Keine zweite Auflistung für Positionen');
  A._sandbox.KontrolleHandler._liveSyncTimer = null;
  A._rundgangNoetig = 'Test'; live = 0; await A._abgleichTakt();
  check(live === 0, 'Ohne offene Kontrolle werden keine Positionsdateien gelesen');
  check(!/await App\._readPositionFiles\(pruefer\);/.test(K_SRC) && /App\._rundgangNoetig = 'Kontrolle geöffnet'/.test(K_SRC), 'Kontrolle: kein eigener Positions-Rundgang mehr, Öffnen fordert einen Rundgang an');
  // Mindestabstand
  const delays = []; const sb = B._sandbox; const origTimeout = sb.setTimeout;
  sb.setTimeout = (f, ms) => { delays.push([f, ms]); return 1; };
  B.setVerbindung('getaktet');
  B._posZuletzt = Date.now();
  await B._writePositionFile('Bernd', 10, 6, 'Sechs', Date.now(), null);
  check(delays.length === 1 && delays[0][1] > 59000 && delays[0][1] <= 60000 && B._posAusstehend && B._posAusstehend[2] === 6, 'Getaktet: zweite Position innerhalb einer Minute wird aufgeschoben');
  await B._writePositionFile('Bernd', 10, 7, 'Sieben', Date.now(), null);
  check(delays.length === 1 && B._posAusstehend[2] === 7, 'Weitere Wechsel ersetzen nur den wartenden Stand (ein Timer)');
  B._posTimer = null; B._posZuletzt = 0; const f = delays[0][0]; await f(); await new Promise(r => setTimeout(r, 20));
  const pos = JSON.parse(new TextDecoder().decode(store.files.get('pos-Bernd.json').data));
  check(pos.s === 7 && B._posAusstehend === null, 'Nach der Pause wird der letzte Stand geschrieben');
  B.setVerbindung('auto'); sb.setTimeout = origTimeout;
  await B._deletePositionFile('Bernd');
  check(!store.files.has('pos-Bernd.json') && /B \d+ position/.test(zeiger()), 'Löschen der Position tippt den Zeiger an');
}

console.log('\n══ Snapshot tippt den Zeiger an, Rotation ab 64 KB, Takt nutzt den Zeiger ══');
{
  A._sandbox.KontrolleHandler = { activePruefer: 'Anna' };
  const vorher = zeiger();
  const ok = await A._compact('test');
  check(ok === true && /A \d+ snapshot/.test(zeiger()) && zeiger() !== vorher, 'Kompaktierung tippt den Zeiger an');
  const r = await B._abgleichTakt();
  check(r === true && B._snapGen === A._snapGen, 'B übernimmt die neue Generation nach dem Zeiger');
  check(A.LOG_ROTATE_BYTES === 64 * 1024, 'Protokoll rotiert ab 64 KB (kleinere Kopie je Anhängen)');
  check(/if \(this\._v3Active\(\)\) await this\._abgleichTakt\(\);/.test(APP_SRC), 'Takt liest den Zeiger statt jedes Mal den Rundgang zu laufen');
  const d = A.diagnose ? A.diagnose() : null;
  check(!d || (d.verbindung && d.verbindung.verbindung === 'auto' && 'rundgangTaktMs' in d.verbindung && 'zeiger' in d.verbindung), 'Zustandsbild nennt Stufe, Rundgang-Takt und Zeiger');
  check(/navigator\.connection\.saveData/.test(APP_SRC) && /bhk_sparhinweis/.test(APP_SRC), 'Datensparmodus des Browsers löst einmal einen Hinweis aus');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
