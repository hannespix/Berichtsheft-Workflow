// ═══════════════════════════════════════════════════════════════════
//  Stau-Nachwehen: großes eigenes Log wird VOR dem Anhängen und beim Start
//  rotiert (kein Kopieren von Megabytes), automatische Kompaktierung nie mit
//  nicht angehängten eigenen Ops (sonst Doppel-Einspielen bei allen),
//  Änderungslog-Doppel sind kein Fehler und werden gesammelt gemeldet,
//  Kompaktierung wird ab 8 MB ungedeckter Protokolle auch über langsame
//  Leitung dringend
//  Ausführen:  node tests/stau-test.mjs
// ═══════════════════════════════════════════════════════════════════
import { APP_SRC, makeStore, FakeDir, getSQL, makeSeed, makeClient, makeChecker } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const store = makeStore();
const seed = makeSeed(SQL);
const enc = new TextEncoder(), dec = new TextDecoder();
const op = (app, sql, params, sid) => { app._dirtyOps.push({ uid: 'u' + Math.random().toString(36).slice(2), ts: Date.now(), seq: (app._seq = (app._seq || 0) + 1), sql, params, sid }); };
const zeile = (uid, sql, params) => JSON.stringify({ uid, ts: Date.now(), seq: 1, c: 'X', u: 'x', sql, params }) + '\n';
const datei = (n) => store.files.get(n);

const A = await makeClient(SQL, store, 'Anna', seed, { quiet: true, clientId: 'A' });

console.log('══ Großes eigenes Log: Rotation VOR dem Anhängen ══');
{
  A.LOG_ROTATE_BYTES = 400;
  // Zustand „Log ist riesig, Rotation nie erfolgt“: eigene Datei künstlich groß
  const mine = A._myOplogName();
  let inhalt = '';
  for (let i = 0; i < 8; i++) inhalt += zeile('alt' + i, "UPDATE schueler SET vorname=? WHERE id=?", ['Alt' + i, 1]);
  store.files.set(mine, { data: enc.encode(inhalt), mtime: Date.now() });
  A._myLogSize = inhalt.length;
  const genVorher = A._logGen;
  op(A, "UPDATE schueler SET nachname=? WHERE id=?", ['Rotiert', 1], 1);
  await A._saveV3();
  check(A._logGen === genVorher + 1, `Vor dem Anhängen auf neue Generation gedreht (${genVorher} → ${A._logGen})`);
  check(datei(mine).data.length === inhalt.length, 'Die alte, große Datei wurde nicht angefasst (keine Kopie)');
  const neu = datei(A._myOplogName());
  check(neu && /Rotiert/.test(dec.decode(neu.data)) && A._dirtyOps.length === 0, 'Die Änderung steht in der neuen, kleinen Datei');
  check(A._logOffsets[mine] === inhalt.length, 'Lesestand der alten Datei notiert (kein Selbst-Replay)');
  check(A._myLogSize === neu.data.length, 'Eigene Größe = neue Datei');
}

console.log('\n══ Großes eigenes Log beim Start: sofort neue Generation ══');
{
  const B = await makeClient(SQL, store, 'Bernd', seed, { quiet: true, clientId: 'B', skipBootstrap: true });
  B.LOG_ROTATE_BYTES = 400;
  const name = B._oplogPrefix() + 'B_g1.jsonl';
  let inhalt = '';
  for (let i = 0; i < 8; i++) inhalt += zeile('b' + i, "UPDATE schueler SET vorname=? WHERE id=?", ['B' + i, 2]);
  store.files.set(name, { data: enc.encode(inhalt), mtime: Date.now() });
  await B._bootstrapV3();
  check(B._logGen === 2 && B._myLogSize === 0 && B._logOffsets[name] === inhalt.length, 'Bootstrap: großes eigenes Log → Generation 2, Lesestand der alten notiert');
  check(B.query('SELECT vorname FROM schueler WHERE id=2')[0].vorname === 'B7', 'Eigene Ops aus dem alten Log wurden trotzdem angewendet');
  op(B, "UPDATE schueler SET nachname=? WHERE id=?", ['Start', 2], 2);
  await B._saveV3();
  check(datei(B._myOplogName()) && datei(name).data.length === inhalt.length, 'Erstes Anhängen geht in die neue Datei, die alte bleibt');
  await A._pollOplogs();
  check(A.query('SELECT nachname FROM schueler WHERE id=2')[0].nachname === 'Start', 'Kollege liest beide Generationen');
}

console.log('\n══ Automatische Kompaktierung nie mit nicht angehängten eigenen Ops ══');
{
  const prefix = A._oplogPrefix() + 'A_';
  store.writeFail = (n) => n.startsWith(prefix);
  op(A, "UPDATE schueler SET nachname=? WHERE id=?", ['Haengt', 3], 3);
  await A._saveV3();
  check(A._dirtyOps.length === 1, 'Anhängen scheitert, Op bleibt im Puffer');
  const genVor = A._snapGen;
  const ok = await A._compact('groesse');
  check(ok === false && /noch nicht angehängt/.test(A._compactGrund) && A._snapGen === genVor, `Automatische Kompaktierung wartet: „${A._compactGrund}“`);
  const okStart = await A._compact('start');
  check(okStart === false, 'Auch die Start-Kompaktierung wartet');
  const okImport = await A._compact('import');
  check(okImport === true && A._snapGen > genVor, 'Import schreibt seinen Stand trotzdem (muss gespeichert werden)');
  store.writeFail = () => false;
  await A._saveV3();
  check(A._dirtyOps.length === 0, 'Danach wird die Op normal angehängt');
  check(/reason === 'groesse' \|\| reason === 'start'/.test(APP_SRC), 'Wächter gilt genau für die automatischen Läufe');
}

console.log('\n══ Änderungslog: Doppel ist kein Fehler, Meldung gesammelt ══');
{
  A._dirtyOps.length = 0;
  A.run("INSERT OR IGNORE INTO aenderungslog (schueler_id, schueler_name, feld, alter_wert, neuer_wert, aktion, bearbeiter, ibykus_relevant) VALUES (?,?,?,?,?,?,?,?)", [1, 'X', 'vorname', 'a', 'b', 'geaendert', 'Anna', 0]);
  const o = A._dirtyOps[0];
  check(o && /^INSERT OR IGNORE INTO aenderungslog \(id,/.test(o.sql) && typeof o.params[0] === 'number', 'Globale Kennung wird auch bei INSERT OR IGNORE eingesetzt');
  check(/INSERT OR IGNORE INTO aenderungslog \(schueler_id/.test(APP_SRC), 'Der Kern schreibt das Änderungslog mit OR IGNORE');
  const B = await makeClient(SQL, store, 'Bernd', seed, { quiet: true, clientId: 'B2' });
  const logs = [], warns = [];
  B._sandbox.console.log = (...a) => logs.push(a.join(' '));
  B._sandbox.console.warn = (...a) => warns.push(a.join(' '));
  const l1 = JSON.stringify({ uid: 'd1', ts: Date.now(), seq: 1, c: 'A', sql: o.sql, params: o.params });
  const l2 = JSON.stringify({ uid: 'd2', ts: Date.now(), seq: 2, c: 'A', sql: o.sql, params: o.params });
  const n = B._applyOps([l1, l2]);
  check(B.query('SELECT COUNT(*) AS n FROM aenderungslog WHERE id=?', [o.params[0]])[0].n === 1 && warns.length === 0, 'Zweites Einspielen derselben Zeile: kein Fehler, eine Zeile');
  // Alte Protokollzeilen ohne OR IGNORE: UNIQUE-Fehler nur gezählt
  const alt = o.sql.replace('INSERT OR IGNORE', 'INSERT');
  const l3 = JSON.stringify({ uid: 'd3', ts: Date.now(), seq: 3, c: 'A', sql: alt, params: o.params });
  const l4 = JSON.stringify({ uid: 'd4', ts: Date.now(), seq: 4, c: 'A', sql: alt, params: o.params });
  B._applyOps([l3, l4]);
  check(warns.length === 0 && logs.filter(l => /2 Op\(s\) übersprungen – Zeilen bereits vorhanden/.test(l)).length === 1 && B._doppelteOps === 2, 'Alte Zeilen: eine Sammelmeldung statt je einer Warnung, Zähler im Kern');
  B._applyOps([JSON.stringify({ uid: 'd5', ts: Date.now(), seq: 5, c: 'A', sql: 'UPDATE gibtsnicht SET x=1', params: [] })]);
  check(warns.some(w => /Op übersprungen/.test(w)), 'Echte Fehler werden weiterhin einzeln gemeldet');
}

console.log('\n══ Dringende Kompaktierung über langsame Leitung ══');
{
  A._letzteKompaktierung = 0; A._networkQuality = 'very-slow'; A.lsSet('bhk_verbindung', 'auto');
  check(/sehr langsame Leitung/.test(A._kompaktGebremst()) && A._kompaktGebremst(true) === '', 'Normal gebremst, dringend frei');
  A.lsSet('bhk_verbindung', 'langsam');
  check(/langsame Leitung \(Einstellung\)/.test(A._kompaktGebremst()) && A._kompaktGebremst(true) === '', 'Einstellung „Langsame Leitung“: dringend frei');
  A.lsSet('bhk_verbindung', 'getaktet');
  check(/getaktete/.test(A._kompaktGebremst(true)), 'Getaktet bremst auch dringend');
  A._letzteKompaktierung = Date.now();
  A.lsSet('bhk_verbindung', 'auto');
  check(/vor 0 min/.test(A._kompaktGebremst(true)), 'Mindestabstand gilt auch dringend');
  A._letzteKompaktierung = 0;
  // 9 MB ungedecktes fremdes Protokoll
  const gross = A._oplogPrefix() + 'Z_g1.jsonl';
  store.files.set(gross, { data: new Uint8Array(9 * 1024 * 1024), mtime: Date.now() });
  A._lastFileSize = 1000000;
  check((await A._compactionDue()) === true, '9 MB ungedeckt + sehr langsame Leitung → Kompaktierung fällig (dringend)');
  store.files.set(gross, { data: new Uint8Array(2 * 1024 * 1024), mtime: Date.now() });
  check((await A._compactionDue()) === false, '2 MB ungedeckt + sehr langsame Leitung → weiter gebremst');
  A._networkQuality = 'good';
  check((await A._compactionDue()) === true, '2 MB bei guter Leitung → fällig (über der 1,5-MB-Schwelle)');
  store.files.delete(gross);
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
