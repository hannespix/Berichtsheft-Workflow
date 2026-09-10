// ═══════════════════════════════════════════════════════════════════
//  Sync-v3 Störfall- und Stresstest (Audit 6: Parallelzugriff auf dem
//  Windows-Netzlaufwerk, 3 Nutzer gleichzeitig)
//  Ausführen:  node tests/sync-stress-test.mjs
//
//  Szenarien, die ein echtes SMB-Laufwerk liefert und die der einfache
//  sync-test nicht abdeckt: Lesefehler mitten im Poll, Negativ-Cache beim
//  Lock, Snapshot-Tausch mit divergenten Kontrollergebnis-IDs, Reihenfolge
//  nach dem Tausch, veralteter Crash-Puffer, Import ohne Kompaktierung,
//  gelöschtes Log eines zurückkehrenden Clients, abgeschnittener Snapshot –
//  und zum Schluss ein Zufalls-Stresstest mit drei Clients unter Störungen.
// ═══════════════════════════════════════════════════════════════════
import { getSQL, makeStore, makeSeed, makeClient, makeChecker, FakeDir } from './_sync-harness.mjs';

const SQL = await getSQL();
const seedBytes = makeSeed(SQL);
const { check, state } = makeChecker();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function frisch(n = 3, storeOpts = {}) {
  const store = Object.assign(makeStore(), storeOpts);
  store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
  const namen = ['anna', 'bernd', 'clara'];
  const clients = [];
  for (let i = 0; i < n; i++) clients.push(await makeClient(SQL, store, namen[i], new Uint8Array(seedBytes), { quiet: true }));
  return { store, clients };
}
const notiz = (app, text) => app.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)", [1, text, 'x']);
const hatNotiz = (app, text) => app.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz=?', [text]) === 1;
const kwUpsert = (app, sid, kw, codes) => app.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (?,?,?,?,?,1) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [sid, 1, kw, codes, 0]);
const kwCodes = (app, sid, kw) => app.scalar('SELECT maengel_codes FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=1 AND kalenderwoche=?', [sid, kw]);

console.log('══ S1: Lesefehler mitten im Poll darf keine Ops verschlucken ══');
{
  const { store, clients: [A, B, C] } = await frisch();
  notiz(A, 'S1-A'); await A.mergeAndSave(true);
  notiz(C, 'S1-C'); await C.mergeAndSave(true);
  // B liest A's Log noch erfolgreich, C's Log scheitert (Datei wurde gerade
  // per Swap ersetzt → Chrome: NotReadableError)
  const cLog = C._myOplogName();
  store.readFail = (name) => name === cLog;
  await B._pollOplogs();
  store.readFail = () => false;
  await B._pollOplogs();
  await B._pollOplogs();
  check(hatNotiz(B, 'S1-C'), 'B erhält die Op aus dem zunächst unlesbaren Log beim nächsten Poll');
  check(hatNotiz(B, 'S1-A'), 'B erhält AUCH die Op aus dem bereits gelesenen Log (Offset darf nicht ohne Anwendung vorrücken)');
}

console.log('\n══ S2: Divergente KE-IDs + fremder Snapshot → UI-Schreibziel bleibt gültig ══');
{
  const { store, clients: [A, B, C] } = await frisch();
  // A und B öffnen dieselbe Kontrolle gleichzeitig: beide legen die KE-Zeile
  // für Azubi 2 an (INSERT OR IGNORE) – mit verschiedenen globalen IDs
  const ins = (app) => app.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 2, '{}']);
  ins(A); ins(B);
  await A.mergeAndSave(true); await B.mergeAndSave(true);
  await A._pollOplogs(); await B._pollOplogs(); await C._pollOplogs();
  const idA = A.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  const idB = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  const idC = C.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  check(idA !== idB, `lokale KE-IDs divergieren (A ${idA} / B ${idB})`);
  // C (dritter Nutzer) kompaktiert → Snapshot trägt C's ID-Sicht
  check(await C._compact('s2') === true, 'C kompaktiert');
  const X = idC === idA ? B : A;            // der Client, dessen lokale ID NICHT im Snapshot steht
  const Y = X === A ? B : A;
  const altId = X === A ? idA : idB;
  await X._pollOplogs();                      // übernimmt den fremden Snapshot
  check(X._snapGen === C._snapGen, 'X hat den fremden Snapshot übernommen');
  // Die geöffnete Durchsicht schreibt weiter mit der ID, die sie beim Rendern kannte
  X.run("UPDATE kontrollergebnisse SET bemerkung='S2-Bemerkung', geaendert_am=datetime('now','localtime') WHERE id=?", [altId]);
  check(X.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2') === 'S2-Bemerkung',
    'Schreiben über die zuvor gerenderte KE-ID trifft nach dem Snapshot-Tausch weiterhin die Zeile');
  await X.mergeAndSave(true);
  await Y._pollOplogs(); await C._pollOplogs();
  check(Y.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2') === 'S2-Bemerkung', 'Änderung kommt beim zweiten Prüfer an');
  check(C.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2') === 'S2-Bemerkung', 'Änderung kommt beim Kompaktierer an');
}

console.log('\n══ S3: Reihenfolge nach Snapshot-Tausch (eigene vs. fremde Nachzügler) ══');
{
  const { store, clients: [A, B] } = await frisch(2);
  kwUpsert(A, 1, 20, 'X'); await A.mergeAndSave(true);
  await sleep(5);
  await B._pollOplogs();
  kwUpsert(B, 1, 20, 'Y'); await B.mergeAndSave(true);   // Y ist NEUER als X
  await A._pollOplogs();
  check(kwCodes(A, 1, 20) === 'Y' && kwCodes(B, 1, 20) === 'Y', 'Ausgangslage: beide sehen Y');
  // Fremder Snapshot OHNE beide Ops, Offsets decken nichts ab
  const gen = Math.max(A._snapGen || 0, B._snapGen || 0) + 1;
  store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
  store.files.set('snapmeta_test.json', { data: new TextEncoder().encode(JSON.stringify({ gen, by: 'fremd', t: new Date().toISOString(), offsets: {} })), mtime: Date.now() });
  await B._pollOplogs(); await B._pollOplogs();
  await A._pollOplogs(); await A._pollOplogs();
  check(kwCodes(B, 1, 20) === 'Y', `B: neuere eigene Op gewinnt auch nach dem Tausch (ist ${kwCodes(B, 1, 20)})`);
  check(kwCodes(A, 1, 20) === 'Y', `A: neuere fremde Op gewinnt auch nach dem Tausch (ist ${kwCodes(A, 1, 20)})`);
}

console.log('\n══ S4: Crash-Puffer älter als eine Stunde geht nicht verloren ══');
{
  const { clients: [R] } = await frisch(1);
  const alt = { uid: 'crash-1', ts: Date.now() - 3 * 3600000, seq: 1,
    sql: "INSERT INTO wiedervorlage_notizen (id,wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?,?)", params: [9001, 1, 'S4-Puffer', 'rita'] };
  const record = { id: R._idbOpsKey(), ops: [alt], ts: Date.now() - 3 * 3600000 }; // 3 h alt (Laptop zugeklappt)
  R._getIDB = async () => ({
    transaction: () => ({ objectStore: () => ({ get: () => { const req = {}; setTimeout(() => req.onsuccess && req.onsuccess(), 0); Object.defineProperty(req, 'result', { get: () => record }); return req; }, put() {}, delete() {} }) }),
  });
  await R._restoreDirtyOps();
  await sleep(30);
  check(hatNotiz(R, 'S4-Puffer') && R._dirtyOps.some(o => o.uid === 'crash-1'), 'Ungespeicherte Änderung von gestern wird wiederhergestellt statt still verworfen');
}

console.log('\n══ S5: Lock-Race mit Windows-Negativ-Cache (FileNotFoundCache 5 s) ══');
{
  const store = Object.assign(makeStore(), { negativeCacheMs: 5000 });
  store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
  const dirA = new FakeDir(store), dirB = new FakeDir(store);
  const A = await makeClient(SQL, store, 'anna', new Uint8Array(seedBytes), { quiet: true, dir: dirA });
  const B = await makeClient(SQL, store, 'bernd', new Uint8Array(seedBytes), { quiet: true, dir: dirB });
  // B hat den Lock-Namen kurz zuvor nachgeschlagen (nicht vorhanden → gecacht)
  try { await dirB.getFileHandle('lock_test', { create: false }); } catch(e) {}
  const a = await A._acquireLock();
  const b = await B._acquireLock();
  check(a === true, 'A bekommt das Lock');
  check(b === false, 'B darf das Lock NICHT ebenfalls bekommen, obwohl sein Redirector die Datei noch als fehlend meldet');
  await A._releaseLock();
}

console.log('\n══ S6: Import ohne mögliche Kompaktierung darf nicht verloren gehen ══');
{
  const { store, clients: [A, B] } = await frisch(2);
  // IBYKUS-Import: Bulk-Modus umgeht das Op-Log, fullSave kompaktiert direkt
  A._bulkImport = true;
  A.run("INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (?,?,?,1)", [501, 'Import', 'Eins']);
  A.run("INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (?,?,?,1)", [502, 'Import', 'Zwei']);
  A._bulkImport = false;
  const origLock = A._acquireLock;
  A._acquireLock = async () => false;          // Lock dauerhaft belegt (Kollege kompaktiert / Sperrdatei hängt)
  let fehler = null;
  try { await A.fullSave(); } catch(e) { fehler = e; }
  check(!!fehler, 'fullSave meldet den Misserfolg ehrlich (wirft)');
  // Inzwischen kompaktiert B (ohne die Import-Zeilen) → fremder Snapshot
  check(await B._compact('s6') === true, 'B kompaktiert zwischendurch');
  await A._pollOplogs();
  check(A.scalar('SELECT COUNT(*) FROM schueler WHERE nachname=?', ['Import']) === 2, 'Import-Zeilen überleben den fremden Snapshot im Speicher von A');
  A._acquireLock = origLock;
  // Sobald das Lock wieder frei ist, muss der Import nachgeholt werden
  if (typeof A._nachholenBulk === 'function') await A._nachholenBulk();
  await A._pollOplogs();
  await B._pollOplogs();
  check(B.scalar('SELECT COUNT(*) FROM schueler WHERE nachname=?', ['Import']) === 2, 'Import erreicht nach der Nachholung auch B');
}

console.log('\n══ S7: Gelöschtes Log eines zurückkehrenden Clients ══');
{
  const { store, clients: [A, B, C] } = await frisch();
  notiz(A, 'S7-1'); await A.mergeAndSave(true);
  await C._pollOplogs();
  check(await C._compact('s7') === true, 'C kompaktiert (A\'s Log vollständig abgedeckt)');
  await B._pollOplogs();
  const alog = A._myOplogName();
  store.files.delete(alog);                    // Aufräumen nach 3 Tagen Stillstand
  notiz(A, 'S7-2'); await A.mergeAndSave(true); // A kehrt zurück und schreibt
  await B._pollOplogs(); await B._pollOplogs();
  check(hatNotiz(B, 'S7-2'), 'B erhält die neue Op trotz zwischenzeitlich gelöschter Log-Datei');
  check(hatNotiz(B, 'S7-1'), 'B hat die alte Op weiterhin');
}

console.log('\n══ S8: Abgeschnittener Snapshot wird nicht übernommen ══');
{
  const { store, clients: [A] } = await frisch(1);
  notiz(A, 'S8-vorher'); await A.mergeAndSave(true);
  const voll = new Uint8Array(seedBytes);
  const kaputt = voll.slice(0, Math.floor(voll.length * 0.6));   // Schema-Seiten da, Datenseiten fehlen
  const gen = (A._snapGen || 0) + 1;
  store.files.set('test.sqlite', { data: kaputt, mtime: Date.now() });
  store.files.set('snapmeta_test.json', { data: new TextEncoder().encode(JSON.stringify({ gen, by: 'fremd', t: new Date().toISOString(), offsets: {} })), mtime: Date.now() });
  await A._pollOplogs();
  let ok = false;
  try { ok = A.scalar('SELECT COUNT(*) FROM schueler') === 3 && hatNotiz(A, 'S8-vorher'); } catch(e) { ok = false; }
  check(ok, 'Client bleibt nach einem unlesbaren fremden Snapshot voll arbeitsfähig (alter Stand bleibt)');
}

console.log('\n══ S10: Stempel reisen mit dem Snapshot (eigener älterer Nachzügler nach Tausch) ══');
{
  const { clients: [A, B, C] } = await frisch();
  kwUpsert(B, 2, 30, 'X');                  // B: älter, aber noch NICHT gespeichert
  await sleep(5);
  kwUpsert(A, 2, 30, 'Y'); await A.mergeAndSave(true);   // A: neuer, gespeichert
  await C._pollOplogs();
  check(await C._compact('s10') === true, 'C kompaktiert mit Y (X ist noch nicht auf der Platte)');
  await B.mergeAndSave(true);               // X landet erst jetzt im Log – hinter C's Lesestand
  await B._pollOplogs(); await B._pollOplogs();
  check(kwCodes(B, 2, 30) === 'Y', `B: Snapshot-Wert Y bleibt gegen den eigenen älteren Nachzügler X (ist ${kwCodes(B, 2, 30)})`);
  await A._pollOplogs(); await C._pollOplogs();
  check(kwCodes(A, 2, 30) === 'Y' && kwCodes(C, 2, 30) === 'Y', 'A und C behalten Y');
  // Neustart von B: Stempel kommen aus dem Snapshot, ältere Log-Ops überschreiben nicht
  const B2 = await makeClient(SQL, (await (async () => { const st = A.dirHandle.store; return st; })()), 'bernd', new Uint8Array(A.dirHandle.store.files.get('test.sqlite').data), { quiet: true, clientId: B._getClientId() });
  check(kwCodes(B2, 2, 30) === 'Y', `Nach Neustart: Bootstrap wendet den älteren Nachzügler nicht über Y an (ist ${kwCodes(B2, 2, 30)})`);
}

console.log('\n══ S9: Stresstest – 3 Clients, Zufallsoperationen, Lesefehler, Kompaktierungen ══');
for (const startSeed of [12345, 777, 4242, 6, 7]) {
  const { store, clients } = await frisch(3, { negativeCacheMs: 5000 });
  let seed = startSeed;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  store.readFail = () => rnd() < 0.08;         // 8 % aller Lesezugriffe scheitern
  let inserts = 0, kompaktierungen = 0;
  for (let runde = 0; runde < 240; runde++) {
    const c = clients[Math.floor(rnd() * 3)];
    const w = rnd();
    if (w < 0.25) { notiz(c, 'N' + (++inserts)); }
    else if (w < 0.45) { kwUpsert(c, 1 + Math.floor(rnd() * 3), 10 + Math.floor(rnd() * 6), 'C' + runde); }
    else if (w < 0.55) { c.run("UPDATE schueler SET telefon=? WHERE id=?", ['T' + runde, 1 + Math.floor(rnd() * 3)]); }
    else if (w < 0.75) { await c.mergeAndSave(true); }
    else if (w < 0.97) { await c._pollOplogs(); }
    else { if (await c._compact('stress')) kompaktierungen++; }
  }
  store.readFail = () => false;
  for (let i = 0; i < 3; i++) for (const c of clients) { await c.mergeAndSave(true); await c._pollOplogs(); }
  for (let i = 0; i < 3; i++) for (const c of clients) await c._pollOplogs();
  console.log(`  · Seed ${startSeed}: ${inserts} Einfügungen, ${kompaktierungen} Kompaktierungen, ${store.writes} Schreib-/${store.reads} Lesezugriffe`);
  const dump = (c) => JSON.stringify({
    notizen: c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen'),
    kw: c.query('SELECT schueler_id s, kalenderwoche k, maengel_codes m FROM kw_status ORDER BY s, k'),
    tel: c.query('SELECT id, telefon FROM schueler ORDER BY id'),
  });
  const d = clients.map(dump);
  check(clients.every(c => c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen') === inserts), `Keine Einfügung verloren (${inserts} bei allen Clients: ${clients.map(c => c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen')).join('/')})`);
  check(d[0] === d[1] && d[1] === d[2], 'Alle drei Clients konvergieren auf denselben Stand (kw_status, Stammdaten)');
  if (d[0] !== d[1] || d[1] !== d[2]) { console.log('   A:', d[0].slice(0, 300)); console.log('   B:', d[1].slice(0, 300)); console.log('   C:', d[2].slice(0, 300)); }
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
