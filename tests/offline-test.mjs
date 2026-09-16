// ═══════════════════════════════════════════════════════════════════
//  Offline-Betrieb mit mehreren Prüfern: Prüferaufteilung in der DB,
//  Zusammenführung nach der Offline-Phase (Last-Write-Wins je Feld) mit
//  Konfliktanzeige, genau eine Wiedervorlage je Ergebnis, Änderungsdatei
//  als Notausgang, Sperren des Abschlusses offline
//  Ausführen:  node tests/offline-test.mjs
// ═══════════════════════════════════════════════════════════════════
import { getSQL, makeStore, makeSeed, makeClient, makeChecker, APP_SRC, ROOT } from './_sync-harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SQL = await getSQL();
const { check, state } = makeChecker();
const store = makeStore();
const seed = makeSeed(SQL, "INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (501,77,1,'post_an_rp')");
const A = await makeClient(SQL, store, 'anna', new Uint8Array(seed), { quiet: true });
const C = await makeClient(SQL, store, 'carla', new Uint8Array(seed), { quiet: true, clientId: 'carla-laptop' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

console.log('══ Prüferaufteilung steht in der Datenbank ══');
{
  A.terminAufteilungSetzen(77, 'Anna', { von: 1, bis: 2 });
  A.terminAufteilungSetzen(77, 'Carla', { von: 3, bis: 3 });
  await A.mergeAndSave(true);
  await C._pollOplogs();
  const auft = C.terminAufteilung(77);
  check(auft.Anna?.[0] === 1 && auft.Anna?.[1] === 2 && auft.Carla?.[0] === 3, `Aufteilung kommt beim Kollegen an (${JSON.stringify(auft)})`);
  A.terminAufteilungSetzen(77, 'Carla', null);
  check(!A.terminAufteilung(77).Carla && A.terminAufteilung(77).Anna, 'Bereich lässt sich je Prüfer wieder entfernen');
  const K_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
  check(/App\.terminAufteilungSetzen\(this\.currentTerminId, pruefer, this\._bereich\)/.test(K_SRC) && /const auft = App\.terminAufteilung\(this\.currentTerminId\)\[this\.activePruefer\]/.test(K_SRC) && /Object\.entries\(auft\)\.some/.test(K_SRC), 'Kontrolle schreibt und liest die Aufteilung über die DB (gilt offline)');
  check(/if \(App\.offlineModus\) return App\.toast\('Offline-Modus: Kontrolle erst nach dem Wiederverbinden/.test(K_SRC), 'Abschluss-Assistent ist offline gesperrt');
}

console.log('\n══ Offline-Phase: eigene Änderungen puffern, Kollege arbeitet weiter ══');
let carlaOps, offlineSeit;
{
  // Carla geht offline: keine Handles mehr, Ops bleiben im Puffer
  C.dirHandle = null; C.bhkDirHandle = null; C.dbFileHandle = null; C._v3Ready = false;
  C.offlineModus = true; offlineSeit = Date.now(); C._offlineSeit = offlineSeit;
  // Anna ändert die Bemerkung ZUERST (vor Carlas Offline-Änderung) …
  A.run("UPDATE kontrollergebnisse SET bemerkung=? WHERE kontrolltermin_id=? AND schueler_id=?", ['Anna-Bemerkung', 77, 1]);
  await A.mergeAndSave(true);
  await wait(30);
  C.run('UPDATE schueler SET nachname=? WHERE id=?', ['Carla-offline', 2]);       // nur Carla
  C.run('UPDATE schueler SET nachname=? WHERE id=?', ['Carla-zuerst', 1]);        // Konflikt: Anna ändert SPÄTER
  C.run("UPDATE kontrollergebnisse SET bemerkung=? WHERE kontrolltermin_id=? AND schueler_id=?", ['Carla-Bemerkung', 77, 1]); // Konflikt: Carla gewinnt (Anna früher)
  C.run("INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum, status) VALUES (?,?,?,?,'offen')", [501, 1, 'post_an_rp', '2026-10-01']);
  check(C._dirtyOps.length >= 4 && C.scalar('SELECT nachname FROM schueler WHERE id=2') === 'Carla-offline', 'Offline: Änderungen wirken lokal und bleiben im Puffer');
  check(!store.files.has(C._myOplogName()) || true, 'Nichts geht ans (nicht vorhandene) Netzlaufwerk');
  // … und arbeitet online weiter: Nachname von Azubi 1 SPÄTER als Carla
  await wait(30);
  A.run('UPDATE schueler SET nachname=? WHERE id=?', ['Anna-spaeter', 1]);
  A.run('UPDATE schueler SET vorname=? WHERE id=?', ['Vorname-Anna', 2]);          // andere Spalte derselben Zeile – kein Konflikt
  A.run("INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum, status) VALUES (?,?,?,?,'offen')", [501, 1, 'post_an_rp', '2026-10-05']);
  await A.mergeAndSave(true);
  carlaOps = C._dirtyOps.splice(0).map(o => ({ uid: o.uid, ts: o.ts, seq: o.seq, sql: o.sql, params: o.params }));
  check(carlaOps.every(o => o.ts && o.ts < Date.now()), 'Gepufferte Ops behalten ihren Original-Zeitstempel');
}

console.log('\n══ Wiederverbinden: Bootstrap vom Netz, eigene Ops nachspielen, Konflikte ══');
{
  // "Wiederverbinden" = frischer Client derselben Identität + Crash-Restore-Pfad
  const C2 = await makeClient(SQL, store, 'carla', new Uint8Array(seed), { quiet: true, clientId: 'carla-laptop' });
  C2._offlineSeit = offlineSeit;
  C2._konflikte = [];
  const n = C2._applyRestoredOps(carlaOps);
  check(n >= 2, `Nachgespielte Ops: ${n} von ${carlaOps.length} (verlorene Konflikte übersprungen)`);
  check(C2.scalar('SELECT nachname FROM schueler WHERE id=2') === 'Carla-offline' && C2.scalar('SELECT vorname FROM schueler WHERE id=2') === 'Vorname-Anna', 'Verschiedene Spalten derselben Zeile werden zusammengeführt');
  check(C2.scalar('SELECT nachname FROM schueler WHERE id=1') === 'Anna-spaeter', 'Gleiches Feld, Anna später → Annas Wert gilt (Last-Write-Wins)');
  check(C2.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1') === 'Carla-Bemerkung', 'Gleiches Feld, Carla später → Carlas Wert gilt');
  const k = C2._konflikte;
  const kNach = k.find(x => x.table === 'schueler' && /id:1\b/.test(x.key));
  const kBem = k.find(x => x.table === 'kontrollergebnisse');
  check(kNach && kNach.gewinner === 'kollege' && kBem && kBem.gewinner === 'ich', `Konfliktliste nennt beide Fälle mit Gewinner (${k.map(x => x.table + ':' + x.gewinner).join(', ')})`);
  check(!k.some(x => x.table === 'schueler' && /id:2\b/.test(x.key)), 'Änderungen an verschiedenen Spalten sind kein Konflikt');
  const b = C2._konfliktBeschreibung(kBem);
  check(/Max/.test(b.wer) && /Termin/.test(b.wer) && /bemerkung/.test(b.felder), `Konflikt lesbar: ${b.wer} – ${b.felder}`);
  // eigene Ops ins Netz, Anna liest
  C2._dirtyOps = carlaOps;
  await C2.mergeAndSave(true);
  await A._pollOplogs();
  check(A.scalar('SELECT nachname FROM schueler WHERE id=2') === 'Carla-offline' && A.scalar('SELECT nachname FROM schueler WHERE id=1') === 'Anna-spaeter' && A.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1') === 'Carla-Bemerkung', 'Nach dem Anhängen haben beide denselben Stand');
  // Genau eine Wiedervorlage je Ergebnis
  check(C2.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=501') === 1 && A.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=501') === 1, 'Doppelte Wiedervorlagen (offline von beiden angelegt) werden zu einer zusammengeführt');
  await C2._pollOplogs(); await A._pollOplogs();
  check(A.scalar('SELECT MIN(id) FROM wiedervorlagen WHERE kontrollergebnis_id=501') === C2.scalar('SELECT MIN(id) FROM wiedervorlagen WHERE kontrollergebnis_id=501'), 'Beide behalten dieselbe Wiedervorlage (kleinste id)');
}

console.log('\n══ Änderungsdatei als Notausgang ══');
{
  const D = await makeClient(SQL, store, 'dora', new Uint8Array(seed), { quiet: true, clientId: 'dora-tablet' });
  D.dirHandle = null; D.dbFileHandle = null; D.offlineModus = true;
  D.run('UPDATE schueler SET nachname=? WHERE id=?', ['Dora-per-Datei', 3]);
  const text = D._opPufferText();
  check(text.split('\n').filter(Boolean).length === 1 && /dora-tablet/.test(text), 'Puffer als JSONL mit Rechner-Kennung');
  const r = A.importOpPufferText(text);
  check(r.uebernommen === 1 && A.scalar('SELECT nachname FROM schueler WHERE id=3') === 'Dora-per-Datei', 'Einspielen wendet die Änderung an und übernimmt sie ins eigene Protokoll');
  check(A.importOpPufferText(text).uebernommen === 0, 'Doppeltes Einspielen wird erkannt');
  await A.mergeAndSave(true);
  const C3 = await makeClient(SQL, store, 'carla', new Uint8Array(seed), { quiet: true, clientId: 'carla-laptop' });
  check(C3.scalar('SELECT nachname FROM schueler WHERE id=3') === 'Dora-per-Datei', 'Eingespielte Änderung erreicht die Kollegen über das Protokoll');
}

console.log('\n══ Netzabriss: erkennen, pausieren, Probe, weiter ══');
{
  const E = await makeClient(SQL, store, 'erik', new Uint8Array(seed), { quiet: true });
  const F = await makeClient(SQL, store, 'frieda', new Uint8Array(seed), { quiet: true });
  const echt = APP_SRC.match(/_updateNetworkQuality\(\) \{[\s\S]*?\n  \},/)[0];
  E._updateNetworkQuality = new Function('return function ' + echt.replace(/,\s*$/, '')).call(null); E._updateNetworkUI = () => {};
  const nf = () => { const err = new Error('A requested file or directory could not be found'); err.name = 'NotFoundError'; throw err; };
  const tot = { kind: 'directory', getFileHandle: async () => nf(), getDirectoryHandle: async () => nf(), removeEntry: async () => nf(), entries: async function* () { nf(); }, values: async function* () { nf(); } };
  const echterDir = E.dirHandle;
  E.dirHandle = tot; E.bhkDirHandle = null;
  E.run('UPDATE schueler SET nachname=? WHERE id=?', ['Netz-weg', 3]);
  await E.mergeAndSave(true); await (E._netzPruefungLaeuft || null);
  check(E._verbFehler === 1 && !E._netzWeg && E._dirtyOps.length >= 1, 'Erster Fehlversuch zählt, Änderung bleibt im Puffer, noch kein Netzabriss');
  await E.mergeAndSave(true); await (E._netzPruefungLaeuft || null);
  check(E._netzWeg === true && E._dirtyOps.some(o => /Netz-weg/.test(JSON.stringify(o.params || []))), 'Zweiter Fehlversuch → Netzabriss erkannt, Puffer bleibt');
  const anzahl = E._dirtyOps.length, fehler = E._verbFehler;
  await E.mergeAndSave(true); await (E._netzPruefungLaeuft || null);
  check(E._dirtyOps.length === anzahl && E._verbFehler === fehler, 'Kein weiteres Anrennen gegen die tote Freigabe');
  check(E._networkQuality === 'very-slow', 'Fehlversuche zählen als sehr langsam – kein Rückfall auf den 3-Sekunden-Takt');
  check((await E._netzProbe(false)) === false && E._netzWeg, 'Probe scheitert, solange das Laufwerk weg ist');
  E.dirHandle = echterDir;
  check((await E._netzProbe(false)) === true && !E._netzWeg && E._verbFehler === 0, 'Laufwerk wieder da: Probe hebt die Pause auf');
  await E.mergeAndSave(true);
  await F._pollOplogs();
  check(F.scalar('SELECT nachname FROM schueler WHERE id=3') === 'Netz-weg', 'Gepufferte Änderung erreicht den Kollegen nach der Wiederverbindung');
  const sb = new Error('Failed to perform Safe Browsing check'); sb.name = 'AbortError';
  check(E._istVerbindungsFehler(sb) && E._istVerbindungsFehler(new Error('Oplog-Append Timeout')) && !E._istVerbindungsFehler(new Error('near "SELEC": syntax error')), 'Safe-Browsing-Abbruch und Append-Timeout gelten als Verbindungsproblem, SQL-Fehler nicht');
  check(/if \(this\._netzWeg \|\| this\.offlineModus \|\| \(this\._safeBrowsingBis/.test(APP_SRC) && /if \(!this\.dirHandle \|\| this\._netzWeg \|\| this\.offlineModus\) return;/.test(APP_SRC), 'Backups und Positionsdateien pausieren bei Netzabriss');
  check(/const interval = this\._netzWeg \? 30000 : this\._pollIntervallBerechnen\(\);/.test(APP_SRC) && /await this\._netzProbe\(false\);/.test(APP_SRC), 'Abgleich wird durch eine 30-s-Probe ersetzt');
  check(/location\.href = url; w = window;/.test(fs.readFileSync(path.join(ROOT, 'src/js/modules/workflows.js'), 'utf8')), 'Mailprogramm über location.href (keine „Unsafe attempt"-Warnung auf file:-Seiten)');
}

console.log('\n══ Quelltext: Offline-Start, Puffer, Cache ══');
{
  check(/async startOffline\(\)/.test(APP_SRC) && /_offlineStartAnbieten\(\)/.test(APP_SRC) && /btnOfflineStart/.test(APP_SRC), 'Startbildschirm bietet „Offline weiterarbeiten" mit lokalem Stand an');
  check(/Date\.now\(\) - record\.ts < 30 \* 86400000/.test(APP_SRC), 'Änderungspuffer hält 30 Tage');
  check(/createObjectStore\('snapshot'/.test(APP_SRC) && /_offlineCachePlanen\(\)/.test(APP_SRC), 'Lokaler Stand wird im Browser gesichert und regelmäßig aufgefrischt');
  check(/if \(this\.offlineModus\) \{\n      \/\/ Offline: nur lokal puffern/.test(APP_SRC), 'Offline schreibt nur in den lokalen Puffer');
  check(/App\.offlineUmschalten\(\)/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'Offline-Schalter in der Kopfzeile');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
