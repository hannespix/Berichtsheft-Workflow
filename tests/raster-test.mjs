// ═══════════════════════════════════════════════════════════════════
//  KW-Raster ab dem Ausbildungsbeginn: Zeilen = Lehrjahre. Das erste beginnt
//  mit der Kalenderwoche des Beginns laut Stammdaten (1.8. → KW 31, die
//  Augustwochen stehen VOR dem ersten Schuljahr), jedes weitere mit KW 36,
//  das letzte endet mit der Woche des Vertragsendes.
//  Gespeicherte Kennungen (ausbildungsjahr, kalenderwoche) bleiben unverändert.
//  Ausführen:  node tests/raster-test.mjs
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

let ok = 0, fehler = 0;
const check = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text); } else { fehler++; console.log('  ✗ FEHLER: ' + text); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { push() {}, clear() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const App = sandbox.__App, KWNav = sandbox.KWNav, KontrolleHandler = sandbox.KontrolleHandler;
App.db = db; App.demoMode = true; App.markDirty = () => {}; App.toast = () => {};

let nextId = 100;
const azubi = (name, von, bis, dauer, verk) => {
  const id = ++nextId;
  db.run('INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende,regulaer_dauer_monate,verkuerzung_monate) VALUES (?,?,?,1,?,?,?,?)', [id, name, 'X', von, bis, dauer || 36, verk || 0]);
  return id;
};
const kurz = (id) => App.rasterInfo(id).jahre.map(j => `${j.nr}:${j.zellen[0].aj}/${j.zellen[0].kw}…${j.zellen[j.zellen.length - 1].aj}/${j.zellen[j.zellen.length - 1].kw}(${j.zellen.length})`).join(' ');

console.log('\n══ Beginn 1.9. (KW 36): Zeilen = Schuljahres-Raster, alles wie bisher ══');
{
  const a = azubi('Sep25', '2025-09-01', '2028-08-31');
  const info = App.rasterInfo(a);
  check(info.einfach && info.jahre.length === 3, `drei Jahre, einfach (${kurz(a)})`);
  check(info.jahre.every((j, i) => j.nr === i + 1 && j.zellen.length === 52 && j.zellen[0].kw === 36 && j.zellen[51].kw === 35 && j.zellen.every(z => z.aj === j.nr && z.aktiv)), 'jede Zeile KW 36…35, Kennung = Zeile, alle Wochen aktiv');
  check(App.rasterJahrLabel(a, info.jahre[1]).titel === 'Schuljahr 2026/27' && App.rasterJahrLabel(a, info.jahre[1]).zusatz === '2. Lehrjahr', 'Kopf wie bisher: Schuljahr 2026/27 · 2. Lehrjahr');
  check(App.calcArbeitstage('2025-09-01', '2028-08-31', a) === 156 * 5 - 33, `Arbeitstage unverändert (${App.calcArbeitstage('2025-09-01', '2028-08-31', a)})`);
  const b = azubi('Sep24-Sonntag', '2024-09-01', '2027-08-31');
  check(App.rasterInfo(b).einfach && App.rasterInfo(b).start.kw === 36, 'Beginn Sonntag 1.9.2024 → folgende Woche KW 36');
}

console.log('\n══ Beginn 1.8.2025: Raster beginnt mit KW 31 ══');
let aug;
{
  aug = azubi('Aug25', '2025-08-01', '2028-07-31');
  const info = App.rasterInfo(aug);
  check(JSON.stringify(App.getSchuelerAJs(aug)) === '[1,2,3]', 'Schuljahres-Raster bleiben [1,2,3] (keine Umnummerierung)');
  check(info.start.aj === 0 && info.start.kw === 31 && !info.einfach, `Start in KW 31, Raster vor dem ersten (${JSON.stringify(info.start)})`);
  check(info.jahre.length === 3 && info.jahre.map(j => j.nr).join() === '1,2,3', `drei Ausbildungsjahre (${kurz(aug)})`);
  const j1 = info.jahre[0].zellen;
  check(j1.slice(0, 6).map(z => `${z.aj}/${z.kw}`).join(' ') === '0/31 0/32 0/33 0/34 0/35 1/36', 'Jahr 1: KW 31–35 im Raster 0, ab KW 36 Raster 1');
  check(j1.length === 57 && j1[56].aj === 1 && j1[56].kw === 35, `1. Lehrjahr: fünf Augustwochen davor + ganzes Schuljahr bis KW 35 (${j1.length} Wochen)`);
  const j2 = info.jahre[1];
  check(j2.zellen.length === 52 && j2.zellen[0].aj === 2 && j2.zellen[0].kw === 36 && j2.zellen[51].kw === 35 && j2.einfach, '2. Lehrjahr beginnt mit dem Schuljahr in KW 36 und ist ein volles Schuljahr');
  check(App.rasterJahrLabel(aug, j2).titel === 'Schuljahr 2026/27' && App.rasterJahrLabel(aug, j2).zusatz === '2. Lehrjahr', 'Kopf des 2. Lehrjahres: Schuljahr 2026/27 · 2. Lehrjahr');
  const j3 = info.jahre[2].zellen;
  check(j3.length === 48 && j3[0].aj === 3 && j3[0].kw === 36 && j3[47].aj === 3 && j3[47].kw === 31 && j3[47].aktiv && !info.jahre[2].einfach, `3. Lehrjahr beginnt in KW 36 und endet früher, mit der Woche des Vertragsendes KW 31 (${j3.length} Wochen)`);
  check(j1.length + 52 + j3.length === 157, 'Summe der Wochen = Vertragsdauer (157 Wochen vom 1.8.2025 bis 31.7.2028)');
  check(j1.filter(c => c.doppelt).map(c => `${c.aj}/${c.kw}`).join(' ') === '0/31 0/32 0/33 0/34 0/35 1/31 1/32 1/33 1/34 1/35' && !j3.some(c => c.doppelt), 'KW 31–35 stehen im 1. Lehrjahr zweimal (2025 und 2026) und sind als doppelt markiert');
  check(App.kwText(aug, 0, 33) === '33/2025' && App.kwText(aug, 1, 33) === '33/2026' && App.kwText(aug, 1, 40) === '40' && App.kwText(aug, 3, 31) === '31', 'kwText nennt bei doppelten Wochen das Jahr');
  // Anzeige-Zeilen: spaltengleich, kurze erste Zeile rechtsbündig über KW 36
  const zl = App.rasterZeilen(j1);
  check(zl.length === 5 && zl[0].zellen.length === 5 && zl[0].versatz === 8 && zl[1].versatz === 0 && zl[1].zellen[0].kw === 36 && zl.slice(1).every(r => r.zellen.length === 13), `1. Lehrjahr: eine kurze Zeile (KW 31–35, Spalte 9–13) + vier volle Zeilen ab KW 36 (${zl.map(r => r.versatz + ':' + r.zellen.length).join(' ')})`);
  const zl3 = App.rasterZeilen(j3);
  check(zl3.length === 4 && zl3[3].zellen.length === 9 && zl3[3].zellen[0].kw === 23 && zl3.every(r => r.versatz === 0), '3. Lehrjahr: letzte Zeile endet nach KW 31');
  check(App.rasterZeilen(info.jahre[1].zellen).map(r => r.zellen[0].kw).join() === '36,49,10,23', 'volles Schuljahr: Zeilen beginnen in KW 36, 49, 10, 23');
  check(App.rasterZeilen(j1.slice(0, 20), true).map(r => r.zellen.length + ':' + r.versatz).join() === '13:0,7:0', 'lose Wochen (außerhalb der Ausbildungszeit) einfach je 13');
  check(info.wochen.every(z => z.aktiv) && info.wochen.length === 157, 'alle Wochen vom Beginn bis zum Ende aktiv');
  const l = App.rasterJahrLabel(aug, info.jahre[0]);
  check(l.titel === 'Ausbildungsjahr 1' && /^01\.08\.2025 – 30\.08\.2026 · 1\. Lehrjahr$/.test(l.zusatz), `Kopf: Ausbildungsjahr 1 · Zeitraum · Lehrjahr (${l.zusatz})`);
  check(App.kwDateRange(31, info.jahre[0].zellen[0].sy).mon === '28.07.2025', 'Datum der ersten Zelle: Woche ab 28.07.2025');
  check(App.jahrNr(aug, 0, 33) === 1 && App.jahrNr(aug, 1, 40) === 1 && App.jahrNr(aug, 1, 33) === 1 && App.jahrNr(aug, 2, 40) === 2 && App.jahrNr(aug, 3, 31) === 3, 'jahrNr = Lehrjahr: (0,33)→1 · (1,40)→1 · (1,33)→1 · (2,40)→2 · (3,31)→3');
  check(App.jahrNr(aug, 3, 34) === 3 && App.jahrNr(aug, 4, 40) === 3, 'Wochen nach dem Vertragsende zählen für Beschriftungen zum letzten Lehrjahr');
}

console.log('\n══ Weitere Beginne ══');
{
  const sa = azubi('Aug26-Samstag', '2026-08-01', '2029-07-31');
  check(App.rasterInfo(sa).start.kw === 32 && App.rasterInfo(sa).jahre.map(j => j.zellen.length).join() === '56,52,48', `Beginn Samstag 1.8.2026 → Woche ab Montag, KW 32; Lehrjahre mit 56, 52 und 48 Wochen (${kurz(sa)})`);
  const fr = azubi('Sep23-Freitag', '2023-09-01', '2026-08-31');
  check(App.rasterInfo(fr).start.kw === 35 && App.rasterInfo(fr).start.aj === 0 && App.rasterInfo(fr).jahre.length === 3 && App.rasterInfo(fr).jahre[0].zellen.length === 53 && App.rasterInfo(fr).jahre[1].zellen[0].kw === 36, `Beginn Freitag 1.9.2023 liegt in KW 35 → diese eine Woche steht vor dem 1. Lehrjahr (${kurz(fr)})`);
  const okt = azubi('Okt25', '2025-10-01', '2028-09-30');
  const io = App.rasterInfo(okt);
  check(io.jahre.length === 3 && io.start.kw === 40 && io.start.aj === 1 && io.jahre[0].zellen.length === 48 && io.jahre[1].zellen[0].kw === 36 && io.jahre[1].einfach, `Beginn 1.10.: das 1. Lehrjahr ist kürzer (ab KW 40), das 2. beginnt in KW 36 (${kurz(okt)})`);
  check(io.jahre[2].zellen.length === 56 && io.jahre[2].zellen[55].aj === 4 && io.jahre[2].zellen[55].kw === 39 && io.jahre[2].nr === 3, 'Restzeit im September hängt am letzten Lehrjahr (keine vierte Zeile)');
  check(App.rasterZeilen(io.jahre[0].zellen)[0].versatz === 4 && App.rasterZeilen(io.jahre[0].zellen)[0].zellen.length === 9, 'späterer Beginn: erste Zeile beginnt in der Spalte ihrer KW');
  const mz = azubi('Maerz25', '2025-03-01', '2028-02-29');
  const im = App.rasterInfo(mz);
  check(im.jahre.length === 3 && im.start.kw === 10 && im.start.aj === 1, `Beginn 1.3.2025 (Sa) → KW 10, drei Lehrjahre statt vier Schuljahres-Zeilen (${kurz(mz)})`);
  check(im.jahre[0].zellen.length === 78 && im.jahre[0].zellen[26].aj === 2 && im.jahre[0].zellen[26].kw === 36 && im.jahre[1].zellen[0].kw === 36 && im.jahre[1].einfach && im.jahre[2].zellen.length === 26, '1. Lehrjahr = Vorlauf ab März + erstes Schuljahr (78 Wochen), 2. ab KW 36, 3. endet im Februar (26 Wochen)');
  const vk = azubi('Verk-Aug25', '2025-08-01', '2027-07-31', 36, 12);
  check(App.rasterInfo(vk).jahre.map(j => j.nr).join() === '2,3' && App.rasterInfo(vk).start.aj === 1, 'Verkürzer ab 1.8.: Ausbildungsjahre 2 und 3, Startwochen im Raster 1');
  const oe = azubi('ohne Ende', '2025-08-01', null);
  check(App.rasterInfo(oe).jahre.length === 3, 'ohne Ausbildungsende: Beginn + Dauer laut Stammdaten');
  const id = ++nextId; db.run('INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (?,?,?,1)', [id, 'ohne Beginn', 'X']);
  check(App.rasterInfo(id).einfach && App.rasterInfo(id).jahre.length === 3 && App.rasterInfo(id).wochen.length === 156, 'ohne Ausbildungsbeginn: drei Jahre KW 36…35 wie bisher');
  // Ausbildungsbeginn geändert → Raster neu
  db.run("UPDATE schueler SET ausbildungsbeginn='2025-09-01', ausbildungsende='2028-08-31' WHERE id=?", [oe]);
  check(App.rasterInfo(oe).einfach && App.rasterInfo(oe).start.kw === 36, 'Änderung des Ausbildungsbeginns in den Stammdaten wirkt sofort');
}

console.log('\n══ Prüfregel der Raster-Nummer (0…6) ══');
{
  let ging = true;
  try { db.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft) VALUES (?,0,31,1)', [aug]); db.run('DELETE FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=0', [aug]); } catch (e) { ging = false; }
  check(ging, 'neue Datenbank: Raster 0 speicherbar');
  check(!/ausbildungsjahr BETWEEN 1 AND 4\)/.test(APP_SRC.replace(/AJ_CHECK_ALT: '[^']*'/, '')), 'kein CREATE TABLE mehr mit BETWEEN 1 AND 4');
  // Alt-Datenbank: Regel erweitern, Daten und Index bleiben
  const alt = new SQL.Database();
  alt.run(`CREATE TABLE kw_status (id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER NOT NULL,
    ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4), kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
    maengel_codes TEXT DEFAULT '', UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche))`);
  alt.run(`CREATE TABLE kw_maengel (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrollergebnis_id INTEGER,
    ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4), kalenderwoche INTEGER, UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche))`);
  alt.run('CREATE INDEX idx_test ON kw_status(schueler_id)');
  alt.run("INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (1,1,36,'A'),(1,4,10,'B')");
  let vorher = false; try { alt.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (1,0,31)'); } catch (e) { vorher = true; }
  check(vorher, 'Alt-Datenbank lehnt Raster 0 ab');
  check(App._migrateAjCheck(alt) === true, '_migrateAjCheck meldet die Erweiterung');
  let nachher = true; try { alt.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (1,0,31)'); alt.run('INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche) VALUES (1,0,31)'); alt.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (1,5,36)'); } catch (e) { nachher = false; }
  check(nachher, 'danach sind Raster 0 und 5 speicherbar (kw_status und kw_maengel)');
  let grenze = false; try { alt.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (1,7,36)'); } catch (e) { grenze = true; }
  check(grenze, 'Raster 7 bleibt abgelehnt');
  check(alt.exec('SELECT COUNT(*) FROM kw_status')[0].values[0][0] === 4 && alt.exec("SELECT maengel_codes FROM kw_status WHERE ausbildungsjahr=4")[0].values[0][0] === 'B', 'Daten unverändert');
  check(alt.exec('PRAGMA integrity_check')[0].values[0][0] === 'ok' && alt.exec("SELECT COUNT(*) FROM sqlite_master WHERE name='idx_test'")[0].values[0][0] === 1, 'Integrität in Ordnung, Index bleibt');
  check(App._migrateAjCheck(alt) === false, 'zweiter Lauf tut nichts');
  const kopie = new SQL.Database(alt.export());
  let exp = true; try { kopie.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (2,0,31)'); } catch (e) { exp = false; }
  check(exp, 'Erweiterung übersteht Export/Laden (Snapshot)');
  check(/this\._migrateAjCheck\(this\.db\)/.test(APP_SRC) && /this\._migrateAjCheck\(diskDb\)/.test(APP_SRC), 'Migration läuft in migrateDB UND _migrateDiskDb');
}

console.log('\n══ Stichtag, „geprüft bis hier“, Fehltage, Beschriftung ══');
{
  check(JSON.stringify(App.ajKwFuerStichtag(aug, '2025-08-15', 33)) === '{"aj":0,"kw":33}', 'Stichtag 15.8.2025, KW 33 → Raster 0 (Startwochen)');
  check(JSON.stringify(App.ajKwFuerStichtag(aug, '2025-10-15', 33)) === '{"aj":0,"kw":33}', 'Stichtag 15.10.2025, „geprüft bis KW 33“ → Raster 0');
  check(JSON.stringify(App.ajKwFuerStichtag(aug, '2025-10-15', 40)) === '{"aj":1,"kw":40}', 'Stichtag 15.10.2025, KW 40 → Raster 1');
  check(JSON.stringify(App.ajKwFuerStichtag(aug, '2026-08-12', 33)) === '{"aj":1,"kw":33}', 'Stichtag 12.8.2026, KW 33 → Raster 1 (August des zweiten Jahres)');
  check(App.rasterZelleAm(aug, '2025-08-04').pos === 1 && App.rasterZelleAm(aug, '2025-07-20') === null, 'rasterZelleAm: 4.8.2025 = zweite Woche, 20.7.2025 außerhalb');
  // Kaskade: Woche (1, KW 38) als geprüft → alle Wochen ab KW 31 des Startjahres
  db.run('INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (700,?,?)', ['2025-10-01', 'geplant']);
  db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,geprueft_kws) VALUES (7000,700,?,'{}')", [aug]);
  KWNav.trackSessionKW(7000, 1, 38, aug);
  const gp = App.query('SELECT ausbildungsjahr aj, kalenderwoche kw FROM kw_status WHERE schueler_id=? AND geprueft=1 ORDER BY ausbildungsjahr, kalenderwoche', [aug]).map(r => `${r.aj}/${r.kw}`).join(' ');
  check(gp === '0/31 0/32 0/33 0/34 0/35 1/36 1/37 1/38', `„geprüft bis KW 38“ füllt ab dem Ausbildungsbeginn: ${gp}`);
  const gk = JSON.parse(App.scalar('SELECT geprueft_kws FROM kontrollergebnisse WHERE id=7000'));
  check(JSON.stringify(gk) === '{"0":[31,32,33,34,35],"1":[36,37,38]}', `geprueft_kws je gespeichertem Raster: ${JSON.stringify(gk)}`);
  // Fehltage je Ausbildungsjahr (Zeile)
  db.run('UPDATE kw_status SET fehltage=2 WHERE schueler_id=? AND ausbildungsjahr=0 AND kalenderwoche=33', [aug]);
  db.run("INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,fehltage,maengel_codes) VALUES (?,1,33,3,'A'),(?,1,40,1,'A')", [aug, aug]);
  const fj = App.rasterFehltage(aug);
  check(fj[1] === 6 && fj[2] === 0 && fj[3] === 0, `Fehltage je Lehrjahr: August 2025, Oktober 2025 und August 2026 zählen zum 1. Lehrjahr (${JSON.stringify(fj)})`);
  check(KontrolleHandler.calcFehlSum(aug, 1) === 6 && KontrolleHandler.calcFehlSum(aug, 2) === 0, 'calcFehlSum rechnet je Zeile');
  // Beschriftung „AJ n“ = Zeile, zeitlich sortiert
  const z = App.autoHinweisCode(aug, 'A');
  check(/\(2 Wochen: AJ 1: KW 40, 33\/2026\)$/.test(z), `Hinweiszeile nennt das Lehrjahr der Zeile und bei doppelten Wochen das Jahr: ${z}`);
  const kl = KWNav._kwListe([{ aj: 0, kw: 34, sid: aug }, { aj: 0, kw: 35, sid: aug }, { aj: 1, kw: 36, sid: aug }, { aj: 1, kw: 31, sid: aug }, { aj: 2, kw: 40, sid: aug }]);
  check(kl === 'AJ1/KW34/2025–36, 31/2026 · AJ2/KW40', `KW-Liste: Bereich über die Raster-Grenze hinweg, doppelte Wochen mit Jahr (${kl})`);
  // Wochen mit Inhalt außerhalb der Ausbildungszeit werden gemeldet
  db.run("INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (?,3,34,'B')", [aug]);
  const w = App.rasterWaisen(aug);
  check(w.length === 1 && w[0].ausbildungsjahr === 3 && w[0].kalenderwoche === 34, 'Eintrag nach dem Ausbildungsende (August 2028) erscheint unter „außerhalb der Ausbildungszeit“');
  // Arbeitstage bisher: Wochen ab dem Beginn bis vor die laufende Woche
  const bisher = App.calcArbeitstageBisher(aug, new Date(2025, 8, 15));   // Mo 15.9.2025, KW 38
  check(bisher === 7 * 5 - Math.round(7 / 52 * 11), `Arbeitstage bisher am 15.9.2025: sieben Wochen seit 1.8. (${bisher})`);
}

console.log('\n══ Verdrahtung ══');
{
  const K = read('src/js/modules/kontrolle.js'), N = read('src/js/modules/kw-nav.js'), P = read('src/js/modules/pdf-export.js'), V = read('src/js/modules/views.js');
  check(/const rInfo = App\.rasterInfo\(s\.id\);/.test(K) && /rInfo\.jahre\.map\(jahr =>/.test(K) && /data-jahr="\$\{jahr\.nr\}"/.test(K) && !/getAJKWBounds/.test(K) && !/App\.getSchuelerAJs/.test(K), 'Durchsicht zeichnet die Zeilen aus rasterInfo (keine festen KW-36-Zeilen mehr)');
  check(/data-jahr="\$\{jahrNr\}" data-aj="\$\{aj\}" data-kw="\$\{kw\}"/.test(K), 'jede Zelle trägt Zeile (data-jahr) und gespeicherte Kennung (data-aj, data-kw)');
  check(/_bereichZellen\(sid, jahrNr\)/.test(K) && /markRangeChecked\(jahrNr\)/.test(K) && /unmarkRangeChecked\(jahrNr\)/.test(K), '„Bereich prüfen“ arbeitet auf den Zellen der Zeile');
  check(/Einträge außerhalb der Ausbildungszeit/.test(K) && /App\.rasterWaisen\(s\.id\)/.test(K), 'Block für Einträge außerhalb der Ausbildungszeit');
  check(/const zeilen = Array\.from\(document\.querySelectorAll\('\.kw-grid'\)\);/.test(N) && !/data-aj="\$\{targetAj\}"/.test(N), 'Pfeiltasten laufen über die gezeichneten Zeilen, nicht über feste 4 × 13 je Raster');
  check(/info\.wochen\.filter\(w => w\.pos <= zelle\.pos/.test(N), 'Kaskade „geprüft bis hier“ über die Rasterreihenfolge ab dem Beginn');
  check(/const rInfo = App\.rasterInfo\(s\.id\);/.test(P) && /for \(const jahr of rJahre\)/.test(P) && !/getAJKWBounds/.test(P), 'Durchsichtsbogen (PDF) zeichnet dieselben Zeilen');
  check(/beginnt mit der Kalenderwoche des Ausbildungsbeginns aus den Stammdaten/.test(V), 'Hilfe erklärt den Beginn des Rasters');
  check(/Jedes weitere Lehrjahr beginnt mit dem Schuljahr in KW 36/.test(V) && /KW 33\/2025/.test(V), 'Hilfe erklärt: früher Beginn vor dem 1. Lehrjahr, weitere Lehrjahre ab KW 36, doppelte Wochen mit Jahr');
  check(/App\.rasterZeilen\(jahr\.zellen\)\.map\(\(row, ri\)/.test(K) && /grid-column-start:\$\{spalte\}/.test(K) && /row\.versatz \+ ci/.test(K) && /App\.rasterZeilen\(jahr\.zellen, !!jahr\.waisen\)/.test(P), 'Durchsicht und Bogen zeichnen spaltengleiche Zeilen (rasterZeilen, versatz)');
  check(/App\.kwText\(s\.id, z\.aj, z\.kw\)/.test(K) && /App\.kwText\(z\.sid, z\.aj, z\.kw\)/.test(N) && /this\.kwText\(sid, r\.ausbildungsjahr, r\.kalenderwoche\)/.test(APP_SRC) && !/RASTER_REST_MAX/.test(APP_SRC), 'Beschriftungen nennen doppelte Wochen mit Jahr (kwText); keine 52-Wochen-Zeilen mehr');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fehler} Fehler ═══`);
process.exit(fehler ? 1 : 0);
