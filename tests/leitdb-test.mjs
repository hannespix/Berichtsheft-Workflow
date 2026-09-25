// ═══════════════════════════════════════════════════════════════════
//  Gemeinsame Datenbank je Ordner (Leitdatenbank): _bhk/datenbank.json
//  entscheidet, welche Datei alle öffnen – nicht mehr die Erinnerung des
//  einzelnen Browsers (Feldfall: zwei Kollegen im selben Ordner auf zwei
//  Dateien). Erste Datei setzt den Marker, Auswahl setzt ihn, andere Datei
//  nur nach Rückfrage und mit Warnung, Wechsel-Knopf, ungültiger Marker.
//  Ausführen:  node tests/leitdb-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeStore, getSQL, makeSeed, makeClient, makeChecker, FakeDir, ROOT } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL);
let T = Date.parse('2026-09-25T09:00:00');
const store = makeStore(); store.now = () => T;
const tick = (ms = 1000) => { T += ms; };
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });

// Client, der nur die Öffnungslogik ausführt (Laden der Datei wird aufgezeichnet)
async function client(name, lastDb) {
  const c = await makeClient(SQL, store, name, new Uint8Array(seedBytes), { quiet: true, clientId: name.toLowerCase(), skipBootstrap: true });
  c.bhkDirHandle = c.dirHandle; c.dbDirHandle = c.dirHandle;
  c._sandbox.esc = (s) => String(s ?? '');
  c.geladen = []; c.meldungen = []; c.modal = '';
  c.loadDatabaseFromHandle = async (fh, sub) => { c.geladen.push(fh.name); c.autoLoadedDbName = fh.name; c._dbSubDir = sub || ''; c.dbFileHandle = fh; if (!c._leitDb) c._leitDb = await c.leitDbLesen(); c._leitPruefen(); };
  c.toast = (m, t, d) => c.meldungen.push({ m, t, d });
  c.openModal = (titel, body) => { c.modal = body; };
  c.closeModal = () => { c.modal = ''; };
  c.promptNewDb = () => { c.neuVerlangt = true; };
  c.currentUser = name;
  if (lastDb) c._sandbox.localStorage.setItem('bhk_lastDb', JSON.stringify({ dbName: lastDb, dbPath: 'Datenbanken' }));
  return c;
}
const marker = () => { const f = store.files.get('datenbank.json'); return f ? JSON.parse(new TextDecoder().decode(f.data)) : null; };
const dbDateien = () => [...store.files.keys()].filter(n => n.endsWith('.sqlite'));

console.log('══ Eine Datei: wird automatisch die gemeinsame ══');
{
  const a = await client('Pix');
  const ok = await a.dbImOrdnerOeffnen('Start');
  check(ok && a.geladen.join() === 'test.sqlite', 'Einzige Datei geöffnet');
  const m = marker();
  check(m && m.name === 'test.sqlite' && m.gesetztVon === 'Pix' && /einzige Datei/.test(m.quelle), `Marker _bhk/datenbank.json gesetzt (${JSON.stringify(m)})`);
  check(a.istLeitDb() === true && a.meldungen.every(x => x.t !== 'warning'), 'Geöffnete Datei ist die gemeinsame – keine Warnung');
}

console.log('\n══ Zweite Datei taucht auf: der Marker gewinnt gegen die Browser-Erinnerung ══');
{
  store.files.set('berichtsheft (1).sqlite', { data: new Uint8Array(seedBytes), mtime: T });
  check(dbDateien().length === 2, 'Zwei Datenbankdateien im Ordner');
  // Zilz’ Browser erinnert sich an die falsche Datei
  const z = await client('Zilz', 'berichtsheft (1).sqlite');
  await z.dbImOrdnerOeffnen('Start');
  check(z.geladen.join() === 'test.sqlite', `Zilz öffnet trotzdem die gemeinsame (${z.geladen.join()})`);
  check(z.meldungen.some(x => x.t === 'info' && /test\.sqlite/.test(x.m) && /berichtsheft \(1\)\.sqlite/.test(x.m)), 'Hinweis nennt beide Dateien');
  check(!z.modal, 'Keine Auswahl nötig');
}

console.log('\n══ Kein Marker, mehrere Dateien: einmal wählen – die Wahl gilt für alle ══');
{
  store.files.delete('datenbank.json');
  const c = await client('Dritte', 'test.sqlite');
  const ok = await c.dbImOrdnerOeffnen('Start');
  check(ok && !c.geladen.length && /noch keine gemeinsame Datenbank festgelegt/.test(c.modal) && /App\.dbAuswahlOeffnen\(0\)/.test(c.modal) && /App\.dbAuswahlOeffnen\(1\)/.test(c.modal), 'Auswahl mit Hinweis, Browser-Erinnerung reicht nicht');
  const i = c._dbChoices.findIndex(f => f.name === 'berichtsheft (1).sqlite');
  await c.dbAuswahlOeffnen(i);
  check(c.geladen.join() === 'berichtsheft (1).sqlite' && marker() && marker().name === 'berichtsheft (1).sqlite' && marker().quelle === 'Auswahl', 'Gewählte Datei geladen und als gemeinsame festgelegt');
  check(c.meldungen.some(x => x.t === 'success' && /gemeinsame Datenbank/.test(x.m)), 'Erfolgsmeldung');
  check(c.istLeitDb() === true, 'Geöffnete = gemeinsame');
}

console.log('\n══ Andere Datei öffnen: Rückfrage, Warnung, Wechsel ══');
{
  const c = await client('Vierte');
  await c.dbImOrdnerOeffnen('Start');
  check(c.geladen.join() === 'berichtsheft (1).sqlite', 'Neuer Rechner öffnet die gemeinsame');
  c.showDbSelection(await c.scanForDatabases());
  check(/★ gemeinsame Datenbank/.test(c.modal) && /nicht die gemeinsame/.test(c.modal) && c._dbChoices[0].name === 'berichtsheft (1).sqlite', 'Auswahl: gemeinsame zuerst und markiert, andere als „nicht die gemeinsame“');
  const j = c._dbChoices.findIndex(f => f.name === 'test.sqlite');
  c._sandbox.confirm = () => false;
  await c.dbAuswahlOeffnen(j);
  check(c.geladen.length === 1, 'Abbrechen: andere Datei nicht geöffnet');
  c._sandbox.confirm = () => true;
  await c.dbAuswahlOeffnen(j);
  check(c.geladen.join() === 'berichtsheft (1).sqlite,test.sqlite' && c.istLeitDb() === false, 'Nach Bestätigung geöffnet, gilt als „nicht die gemeinsame“');
  check(c.meldungen.some(x => x.t === 'warning' && /nicht/.test(x.m) && /berichtsheft \(1\)\.sqlite/.test(x.m) && x.d >= 10000), 'Deutliche Warnung beim Arbeiten auf der anderen Datei');
  check(marker().name === 'berichtsheft (1).sqlite', 'Marker unverändert');
  // Wechsel zur gemeinsamen: schreibt die Erinnerung um und lädt neu
  let neu = 0; c._sandbox.location = { reload() { neu++; } };
  c.sofortSpeichern = async () => true;
  await c.zurLeitDb();
  check(neu === 1 && JSON.parse(c._sandbox.localStorage.getItem('bhk_lastDb')).dbName === 'berichtsheft (1).sqlite', 'Wechsel-Knopf: Neustart mit der gemeinsamen Datei');
  // Diese als gemeinsame festlegen
  c.autoLoadedDbName = 'test.sqlite'; c._dbSubDir = 'Datenbanken';
  c.renderCurrentView = () => {};
  await c.dieseAlsLeitDb();
  check(marker().name === 'test.sqlite' && marker().subDir === 'Datenbanken' && c.istLeitDb() === true, 'Festlegen aus der Wartung schreibt den Marker um');
}

console.log('\n══ Ungültiger Marker (Datei fehlt) ══');
{
  const c = await client('Fuenfte');
  store.files.delete('test.sqlite'); // erst nach makeClient – der Harness legt test.sqlite sonst neu an
  await c.dbImOrdnerOeffnen('Start');
  check(c.geladen.join() === 'berichtsheft (1).sqlite' && marker().name === 'berichtsheft (1).sqlite', 'Marker auf fehlende Datei: einzige vorhandene geöffnet und neu festgelegt');
  check(c.meldungen.some(x => x.t === 'warning' && /nicht mehr im Ordner/.test(x.m)), 'Hinweis auf den ungültigen Marker');
  // Kein Marker, keine Datei → neue anlegen (nur auf Wunsch)
  const d = await client('Sechste');
  store.files.delete('berichtsheft (1).sqlite'); store.files.delete('datenbank.json'); store.files.delete('test.sqlite');
  check((await d.dbImOrdnerOeffnen('Start')) === false && !d.neuVerlangt, 'Ohne Datei: false, keine Neuanlage beim Auto-Start');
  check((await d.dbImOrdnerOeffnen('Start', { neuBeiLeer: true })) === false && d.neuVerlangt === true, 'Mit neuBeiLeer: Neuanlage angeboten');
}

console.log('\n══ Protokolle außerhalb von _bhk und unzugänglicher Ordner (Feldfall: eine Datei, 8 vs. 16 Protokolle) ══');
{
  // Zilz’ Rechner konnte _bhk nicht öffnen und schreibt in den Hauptordner
  const rootStore = makeStore(); rootStore.now = () => T;
  const bhkStore = makeStore(); bhkStore.now = () => T;
  bhkStore.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
  const pix = await makeClient(SQL, bhkStore, 'Pix9', new Uint8Array(seedBytes), { quiet: true, clientId: 'pix9', skipBootstrap: true });
  pix.dirHandle = new FakeDir(rootStore); pix.bhkDirHandle = new FakeDir(bhkStore); pix.dbDirHandle = pix.bhkDirHandle;
  const meld = []; pix.toast = (m, t, d) => meld.push({ m, t, d });
  rootStore.files.set('oplog_test_zilz9_g1.jsonl', { data: new TextEncoder().encode('{"uid":"x","ts":1,"seq":1,"c":"zilz9","sql":"SELECT 1","params":[]}\n'), mtime: T - 3600000 });
  tick(); await pix._bootstrapV3();
  check(pix._protokolleAusserhalb.length === 1 && pix._protokolleAusserhalb[0].name === 'oplog_test_zilz9_g1.jsonl' && pix._protokolleAusserhalb[0].eigeneDb === true, 'Protokoll im Hauptordner erkannt');
  check(meld.some(x => x.t === 'warning' && /Hauptordner/.test(x.m) && /_bhk/.test(x.m) && x.d >= 15000), 'Deutliche Warnung');
  const pr = await pix.azubiPruefen(1);
  check(pr.protokolleAusserhalb.length === 1 && pr.protokolleAusserhalb[0].datei === 'oplog_test_zilz9_g1.jsonl' && pr.bhkFehlt === '', 'bhk.pruefen nennt die Datei außerhalb');
  // Alte Datei (> 7 Tage) ist kein Grund zur Warnung
  rootStore.files.get('oplog_test_zilz9_g1.jsonl').mtime = T - 10 * 86400000;
  const meld2 = []; pix.toast = (m, t, d) => meld2.push({ m, t, d }); pix._ausserhalbGewarnt = false;
  await pix._protokolleAusserhalbPruefen();
  check(pix._protokolleAusserhalb.length === 0 && meld2.length === 0, 'Alte Datei außerhalb: keine Warnung');
  // _bhk lässt sich nicht öffnen → laute Meldung statt stillem Rückfall
  const kaputt = await makeClient(SQL, bhkStore, 'Zilz9', new Uint8Array(seedBytes), { quiet: true, clientId: 'zilz9', skipBootstrap: true });
  const meld3 = []; kaputt.toast = (m, t, d) => meld3.push({ m, t, d });
  kaputt.dirHandle = { name: 'Hauptordner', getDirectoryHandle: async (n) => { if (n === '_bhk') throw new Error('NotAllowedError: keine Rechte'); return new FakeDir(bhkStore); }, async *entries() {}, async *values() {} };
  kaputt.bhkDirHandle = null;
  await kaputt.ensureAppDirs();
  check(/keine Rechte/.test(kaputt._bhkFehlt) && !kaputt.bhkDirHandle && meld3.some(x => x.t === 'error' && /_bhk/.test(x.m) && /NICHT mit den Kollegen geteilt/.test(x.m) && x.d >= 15000), `Unzugängliches _bhk wird laut gemeldet (${kaputt._bhkFehlt})`);
  const pr2 = await kaputt.azubiPruefen(1);
  check(/keine Rechte/.test(pr2.bhkFehlt) && pr2.hauptordner === 'Hauptordner', 'bhk.pruefen nennt den Fehler und den Hauptordner');
  const V = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  const K = fs.readFileSync(path.join(ROOT, 'src/js/modules/konsole.js'), 'utf8');
  check(/App\._bhkFehlt/.test(V) && /App\._protokolleAusserhalb/.test(V) && /r\.bhkFehlt/.test(K) && /r\.protokolleAusserhalb/.test(K) && /r\.ordner !== '_bhk'/.test(K), 'Wartung und Konsole zeigen beide Befunde');
}

console.log('\n══ Arbeitsordner: Kennung, Wechsel, Unterordner mit eigener Datenbank ══');
{
  const storeA = makeStore(); storeA.now = () => T; storeA.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
  const storeB = makeStore(); storeB.now = () => T; storeB.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
  const a = await makeClient(SQL, storeA, 'Pix', new Uint8Array(seedBytes), { quiet: true, clientId: 'pixo', skipBootstrap: true });
  a.bhkDirHandle = a.dirHandle; a.dbDirHandle = a.dirHandle; a.dirHandle.name = 'Berichtsheftkontrolle';
  const m1 = []; a.toast = (m, t, d) => m1.push({ m, t, d });
  const k1 = await a._ordnerKennungPruefen();
  check(k1 && k1.id && storeA.files.has('ordner.json') && JSON.parse(a._sandbox.localStorage.getItem('bhk_ordner')).id === k1.id && m1.length === 0, `Erster Start: Ordner-Kennung angelegt und gemerkt (${k1 && k1.id}), keine Warnung`);
  const k1b = await a._ordnerKennungPruefen();
  check(k1b.id === k1.id && m1.length === 0, 'Gleicher Ordner erneut: dieselbe Kennung, keine Warnung');
  // Derselbe Browser öffnet einen anderen Ordner (Unterordner mit Kopie)
  const b = await makeClient(SQL, storeB, 'Pix', new Uint8Array(seedBytes), { quiet: true, clientId: 'pixo', skipBootstrap: true });
  b.bhkDirHandle = b.dirHandle; b.dbDirHandle = b.dirHandle; b.dirHandle.name = 'Kopie Juni';
  b._sandbox.localStorage.setItem('bhk_ordner', a._sandbox.localStorage.getItem('bhk_ordner'));
  const m2 = []; b.toast = (m, t, d) => m2.push({ m, t, d });
  const k2 = await b._ordnerKennungPruefen();
  check(k2.id !== k1.id && m2.some(x => x.t === 'warning' && /ANDEREN Arbeitsordner/.test(x.m) && /Kopie Juni/.test(x.m) && /Berichtsheftkontrolle/.test(x.m) && x.d >= 15000) && b._ordnerGewechselt && b._ordnerGewechselt.von === 'Berichtsheftkontrolle', 'Anderer Ordner als zuletzt: deutliche Warnung mit beiden Namen');
  // Unterordner mit eigener Datenbank (eine Ebene tief)
  const unter = (name, eintraege) => ({ kind: 'directory', name, async *entries() { for (const e of eintraege) yield e; } });
  const datei = (name) => [name, { kind: 'file', name }];
  const root = { name: 'Berichtsheftkontrolle', async *entries() {
    yield ['_bhk', unter('_bhk', [])]; yield ['Datenbanken', unter('Datenbanken', [datei('test.sqlite')])];
    yield ['Kopie Juni', unter('Kopie Juni', [['Datenbanken', unter('Datenbanken', [datei('test.sqlite')])], ['_bhk', unter('_bhk', [])]])];
    yield ['Alt', unter('Alt', [datei('berichtsheft_alt.sqlite'), datei('notizen.txt')])];
    yield ['Briefe', unter('Briefe', [datei('brief.docx')])];
    yield datei('berichtsheftkontrolle.html');
  } };
  a.dirHandle = root;
  const m3 = []; a.toast = (m, t, d) => m3.push({ m, t, d });
  const funde = await a._unterordnerPruefen();
  check(funde.length === 2 && funde.some(f => f.ordner === 'Kopie Juni' && f.datenbanken && f.bhk) && funde.some(f => f.ordner === 'Alt' && f.sqlite === 1) && !funde.some(f => f.ordner === 'Briefe'), `Unterordner mit Datenbank erkannt: ${funde.map(f => f.ordner).join(', ')}`);
  check(m3.some(x => x.t === 'warning' && /Kopie Juni/.test(x.m) && /Alt/.test(x.m) && /nur EINEN Arbeitsordner/.test(x.m) && x.d >= 15000), 'Warnung nennt die Unterordner');
  // Ohne verdächtige Unterordner keine Warnung
  a.dirHandle = { name: 'Sauber', async *entries() { yield ['_bhk', unter('_bhk', [])]; yield ['Datenbanken', unter('Datenbanken', [datei('test.sqlite')])]; yield ['Briefe', unter('Briefe', [datei('b.docx')])]; } };
  const m4 = []; a.toast = (m) => m4.push(m); a._unterordnerGewarnt = false;
  check((await a._unterordnerPruefen()).length === 0 && m4.length === 0, 'Sauberer Ordner: nichts');
  // Kopfzeile zeigt den Ordner vor der Datei
  const el = { textContent: 'test.sqlite', title: '' };
  a._sandbox.document.getElementById = (id) => id === 'dbFileName' ? el : { textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} } };
  a.autoLoadedDbName = 'test.sqlite';
  a._ordnerAnzeigen(); a._ordnerAnzeigen();
  check(el.textContent === 'Sauber › test.sqlite' && /Arbeitsordner „Sauber“/.test(el.title), `Kopfzeile: „${el.textContent}“ (nicht doppelt)`);
  const V = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check(/Arbeitsordner:/.test(V) && /App\._ordnerGewechselt/.test(V) && /App\._unterordnerMitDb/.test(V), 'Wartung → Verbindung nennt Arbeitsordner, Wechsel und Unterordner');
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  check(/await this\._ordnerKennungPruefen\(\)/.test(A) && /await this\._unterordnerPruefen\(\)/.test(A) && /this\._ordnerAnzeigen\(\)/.test(A), 'Prüfungen laufen beim Laden der Datenbank');
}

console.log('\n══ Unterordner als Arbeitsordner: abweisen, nichts anlegen; Datenbanken/ nicht auf Vorrat ══');
{
  const s = makeStore(); s.now = () => T; s.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
  const c = await makeClient(SQL, s, 'Falsch', new Uint8Array(seedBytes), { quiet: true, clientId: 'falsch', skipBootstrap: true });
  const meld = []; c.toast = (m, t, d) => meld.push({ m, t, d });
  let gespeichert = 'unberührt'; c.storeDirHandle = async (h) => { gespeichert = h; };
  // Ordner heißt „Datenbanken“ – zählt, was angelegt würde
  const angelegt = []; const vorhanden = new Set();
  const nichtDa = () => Object.assign(new Error('nicht da'), { name: 'NotFoundError' });
  const fakeDir = (name) => ({ name, kind: 'directory', async getDirectoryHandle(n, o) { const k = name + '/' + n; if (o && o.create) { angelegt.push(k); vorhanden.add(k); } else if (!vorhanden.has(k)) throw nichtDa(); return fakeDir(n); }, async getFileHandle() { throw nichtDa(); }, async *entries() {}, async *values() {} });
  c.dirHandle = fakeDir('Datenbanken');
  check(!c._ordnerZulaessig(c.dirHandle) && !c._ordnerZulaessig({ name: '_bhk' }) && !c._ordnerZulaessig({ name: 'backups' }) && c._ordnerZulaessig({ name: 'Berichtsheftkontrolle' }), 'Unterordner-Namen erkannt, Hauptordner zulässig');
  await c.ensureAppDirs();
  check(c._ordnerUnzulaessig === 'Datenbanken' && angelegt.length === 0 && !c.bhkDirHandle && !c.dbDirHandle, 'Im Unterordner wird NICHTS angelegt (kein Datenbanken/Datenbanken, kein _bhk)');
  const ok = await c.dbImOrdnerOeffnen('Start');
  check(ok === false && meld.some(x => x.t === 'error' && /Unterordner/.test(x.m) && /Hauptordner/.test(x.m) && x.d >= 15000) && gespeichert === null && !c.dirHandle, 'Öffnen abgewiesen, Ordner nicht gemerkt, Meldung nennt den Hauptordner');
  // Zulässiger Ordner ohne Datenbanken/: wird nicht auf Vorrat angelegt, nur _bhk
  angelegt.length = 0;
  c.dirHandle = fakeDir('Berichtsheftkontrolle');
  await c.ensureAppDirs();
  check(c._ordnerUnzulaessig === '' && angelegt.includes('Berichtsheftkontrolle/_bhk') && !angelegt.includes('Berichtsheftkontrolle/Datenbanken') && c.dbDirHandle === null, 'Hauptordner: _bhk ja, Datenbanken/ nein (nicht vorhanden → null)');
  await c._datenbankenOrdnerAnlegen();
  check(angelegt.includes('Berichtsheftkontrolle/Datenbanken') && c.dbDirHandle && c.dbDirHandle.name === 'Datenbanken', 'Datenbanken/ entsteht erst bei Bedarf (neue Datenbank)');
  // Spuren einer Fehlwahl: Datenbanken/Datenbanken und Datenbanken/_bhk
  const unter = (name, eintraege) => ({ kind: 'directory', name, async *entries() { for (const e of eintraege) yield e; } });
  c.dirHandle = { name: 'Berichtsheftkontrolle', async *entries() { yield ['Datenbanken', unter('Datenbanken', [])]; yield ['_bhk', unter('_bhk', [])]; } };
  c.dbDirHandle = unter('Datenbanken', [['Datenbanken', unter('Datenbanken', [])], ['_bhk', unter('_bhk', [])], ['test.sqlite', { kind: 'file', name: 'test.sqlite' }]]);
  const m2 = []; c.toast = (m, t, d) => m2.push({ m, t, d }); c._unterordnerGewarnt = false;
  const funde = await c._unterordnerPruefen();
  check(funde.length === 2 && funde.every(f => f.verirrt) && funde.some(f => f.ordner === 'Datenbanken/Datenbanken') && funde.some(f => f.ordner === 'Datenbanken/_bhk'), `Verirrte Unterordner in Datenbanken/ erkannt (${funde.map(f => f.ordner).join(', ')})`);
  check(m2.some(x => x.t === 'warning' && /Verirrte Unterordner/.test(x.m) && /selbst als Arbeitsordner/.test(x.m)), 'Warnung erklärt die Fehlwahl');
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  check(!/getDirectoryHandle\('Datenbanken', \{ create: true \}\)/.test(A.replace(/_datenbankenOrdnerAnlegen\(\) \{[\s\S]*?\n  \},/, '')), 'Datenbanken/ wird nur in _datenbankenOrdnerAnlegen angelegt');
}

console.log('\n══ Verdrahtung ══');
{
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  const n = (A.match(/await this\.dbImOrdnerOeffnen\(/g) || []).length;
  check(n >= 4, `Alle Einstiege (Start, Wiederverbinden, Auto-Start, Ordnerwechsel) laufen über dbImOrdnerOeffnen (${n})`);
  check(!/const lastDb = this\.restoreLastDb\(\);\s*if \(lastDb && lastDb\.dbName\) \{\s*try \{\s*const targetDir/.test(A), 'Kein direktes Öffnen der Browser-Erinnerung mehr');
  check(/App\.dbAuswahlOeffnen\(\$\{i\}\)/.test(A) && /LEIT_DATEI: 'datenbank\.json'/.test(A), 'Auswahl über dbAuswahlOeffnen, Marker-Datei');
  const V = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check(/Gemeinsame Datenbank dieses Ordners/.test(V) && /App\.zurLeitDb\(\)/.test(V) && /App\.dieseAlsLeitDb\(\)/.test(V), 'Wartung → Verbindung: Stand, Wechsel-Knopf, Festlegen-Knopf');
  const K = fs.readFileSync(path.join(ROOT, 'src/js/modules/konsole.js'), 'utf8');
  check(/Gemeinsame Datenbank dieses Ordners/.test(K), 'bhk.pruefen nennt die gemeinsame Datenbank');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
