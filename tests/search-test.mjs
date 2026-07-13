// ═══════════════════════════════════════════════════════════════════
//  Test der globalen Suche: Fuzzy, Multi-Token, alle Felder, Ranking
//  Ausführen:  node tests/search-test.mjs
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
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
const GS_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/global-search.js'), 'utf8');

// ── Seed-Datenbank ──
const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
// Tabellen/Spalten, die erst migrateDB() anlegt
db.run(`CREATE TABLE IF NOT EXISTS ausbilder (id INTEGER PRIMARY KEY AUTOINCREMENT, betrieb_id INTEGER, nachname TEXT DEFAULT '', vorname TEXT DEFAULT '', telefon TEXT DEFAULT '', email TEXT DEFAULT '', mobil TEXT DEFAULT '', funktion TEXT DEFAULT '')`);
db.run(`CREATE TABLE IF NOT EXISTS schueler_bemerkungen (id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER, text TEXT DEFAULT '', erstellt_von TEXT DEFAULT '', erstellt_am TEXT DEFAULT '')`);
for (const alter of ["ALTER TABLE berufsschulen ADD COLUMN email_cc TEXT DEFAULT ''",
                     "ALTER TABLE berufsschulen ADD COLUMN ansprechpartner_json TEXT DEFAULT '[]'",
                     "ALTER TABLE betriebe ADD COLUMN vorname TEXT DEFAULT ''",
                     "ALTER TABLE betriebe ADD COLUMN zusatzbezeichnung TEXT DEFAULT ''"]) {
  try { db.run(alter); } catch (e) {}
}
db.run(`INSERT INTO betriebe (id,name,ort,strasse,plz,telefon,email,betriebsnummer) VALUES
  (1,'Gärtnerei Müller','Radolfzell','Seestr. 1','78315','07732-123','info@gm.de','B-4711'),
  (2,'Baumschule Schmidt','Konstanz','Hafenweg 2','78462','07531-999','mail@bs.de','B-0815')`);
db.run(`INSERT INTO berufsschulen (id,name,ort,email,ansprechpartner_json) VALUES
  (1,'Berufsschule Radolfzell','Radolfzell','sekretariat@bsr.de','[{"name":"Frau Wagner","funktion":"Lehrerin GaLaBau"}]')`);
db.run(`INSERT INTO klassen (id,berufsschule_id,klassenbezeichnung,lehrjahr) VALUES (1,1,'GaLa 2A',2)`);
db.run(`INSERT INTO schueler (id,nachname,vorname,klasse_id,betrieb_id,aktiv,ibykus_id,email) VALUES
  (1,'Müller','Anna',1,1,1,'IBK-100','anna.mueller@mail.de'),
  (2,'Mayer','Ben',1,2,1,'IBK-200',''),
  (3,'Schulz','Clara',1,1,0,'IBK-300','')`);
db.run(`INSERT INTO ausbilder (id,betrieb_id,nachname,vorname,funktion,telefon) VALUES
  (1,1,'Hoffmann','Peter','Ausbilder GaLaBau','0173-555')`);
db.run(`INSERT INTO schueler_bemerkungen (schueler_id,text,erstellt_von) VALUES
  (2,'Berichtsheft nachgereicht wegen Krankenhausaufenthalt','anna')`);

// ── Sandbox: nur GlobalSearch + minimale Stubs ──
const resultsEl = { innerHTML: '' };
const sandbox = {
  console, setTimeout, clearTimeout, Date, Math, JSON,
  document: { getElementById: (id) => (id === 'globalSearchResults' ? resultsEl : { innerHTML: '', value: '', style: {}, focus() {} }), querySelectorAll: () => [] },
  App: {
    query(sql, params = []) {
      const stmt = db.prepare(sql); stmt.bind(params);
      const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free();
      return rows;
    },
    scalar(sql, params = []) { const r = sandbox.App.query(sql, params); return r.length ? Object.values(r[0])[0] : null; },
    getSchuelerAmpel: () => ({ icon: '', label: '' }),
    navigate() {}, openModal() {},
  },
  StammdatenTab: {}, formatDate: (d) => String(d || ''),
  esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(GS_SRC + '\n;globalThis.__GS = GlobalSearch;', sandbox, { filename: 'global-search.js' });
const GS = sandbox.__GS;

let failed = 0, passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FEHLER: ' + msg); }
}
function results(q) { GS.search(q); return { r: GS._results, html: resultsEl.innerHTML }; }
function firstSchueler(q) { const { r } = results(q); return r.find(x => x.type === 'schueler'); }

console.log('══ Normalisierung & Fuzzy ══');
check(firstSchueler('mueller')?.id === 1, "'mueller' findet Müller (Umlaut-Normalisierung)");
check(firstSchueler('Müller')?.id === 1, "'Müller' findet Müller (exakt)");
check(firstSchueler('muler')?.id === 1, "'muler' findet Müller (Fuzzy, 1 Tippfehler)");
check(firstSchueler('maier')?.id === 2, "'maier' findet Mayer (Fuzzy)");
check(firstSchueler('xyz')?.id === undefined, "'xyz' findet nichts (kein Rausch-Fuzzy bei 3 Zeichen)");

console.log('══ Multi-Token (UND über verschiedene Felder) ══');
{
  // Alle 3 Schüler haben die Radolfzeller Schule; Clara hat zudem Betrieb "Müller".
  // Anna (Namens-Treffer, Primärfeld-Bonus) muss VOR Clara (nur Betriebsfeld) stehen.
  const { r } = results('müller radolfzell');
  const s = r.filter(x => x.type === 'schueler');
  check(s.length >= 1 && s[0].id === 1, "'müller radolfzell' → Anna Müller als Top-Treffer (Ranking)");
}
check(firstSchueler('mayer konstanz')?.id === 2, "'mayer konstanz' → Ben Mayer (Name + Betriebsort)");
check(firstSchueler('mayer seestr') === undefined, "'mayer seestr' → kein Treffer (Seestraße gehört zu Müllers Betrieb)");
check(firstSchueler('anna gala')?.id === 1, "'anna gala' → Vorname + Klassen-Prefix");

console.log('══ Alle Felder ══');
check(firstSchueler('krankenhausaufenthalt')?.id === 2, 'Bemerkungstext findet den Schüler');
check(firstSchueler('IBK-300')?.id === 3, 'IBYKUS-ID findet auch INAKTIVE Schüler');
{
  const { r } = results('wagner');
  check(r.some(x => x.type === 'schule'), 'Lehrerin im Ansprechpartner-JSON findet die Schule');
}
{
  const { r } = results('B-4711');
  check(r.some(x => x.type === 'betrieb' && x.id === 1), 'Betriebsnummer findet den Betrieb');
}
{
  const { r } = results('hoffmann');
  check(r.some(x => x.type === 'ausbilder' && x.id === 1), 'Ausbilder über Nachnamen');
}

console.log('══ Ranking ══');
{
  // 'schmidt' exakt (Betrieb 2) muss vor Fuzzy-Nachbarn liegen; Mayer (Betrieb Schmidt) matcht als Schüler
  const { r } = results('schmidt');
  const sIdx = r.findIndex(x => x.type === 'schueler' && x.id === 2);
  check(sIdx >= 0, "'schmidt' findet Ben Mayer über den Betriebsnamen");
}
{
  GS.search('mueller');
  check(resultsEl.innerHTML.includes('Müller'), 'HTML-Ausgabe enthält den Treffer');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
