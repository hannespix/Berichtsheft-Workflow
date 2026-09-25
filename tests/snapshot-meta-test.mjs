// ═══════════════════════════════════════════════════════════════════
//  Audit-Befunde Leseweg: (1) Offsets/Generation stehen IN der Snapshot-Datei
//  (bhk_meta) – eine ältere Datei mit neuerem snapmeta.json (Start-Rennen,
//  gleichnamige Kopie, Windows-Zwischenspeicher) erzeugt keine Lücke mehr;
//  (2) _handlesNeuHolen/_dbDateiHandle suchen nur im Ordner, aus dem die
//  Datenbank geladen wurde (keine gleichnamige Kopie im Hauptordner);
//  (3) Warnung bei gleichnamiger Kopie; (4) _paramIndexForColumn zählt
//  Platzhalter in Subselects (Azubi-Zuordnung von Wiedervorlagen/Snapshots);
//  (5) Termin-Ops frischen die Terminzeile auf, Tippen verwirft Refresh nicht.
//  Ausführen:  node tests/snapshot-meta-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeStore, getSQL, makeSeed, makeClient, makeChecker, FakeDir, ROOT } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL, "UPDATE schueler SET ausbildungsbeginn='2024-09-01', ausbildungsende='2027-08-31'");
let T = Date.parse('2026-09-24T09:00:00');
const store = makeStore(); store.now = () => T;
const tick = (ms = 1000) => { T += ms; };
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
const mk = (name, id, opts = {}) => makeClient(SQL, store, name, new Uint8Array(store.files.get('test.sqlite').data), { quiet: true, clientId: id, ...opts });
const sync = async (...cs) => { for (const c of cs) { tick(); await c.mergeAndSave(true); } for (let i = 0; i < 2; i++) for (const c of cs) { tick(); await c._pollOplogs(); } };
const notiz = (c, text) => c.run('INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)', [1, text, 'T']);
const hat = (c, text) => c.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz=?', [text]) === 1;
const metaExtern = () => JSON.parse(new TextDecoder().decode(store.files.get('snapmeta_test.json').data));

console.log('══ Offsets und Generation stehen in der Snapshot-Datei ══');
let pix = await mk('Pix', 'pix');
let zilz = await mk('Zilz', 'zilz');
{
  notiz(pix, 'P1'); tick(); notiz(zilz, 'Z1'); await sync(pix, zilz);
  tick(60000); check(await pix._compact('test') === true, 'Pix kompaktiert (Generation 1)');
  const intern = pix._snapshotMetaIntern();
  const extern = metaExtern();
  check(intern && intern.gen === 1 && extern.gen === 1 && JSON.stringify(intern.offsets) === JSON.stringify(extern.offsets) && intern.by === 'pix', `bhk_meta in der Datei = snapmeta.json (Generation ${intern && intern.gen}, ${Object.keys(intern ? intern.offsets : {}).length} Offsets)`);
  // Datei von der Platte laden: trägt bhk_meta
  const db2 = new SQL.Database(new Uint8Array(store.files.get('test.sqlite').data));
  const r = db2.exec("SELECT v FROM bhk_meta WHERE k='snapmeta'"); db2.close();
  check(r.length && JSON.parse(r[0].values[0][0]).gen === 1, 'Geschriebene Snapshot-Datei enthält bhk_meta');
}

console.log('\n══ Ältere Datei + neueres snapmeta: keine Lücke mehr (Start) ══');
{
  const alteDatei = new Uint8Array(store.files.get('test.sqlite').data); // Stand Generation 1
  tick(60000); notiz(zilz, 'Z2'); tick(); notiz(pix, 'P2'); await sync(zilz, pix);
  tick(1800000); check(await pix._compact('test') === true && metaExtern().gen === 2, 'Pix kompaktiert erneut (Generation 2)');
  // Windows-Zwischenspeicher / Kopie: die Datei bleibt auf Generation 1, snapmeta sagt 2
  store.files.set('test.sqlite', { data: alteDatei, mtime: T });
  tick(60000);
  const neu = await mk('Neu', 'neu');
  check(hat(neu, 'Z2') && hat(neu, 'P2') && hat(neu, 'Z1') && hat(neu, 'P1'), 'Start mit älterer Datei: alle Ops seit Generation 1 nachgelesen (nichts übersprungen)');
  check(neu._snapGen === 2, `Generation aus snapmeta übernommen (${neu._snapGen}) – kein Nachlade-Kreisel`);
  // Vergleich: ohne bhk_meta (alter Snapshot) gilt weiter snapmeta.json
  const db3 = new SQL.Database(alteDatei); db3.run("DROP TABLE IF EXISTS bhk_meta"); const ohne = db3.export(); db3.close();
  store.files.set('test.sqlite', { data: new Uint8Array(ohne), mtime: T });
  const alt = await mk('Alt', 'alt');
  check(alt._snapGen === 2 && !hat(alt, 'Z2'), 'Alter Snapshot ohne bhk_meta: Verhalten wie bisher (snapmeta.json-Offsets)');
  // Datei wieder auf den echten Stand (Generation 2) bringen: Pix kompaktiert erneut
  store.files.set('test.sqlite', { data: alteDatei, mtime: T });
  tick(1800000); await pix._compact('test');
}

console.log('\n══ Ältere Datei + neueres snapmeta: keine Lücke beim Snapshot-Tausch ══');
{
  const gen2Datei = new Uint8Array(store.files.get('test.sqlite').data);
  tick(60000); notiz(pix, 'P3'); await sync(pix, zilz);
  check(hat(zilz, 'P3'), 'Zilz hat P3 über das Protokoll');
  // Pix kompaktiert (Generation 4), aber Zilz’ Rechner sieht noch die Datei der Generation 3
  tick(1800000); const vorGen = metaExtern().gen; await pix._compact('test');
  const neueMeta = metaExtern();
  check(neueMeta.gen === vorGen + 1, `Neue Generation ${neueMeta.gen}`);
  store.files.set('test.sqlite', { data: gen2Datei, mtime: T });
  tick(); notiz(pix, 'P4'); tick(); await pix.mergeAndSave(true);
  tick(); await zilz._pollOplogs();
  check(hat(zilz, 'P3') && hat(zilz, 'P4') && hat(zilz, 'Z2'), 'Tausch auf ältere Datei: Ops zwischen Datei- und Meta-Stand bleiben erhalten');
  check(zilz._snapGen === neueMeta.gen, `Generation ${zilz._snapGen} übernommen`);
  store.files.set('test.sqlite', { data: gen2Datei, mtime: T });
}

console.log('\n══ Gleichnamige Kopie im Hauptordner: nie stiller Dateiwechsel ══');
{
  const rootStore = makeStore(); rootStore.now = () => T;
  const kopie = new Uint8Array(seedBytes); // uralte Kopie im Hauptordner
  rootStore.files.set('test.sqlite', { data: kopie, mtime: T - 30 * 86400000 });
  const c = await mk('Kopie', 'kopie', { skipBootstrap: true });
  // Hauptordner mit echten Unterordnern: _bhk und Datenbanken liegen im gemeinsamen Store
  const root = new FakeDir(rootStore); root.name = 'Haupt';
  root.getDirectoryHandle = async (n) => (n === 'Datenbanken' || n === '_bhk' || n === 'backups') ? new FakeDir(store) : root;
  c.dirHandle = root; c.dbDirHandle = new FakeDir(store); c.bhkDirHandle = new FakeDir(store);
  c._dbSubDir = 'Datenbanken';
  const echt = store.files.get('test.sqlite').data.length;
  check(echt !== kopie.length, 'Vorbedingung: Kopie und echte Datei unterscheiden sich');
  const ok = await c._handlesNeuHolen();
  check(ok && (await c.dbFileHandle.getFile()).size === echt, 'Nach dem Neuholen zeigt der Zugriffspunkt auf Datenbanken/, nicht auf die Kopie im Hauptordner');
  const h = await c._dbDateiHandle('test.sqlite');
  check((await h.getFile()).size === echt, '_dbDateiHandle ebenso');
  // Umgekehrt: Datenbank aus dem Hauptordner geladen → nur dort suchen
  c._dbSubDir = '';
  await c._handlesNeuHolen();
  check((await c.dbFileHandle.getFile()).size === kopie.length, 'Aus dem Hauptordner geladen: nur der Hauptordner');
  // Ohne Wissen (alter Stand): Datenbanken/ zuerst
  c._dbSubDir = undefined; c._leitDb = null;
  await c._handlesNeuHolen();
  check((await c.dbFileHandle.getFile()).size === echt, 'Ohne Wissen: Datenbanken/ vor Hauptordner');
  // Warnung bei gleichnamiger Kopie
  c._dbSubDir = 'Datenbanken'; c.autoLoadedDbName = 'test.sqlite';
  const meld = []; c.toast = (m, t, d) => meld.push({ m, t, d });
  const d = await c._doppelkopiePruefen();
  check(d && d.ordner === 'Hauptordner' && meld.some(x => x.t === 'warning' && /auch im Hauptordner/.test(x.m) && x.d >= 15000), 'Gleichnamige Kopie wird gemeldet');
  rootStore.files.delete('test.sqlite');
  check((await c._doppelkopiePruefen()) === null, 'Ohne Kopie keine Meldung');
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  check(!/for \(const d of \[this\.dirHandle, this\.dbDirHandle\]\)/.test(A) && /_dbOrdnerKandidaten\(\)/.test(A), 'Kein Suchlauf „Hauptordner zuerst“ mehr');
}

console.log('\n══ Platzhalter in Subselects zählen (Azubi-Zuordnung) ══');
{
  const c = await mk('Sub', 'sub');
  c.run('INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,durchsicht_nr) VALUES (?,?,?,?)', [77, 2, '{}', 1]);
  const keId = c.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  c.run('INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum) VALUES (?,?,?,?)', [keId, 2, 'post', '2026-10-15']);
  const op = c._dirtyOps.slice(-3).find(o => /INSERT INTO wiedervorlagen/.test(o.sql));
  check(op && /\(SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=\? AND schueler_id=\?\)/.test(op.sql), 'Replay-Op trägt den Subselect');
  check(op.sid === 2 && c._azubiAusOp(op.sql, op.params) === 2 && c._paramIndexForColumn(op.sql, 'schueler_id') === 3, `Azubi-Kennung der Op = 2 (nicht Termin 77): sid ${op.sid}, Index ${c._paramIndexForColumn(op.sql, 'schueler_id')}`);
  check(c._ungesichertAzubis.has(2) && !c._ungesichertAzubis.has(77), 'Speicherstatus merkt den richtigen Azubi');
  c.run(`INSERT INTO durchsicht_snapshots (kontrollergebnis_id, schueler_id, snapshot_datum, kw_daten_json, geprueft_kws_json, pflichtteile_json, ergebnis, bemerkung, pruefer) VALUES (?,?,?,?,?,?,?,?,?)`, [keId, 2, '2026-09-24', '{}', '{}', '{}', '', '', 'T']);
  const op2 = c._dirtyOps.slice(-3).find(o => /INSERT INTO durchsicht_snapshots/.test(o.sql));
  check(op2 && op2.sid === 2, 'Archiv-Snapshot ebenso');
}

console.log('\n══ Termin-Ops frischen die Terminzeile auf, Tippen verwirft nichts ══');
{
  const c = await mk('UI', 'ui', { keepSmartRefresh: true });
  let zeile = 0, gezeichnet = 0;
  c._sandbox.KontrolleHandler = { activePruefer: 'UI', _viewMode: 'einzeln', currentTerminId: 77, currentSchuelerList: [{ id: 1, nachname: 'M', vorname: 'M' }], currentIndex: 0, _terminZeileAuffrischen() { zeile++; }, renderSchueler() { gezeichnet++; }, _updateQuickNavStatus() {}, _updateAnderePrueferBar() {} };
  c.currentView = 'kontrolle';
  c.updateBadges = () => {};
  c._merkeBetroffenenAzubi("UPDATE kontrolltermine SET status='durchgefuehrt', durchgefuehrt_datum=? WHERE id=?", ['2026-09-24', 77]);
  c._merkeBetroffenenAzubi('UPDATE kw_status SET geprueft=1 WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [1, 2, 40]);
  check(c._betroffeneTermine && c._betroffeneTermine.has(77) && c._betroffeneAzubis.has(1), 'Termin 77 und Azubi 1 gemerkt');
  // Beim Tippen: nichts zeichnen, aber auch nichts vergessen
  c._sandbox.document.activeElement = { tagName: 'TEXTAREA' };
  c._smartRefresh();
  check(gezeichnet === 0 && zeile === 1 && c._betroffeneAzubis.has(1) && c._betroffeneTermine.has(77), 'Beim Tippen: Terminzeile ja, Raster nein, Merkliste bleibt');
  c._sandbox.document.activeElement = null;
  c._smartRefresh();
  check(gezeichnet === 1 && zeile === 2 && !c._betroffeneAzubis.size && !c._betroffeneTermine.size, 'Ohne Tippen: nachgezeichnet und Merkliste geleert');
  const K = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
  check(/_terminZeileAuffrischen\(\) \{/.test(K), 'KontrolleHandler._terminZeileAuffrischen vorhanden');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
