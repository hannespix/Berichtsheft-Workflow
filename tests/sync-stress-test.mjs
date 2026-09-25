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

async function frisch(n = 3, storeOpts = {}, clientOpts = () => ({})) {
  const store = Object.assign(makeStore(), storeOpts);
  store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
  const namen = ['anna', 'bernd', 'clara'];
  const clients = [];
  for (let i = 0; i < n; i++) clients.push(await makeClient(SQL, store, namen[i], new Uint8Array(seedBytes), { quiet: true, ...clientOpts(i) }));
  return { store, clients };
}
// Deterministischer Zufall (mulberry32) – je Client eine eigene Folge. Der frühere
// LCG (seed × 1103515245 & 0x7fffffff) verlor in JavaScript oberhalb 2^53 die
// unteren Bits und lief in kurze Zyklen: als er Math.random der Clients stellte,
// wiederholten sich die uids der Ops und die uid-Entdopplung verwarf echte Ops.
const lcg = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
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

console.log('\n══ S9: Stresstest – 3 Clients, Zufallsoperationen, Lesefehler, Kompaktierungen, virtuelle Uhr ══');
// Virtuelle Uhr: Laufwerk (Negativ-Cache, mtime) und App (Date.now, Stempel,
// Kennungen) laufen auf derselben, vom Test vorgerückten Zeit; Math.random je
// Client aus einer eigenen Folge. So ist jeder Seed exakt wiederholbar – vorher
// hing die Zufallsfolge (Lesefehler je Zugriff) an der echten Uhr, und ein
// Verlust trat nur in jedem vierten Lauf auf. Die Uhr rückt nur bei Netz-
// zugriffen vor: Bedienschritte ohne Netz liegen in derselben Millisekunde,
// wie eine Terminanlage mit vielen Zeilen oder zwei Rechner im selben Moment.
for (const startSeed of [12345, 777, 4242, 6, 7, 99]) {
  let t = Date.parse('2026-05-04T08:00:00Z');
  const { store, clients } = await frisch(3, { negativeCacheMs: 5000, now: () => t }, (i) => ({ random: lcg(startSeed * 7 + i) }));
  const rnd = lcg(startSeed);
  store.readFail = () => rnd() < 0.08;         // 8 % aller Lesezugriffe scheitern
  let inserts = 0, kompaktierungen = 0, sammel = 0;
  for (let runde = 0; runde < 240; runde++) {
    const c = clients[Math.floor(rnd() * 3)];
    const w = rnd();
    if (w < 0.22) { notiz(c, 'N' + (++inserts)); }
    else if (w < 0.25) { sammel++; for (let k = 0; k < 40; k++) notiz(c, 'N' + (++inserts)); } // Sammelanlage: 40 Zeilen in einer Millisekunde
    else if (w < 0.45) { kwUpsert(c, 1 + Math.floor(rnd() * 3), 10 + Math.floor(rnd() * 6), 'C' + runde); }
    else if (w < 0.55) { c.run("UPDATE schueler SET telefon=? WHERE id=?", ['T' + runde, 1 + Math.floor(rnd() * 3)]); }
    else {
      t += 30 + Math.floor(rnd() * 270);        // Netzzugriff: 30–300 ms vergehen
      if (rnd() < 0.05) t += 6000;              // gelegentlich eine Denkpause (Negativ-Cache läuft ab)
      if (w < 0.75) { await c.mergeAndSave(true); }
      else if (w < 0.97) { await c._pollOplogs(); }
      else { if (await c._compact('stress')) kompaktierungen++; }
    }
  }
  store.readFail = () => false;
  for (let i = 0; i < 3; i++) for (const c of clients) { t += 100; await c.mergeAndSave(true); await c._pollOplogs(); }
  for (let i = 0; i < 3; i++) for (const c of clients) { t += 100; await c._pollOplogs(); }
  console.log(`  · Seed ${startSeed}: ${inserts} Einfügungen (${sammel} Sammelanlagen), ${kompaktierungen} Kompaktierungen, ${store.writes} Schreib-/${store.reads} Lesezugriffe`);
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

console.log('\n══ S10: Kennungen zweier Rechner im selben Moment (Sammelanlage) ══');
{
  // Vorher: Millisekunde × 1000 + Zufall 0…999. A legt 600 Zeilen in einer
  // Millisekunde an (fortlaufend ab seinem Zufallswert), B eine Zeile in
  // derselben Millisekunde mit fast demselben Zufallswert → gleiche Nummer,
  // B's Zeile scheiterte bei A und C still an UNIQUE. Jetzt: Sekunde × 2 Mio.
  let t = Date.parse('2026-05-04T09:00:00Z');
  const { clients: [A, B, C] } = await frisch(3, { now: () => t }, (i) => ({ random: () => [0.1, 0.1004, 0.5][i] }));
  // Zufall ist je Client konstant (nur für newId gedacht) – uids deshalb aus einem Zähler
  let uidZaehler = 0;
  [A, B, C].forEach((c, i) => { c._newUid = () => `u${i}-${++uidZaehler}`; });
  for (let k = 0; k < 600; k++) notiz(A, 'S10-A' + k);
  notiz(B, 'S10-B');
  const idsA = A.query('SELECT id FROM wiedervorlage_notizen').map(r => r.id);
  const idB = B.scalar("SELECT id FROM wiedervorlage_notizen WHERE notiz='S10-B'");
  check(idsA.length === 600 && new Set(idsA).size === 600 && !idsA.includes(idB), `600 fortlaufende Nummern von A und B's Nummer sind verschieden (A ab ${idsA[0]}, B ${idB})`);
  check(idB > 1e15 && idB < 2 ** 53 && idsA[599] < 2 ** 53, 'Nummern bleiben ganzzahlig exakt (unter 2^53)');
  check(App_newIdMonoton(A), 'Nummern eines Clients steigen streng monoton');
  // 600 Ops übersteigen APPEND_MAX_BYTES – wie die App hängt der Test in Häppchen an,
  // bis der Puffer leer ist (der nächste Auto-Save folgt im Betrieb sofort)
  t += 200; for (let i = 0; i < 10 && A._dirtyOps.length; i++) { await A.mergeAndSave(true); t += 50; }
  await B.mergeAndSave(true);
  check(A._dirtyOps.length === 0, 'A hat alle 600 Ops in Häppchen angehängt');
  t += 200; for (const c of [A, B, C]) await c._pollOplogs();
  check([A, B, C].every(c => c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen') === 601), `Alle drei haben 601 Zeilen (${[A, B, C].map(c => c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen')).join('/')})`);
  check([A, B, C].every(c => hatNotiz(c, 'S10-B')), 'B\'s Zeile aus dem gemeinsamen Moment fehlt nirgends');
}
function App_newIdMonoton(app) { const a = app.newId(), b = app.newId(), c = app.newId(); return a < b && b < c; }

console.log('\n══ S11: Größe des eigenen Protokolls nicht lesbar → kein Anhängen an Byte 0 ══');
{
  // Vorher: getFile() scheiterte → Größe 0 → das Anhängen überschrieb den Anfang
  // der eigenen Datei; diese Ops las kein Kollege (alle standen schon dahinter).
  const { store, clients: [A, B] } = await frisch(2);
  notiz(A, 'S11-1'); await A.mergeAndSave(true);
  await B._pollOplogs();
  const mine = A._myOplogName();
  const vorher = store.files.get(mine).data.length;
  const echtesGetFile = Object.getPrototypeOf(A.dbFileHandle).getFile;
  // Nur der eigene Protokoll-Zugriff scheitert (wie Chromes NotReadableError auf SMB)
  Object.getPrototypeOf(A.dbFileHandle).getFile = async function () { if (this.name === mine) { const e = new Error('The requested file could not be read'); e.name = 'NotReadableError'; throw e; } return echtesGetFile.call(this); };
  notiz(A, 'S11-2'); await A.mergeAndSave(true);
  Object.getPrototypeOf(A.dbFileHandle).getFile = echtesGetFile;
  check(store.files.get(mine).data.length === vorher, 'Eigenes Protokoll unverändert (nichts an Byte 0 geschrieben)');
  check(A._dirtyOps.some(o => (o.params || []).includes('S11-2')), 'Die Op bleibt im Puffer');
  await A.mergeAndSave(true);
  await B._pollOplogs();
  check(hatNotiz(B, 'S11-1') && hatNotiz(B, 'S11-2'), 'Nach dem nächsten Anlauf hat B beide Zeilen');
}

console.log('\n══ S12: Kontrolltag zu dritt – 60 Azubis, 52 Wochen, Speicher und Konvergenz ══');
{
  // Drei Prüfer arbeiten denselben Termin gleichzeitig ab (je 20 Azubis, je Azubi
  // 52 Wochen + Ergebnis + Wiedervorlage ≈ 3.400 Ops je Client), speichern nach
  // jedem Azubi, gleichen ab, einer kompaktiert zwischendurch. Geprüft wird, was
  // im Feld zählt: derselbe Stand bei allen, keine Zeile verloren, und die
  // Speicherstrukturen wachsen nicht über ihre Deckel (uid-Menge, Stempel,
  // Protokollgrößen, Heap).
  const extra = Array.from({ length: 57 }, (_, i) => `(${i + 4},'Azubi${i + 4}','V',1)`).join(',');
  const seed60 = makeSeed(SQL, `INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES ${extra}; INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (78,'2026-07-02','geplant')`);
  let t = Date.parse('2026-07-02T08:00:00Z');
  const store = Object.assign(makeStore(), { negativeCacheMs: 5000, now: () => t });
  store.files.set('test.sqlite', { data: new Uint8Array(seed60), mtime: t });
  const clients = [];
  for (let i = 0; i < 3; i++) clients.push(await makeClient(SQL, store, ['anna', 'bernd', 'clara'][i], new Uint8Array(seed60), { quiet: true, random: lcg(4711 + i) }));
  const rnd = lcg(4711);
  store.readFail = () => rnd() < 0.05;
  if (global.gc) global.gc();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  let ops = 0, kompakt = 0;
  for (let a = 0; a < 20; a++) {
    for (let ci = 0; ci < 3; ci++) {
      const c = clients[ci], sid = 1 + a + ci * 20;
      c.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [78, sid, '{}']); ops++;
      for (let kw = 1; kw <= 52; kw++) { kwUpsert(c, sid, kw, kw % 7 === 0 ? 'A1' : ''); ops++; }
      c.run("UPDATE kontrollergebnisse SET ergebnis=? WHERE kontrolltermin_id=? AND schueler_id=?", ['in_ordnung', 78, sid]); ops++;
      c.run("INSERT INTO wiedervorlagen (kontrollergebnis_id,schueler_id,art,frist_datum) VALUES ((SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=78 AND schueler_id=?),?,?,?)", [sid, sid, 'nachreichen', '2026-08-01']); ops++;
      t += 40000 + Math.floor(rnd() * 20000);   // ein Azubi dauert eine knappe Minute
      await c.mergeAndSave(true);                // microSave beim Azubi-Wechsel
      await c._pollOplogs();
    }
    if (a === 9) { t += 1000; if (await clients[0]._compact('stress')) kompakt++; }
  }
  store.readFail = () => false;
  for (let i = 0; i < 3; i++) for (const c of clients) { t += 500; await c.mergeAndSave(true); await c._pollOplogs(); }
  t += 1000; if (await clients[2]._compact('stress')) kompakt++;
  for (let i = 0; i < 2; i++) for (const c of clients) { t += 500; await c._pollOplogs(); }
  const dauer = Date.now() - t0;
  if (global.gc) global.gc();
  const heapMB = (process.memoryUsage().heapUsed - heap0) / 1048576;
  const dump = (c) => JSON.stringify({
    ke: c.query('SELECT schueler_id s, ergebnis e FROM kontrollergebnisse WHERE kontrolltermin_id=78 ORDER BY s'),
    kw: c.scalar('SELECT COUNT(*) FROM kw_status'), a1: c.scalar("SELECT COUNT(*) FROM kw_status WHERE maengel_codes='A1'"),
    wv: c.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id BETWEEN 1 AND 60'),
  });
  const d = clients.map(dump);
  const logBytes = [...store.files.entries()].filter(([n]) => n.endsWith('.jsonl')).reduce((s, [, f]) => s + f.data.length, 0);
  console.log(`  · ${ops} Ops, ${kompakt} Kompaktierungen, ${store.writes} Schreib-/${store.reads} Lesezugriffe, Protokolle ${Math.round(logBytes / 1024)} KB, ${dauer} ms, Heap +${heapMB.toFixed(0)} MB`);
  check(d[0] === d[1] && d[1] === d[2], 'Alle drei Prüfer sehen denselben Kontrolltag (Ergebnisse, Wochen, Wiedervorlagen)');
  check(clients[0].scalar('SELECT COUNT(*) FROM kw_status') === 60 * 52, `Alle ${60 * 52} Wochen da (${clients[0].scalar('SELECT COUNT(*) FROM kw_status')})`);
  check(clients[0].scalar("SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=78 AND ergebnis='in_ordnung'") === 60, 'Alle 60 Ergebnisse da');
  check(clients[0].scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id BETWEEN 1 AND 60') === 60, 'Alle 60 Wiedervorlagen da (keine verloren, keine doppelt)');
  check(kompakt === 2, `Beide Kompaktierungen gelungen (${kompakt})`);
  check(clients.every(c => c._appliedForeignUids.size <= ops), `uid-Menge bleibt unter der Op-Zahl (${clients.map(c => c._appliedForeignUids.size).join('/')})`);
  check(clients.every(c => (c._rowStamps ? c._rowStamps.size : 0) <= c.STAMPS_MAX * 2), `Stempel bleiben unter dem Deckel (${clients.map(c => c._rowStamps ? c._rowStamps.size : 0).join('/')})`);
  check(clients.every(c => c._dirtyOps.length === 0 && !c._appendHaengt), 'Nichts hängt, nichts wartet');
  check(heapMB < 150, `Heap-Zuwachs unter 150 MB (${heapMB.toFixed(0)} MB)`);
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
