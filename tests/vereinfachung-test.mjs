// ═══════════════════════════════════════════════════════════════════
//  Logik-Audit Pakete 4–7: Befund + Nachweisweg (Mapping auf die alten
//  Ergebniswerte, Kürzel ⇧0–6), Einstellungen für Wiedervorlage-Fristen,
//  ÜBA-Sollzahlen und Kampagnen-Hinweise, Ergebnis-Mail an die Schule ohne
//  Namensliste, Beratungsgespräch § 76 als Wiedervorlage mit Einladung,
//  „gez.“ statt Signatur, Rasterkopf Schuljahr/Lehrjahr/Vertragsjahr
//  Ausführen:  node tests/vereinfachung-test.mjs
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
const K_SRC = read('src/js/modules/kontrolle.js');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, value: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, confirm: () => true, prompt: () => 'Grund',
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { _stack: [], push(desc, undo, redo) { this._stack.push({ desc, undo, redo }); }, clear() { this._stack = []; } },
  esc: (s) => String(s ?? ''), todayStr: () => '2026-03-10', formatDate: (d) => String(d || ''),
  addDaysStr: (n) => { const d = new Date('2026-03-10T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
  Views: { wiedervorlagen() {} }, PDFExport: {}, AzubiSeite: { istOffen: () => false },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/utils.js', null], ['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav'], ['src/js/modules/workflows.js', 'Workflows'], ['src/js/modules/wiedervorlagen.js', 'WiedervorlagenHandler'], ['src/js/modules/planung.js', 'PlanungHandler']]) {
  let src = read(f);
  if (!name) src = src.replace(/\/\/ ── Auto-init ──[\s\S]*$/, '') + '\n;globalThis.wvArtLabel = wvArtLabel;';
  vm.runInContext(src + (name ? `\n;globalThis.${name} = ${name};` : ''), sandbox, { filename: path.basename(f) });
}
const { __App: App, KontrolleHandler: KH, Workflows, WiedervorlagenHandler: WV, PlanungHandler: PH, wvArtLabel } = sandbox;
App.db = db;
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.openModal = () => {}; App.closeModal = () => {};
KH.renderSchueler = () => {}; KH.renderUebersicht = () => {}; KH.startLiveSync = () => {}; KH.saveAndRelease = () => {};

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

db.run(`INSERT INTO betriebe (id,name,email,ansprechpartner) VALUES (1,'Gärtnerei Grün','gruen@example.org','Frau Grün')`);
db.run(`INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'036','Garten- und Landschaftsbau','Produktion'),(2,'031','Zierpflanzenbau','Produktion'),(3,'170','Gartenbaufachwerker','Fachwerker')`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende,fachrichtung_id,betrieb_id,ausbildungsstaette) VALUES
  (1,'Erst','Anna',1,'2024-09-01','2027-08-31',1,1,'Gärtnerei Grün'),(2,'Zweit','Bernd',1,'2024-09-01','2027-08-31',2,1,'Gärtnerei Grün')`);
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-03-10','geplant')`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,geprueft_kws) VALUES (100,10,1,'{}'),(200,10,2,'{}')`);
db.run(`UPDATE kontrollergebnisse SET anwesend=0 WHERE id=200`);
KH.currentTerminId = 10;
KH.currentSchuelerList = App.query('SELECT * FROM schueler ORDER BY id');
KH.activePruefer = 'Anna Berater';
KH.currentIndex = 0; KH._viewMode = 'einzeln';
const erg = (id) => App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=?', [id]);

console.log('══ Paket 4: Befund + Nachweisweg ══');
{
  check(App.befundAus('').befund === '' && App.befundAus('in_ordnung').befund === 'ok', 'befundAus: leer / in Ordnung');
  check(App.befundAus('nachholung_naechste_durchsicht').weg === 'naechste_durchsicht' && App.befundAus('berichte_bis_termin_email').weg === 'email' && App.befundAus('sachberichte_wetter_email').weg === 'email_sachberichte' && App.befundAus('post_an_rp').weg === 'post' && App.befundAus('persoenliche_vorlage_rp').weg === 'persoenlich', 'befundAus: jeder alte Wert hat einen Weg');
  check(App.ergebnisAus('ok') === 'in_ordnung' && App.ergebnisAus('') === '' && App.ergebnisAus('maengel', 'email') === 'berichte_bis_termin_email' && App.ergebnisAus('maengel', 'post') === 'post_an_rp' && App.ergebnisAus('maengel', 'persoenlich') === 'persoenliche_vorlage_rp' && App.ergebnisAus('maengel', 'unbekannt') === 'nachholung_naechste_durchsicht', 'ergebnisAus: Befund × Weg → alter Wert, unbekannter Weg = nächste Durchsicht');
  App.WEGE.forEach(w => check(App.ergebnisAus('maengel', w.val) === w.ergebnis && App.befundAus(w.ergebnis).weg === w.val, `Weg ${w.val} ↔ ${w.ergebnis} ist eindeutig`));
  KH.setzeErgebnisKurz(2);
  check(erg(100) === 'nachholung_naechste_durchsicht', '⇧2 = Mängel, Standardweg nächste Durchsicht');
  KH.setzeErgebnisKurz(4);
  check(erg(100) === 'berichte_bis_termin_email', '⇧4 = Weg E-Mail');
  KH.setzeErgebnisKurz(5);
  check(erg(100) === 'post_an_rp', '⇧5 = Weg Post');
  KH.setzeErgebnisKurz(2);
  check(erg(100) === 'post_an_rp', '⇧2 nach gewähltem Weg behält den Weg');
  KH.setzeErgebnisKurz(6);
  check(erg(100) === 'persoenliche_vorlage_rp', '⇧6 = persönliche Vorlage');
  KH.setzeErgebnisKurz(1);
  check(erg(100) === 'in_ordnung', '⇧1 = In Ordnung');
  KH.setzeErgebnisKurz(0);
  check(erg(100) === '', '⇧0 = zurückgesetzt');
  check(/data-befund="ok"/.test(K_SRC) && /data-befund="maengel"/.test(K_SRC) && /id="keWeg"/.test(K_SRC) && /name="ergebnis"/.test(K_SRC) && /class="erg-pill/.test(K_SRC), 'Leiste: drei Pillen (offen / In Ordnung / Mängel) + Weg-Auswahl, Kennungen für Kürzel bleiben');
  check(/email_sachberichte' \|\| zv \|\| bf\.weg === 'email_sachberichte'/.test(K_SRC), 'Weg „Sachberichte/Wetter“ nur mit Zusatzvereinbarung (oder wenn bereits gewählt)');
  check(/erg-mangel:has\(input:checked\)/.test(read('src/css/styles.css')), 'Mängel-Pille rot');
  check(/Befund<\/strong> \(✓ In Ordnung \/ ✗ Mängel/.test(read('src/js/modules/views.js')), 'Hilfe erklärt Befund und Nachweisweg');
}

console.log('\n══ Paket 5: Fristen, ÜBA-Sollzahlen, Kampagnen-Hinweise als Einstellungen ══');
{
  check(App.wvFristTage('persoenliche_vorlage_rp') === 14 && App.wvFristTage('post_an_rp') === 21 && App.wvFristTage('erinnerung') === 14 && App.wvFristTage('nachholung_abwesend') === 21 && App.wvFristTage('beratung_betrieb') === 14, 'Standardfristen wie bisher (14/21/28)');
  const add = sandbox.addDaysStr; // utils.js überschreibt den Stub mit der echten Uhr
  check(App.wvFrist('post_an_rp') === add(21), `wvFrist rechnet vom heutigen Datum (${App.wvFrist('post_an_rp')})`);
  App.wvFristenSetzen('post_an_rp;10\nerinnerung;7\nunbekannt;5\npersoenliche_vorlage_rp;999');
  check(App.wvFristTage('post_an_rp') === 10 && App.wvFristTage('erinnerung') === 7 && App.wvFristTage('persoenliche_vorlage_rp') === 14, 'Einstellung greift; unbekannte Art und unplausible Tage werden ignoriert');
  check(KH._wvDefaultFuer('post_an_rp') === add(10) && KH._wvDefaultFuer('persoenliche_vorlage_rp') === add(14), 'Standardfrist je Ergebnis kommt aus der Einstellung');
  App.run('DELETE FROM wiedervorlagen WHERE kontrollergebnis_id=100'); // eine bestehende WV behält ihre Frist
  KH.setzeErgebnisKurz(5);
  const wvFrist = App.scalar('SELECT frist_datum FROM wiedervorlagen WHERE kontrollergebnis_id=100 ORDER BY id DESC LIMIT 1');
  check(wvFrist === add(10), `Neue Wiedervorlage zum Ergebnis nutzt die eingestellte Frist (${wvFrist} = heute + 10)`);
  KH.setzeErgebnisKurz(0);
  App.wvFristenSetzen('');
  check(App.wvFristTage('post_an_rp') === 21, 'Leere Einstellung = Standard');
  check(!/addDaysStr\((14|21|28)\)/.test(K_SRC) && !/addDaysStr\((14|21|28)\)/.test(read('src/js/modules/workflows.js')) && !/addDaysStr\(21\)/.test(read('src/js/modules/planung.js')), 'Keine festen 14/21/28 mehr in Kontrolle, Workflows und Planung');
  check(App.getRequiredUBA(1) === 6 && App.getRequiredUBA(2) === 2 && App.getRequiredUBA(3) === 1, 'ÜBA-Standard: GaLaBau 6, Produktion 2, Fachwerker 1');
  App.ubaSollSetzen('036;4\n031;3');
  check(App.getRequiredUBA(1) === 4 && App.getRequiredUBA(2) === 3 && App.getRequiredUBA(3) === 1, 'Einstellung uba_soll hat Vorrang je Code');
  App.ubaSollSetzen('');
  check(App.getRequiredUBA(1) === 6, 'Leere Einstellung = Standard');
  check(App.kampagneHinweise('zpH').some(z => /GaLaBau/.test(z)) && App.kampagneHinweise('apW').some(z => /1\.11\./.test(z)), 'Kampagnen-Hinweise: Standard vorhanden');
  App.kampagneHinweiseSetzen('zpH', 'Nur GaLaBau\n\nBaumschule jetzt in Offenburg');
  check(App.kampagneHinweise('zpH').join('|') === 'Nur GaLaBau|Baumschule jetzt in Offenburg' && App.kampagneHinweise('zpF').length === 3, 'Eigene Hinweise je Kampagne, andere bleiben Standard');
  const v = PH._kontrollVorlagen(new Date(2026, 8, 11)).find(x => x.key === 'zpH');
  check(v.hinweise.join('|') === 'Nur GaLaBau|Baumschule jetzt in Offenburg', 'Kontroll-Vorlagen lesen die Einstellung');
  App.kampagneHinweiseSetzen('zpH', '');
  check(App.kampagneHinweise('zpH').length === 3, 'Leere Zeilen = Standard');
  check(!/Frau Pfirsig/.test(read('src/js/modules/planung.js')) && /Frau Pfirsig/.test(APP_SRC), 'Praxiswissen steht nicht mehr in planung.js, sondern als Standard der Einstellung');
  const V = read('src/js/modules/views.js');
  check(/setUbaSoll/.test(V) && /setWvFristen/.test(V) && /setKampagne_/.test(V) && /Jedes Jahr im August prüfen/.test(V), 'Einstellungs-Karten ÜBA, Fristen, Kampagnen; Ferien-Hinweis');
}

console.log('\n══ Paket 6: Ergebnis-Mail an die Schule ohne Namensliste ══');
{
  App.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung' WHERE id=100");
  const liste = KH.currentSchuelerList;
  const ohne = Workflows._ergebnisseFuerSchule(10, liste, false);
  check(/In Ordnung: 1/.test(ohne) && !/Erst, Anna/.test(ohne), 'Ohne Namen: nur Zahlen je Ergebnis');
  check(/Nicht anwesend/.test(ohne) && /Zweit, Bernd/.test(ohne), 'Abwesende stehen mit Namen (Nachholung an der Schule)');
  const mit = Workflows._ergebnisseFuerSchule(10, liste, true);
  check(/In Ordnung \(1\):\n  - Erst, Anna/.test(mit), 'Mit Namen: Liste je Ergebnisart wie früher');
  check(App.schuleErgebnisMitNamen() === false, 'Standard: ohne Namensliste');
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('schule_ergebnis_namen','1')");
  check(App.schuleErgebnisMitNamen() === true && /setSchuleErgebnisNamen/.test(read('src/js/modules/views.js')), 'Einstellung schaltet um (Karte Vorlagen)');
  App.run("DELETE FROM einstellungen WHERE schluessel='schule_ergebnis_namen'");
  check(/_ergebnisseFuerSchule\(terminId, t\.schuelerList, App\.schuleErgebnisMitNamen\(\)\)/.test(read('src/js/modules/workflows.js')), 'emailSchule nutzt den Block');
}

console.log('\n══ Paket 7: Beratungsgespräch § 76, Nachweis-Hinweis, gez., Rasterkopf ══');
{
  const wvId = await WV.beratungAnlegen(1, { frist: '2026-03-24', anlass: 'Mängel trotz zweifacher Erinnerung nicht behoben' });
  const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [wvId])[0];
  check(w && w.art === 'beratung_betrieb' && w.status === 'offen' && w.frist_datum === '2026-03-24' && !w.kontrollergebnis_id, 'Wiedervorlage „Beratungsgespräch“ ohne Kontrollergebnis');
  check(App.scalar('SELECT notiz FROM wiedervorlage_notizen WHERE wiedervorlage_id=?', [wvId]) === 'Anlass: Mängel trotz zweifacher Erinnerung nicht behoben', 'Anlass als Notiz');
  check(wvArtLabel('beratung_betrieb') === 'Beratungsgespräch Betrieb (§ 76 BBiG)', 'Label der Art');
  check(Workflows._wvVorlageTyp(w, true) === 'beratung_betrieb' && Workflows._wvVorlageTyp(w, false) === 'beratung_betrieb', 'Vorlage: Einladung statt Mahnung – auch überfällig');
  const vorl = App.VORLAGEN.beratung_betrieb;
  const r = App.renderVorlage('beratung_betrieb', { ...App.absenderCtx('Anna Berater'), anrede: '', azubi: 'Anna Erst', betrieb: 'Gärtnerei Grün', anlass: 'Mängel', frist: '24.03.2026' });
  check(vorl && /§ 76 Abs\. 1 BBiG/.test(r.body) && /§ 76 Abs\. 2 BBiG/.test(r.body) && /Anna Erst/.test(r.body) && /24\.03\.2026/.test(r.body) && /Beratungsgespräch/.test(r.betreff), 'Einladungs-Vorlage nennt § 76 Abs. 1 und 2, Azubi, Anlass und Frist');
  check(/Anlass:%/.test(read('src/js/modules/workflows.js')) && /istBeratung/.test(read('src/js/modules/workflows.js')), 'WV-Mail liest den Anlass und zeigt die Einladung');
  check(/beratungAnlegen\(\$\{s\.id\}\)/.test(read('src/js/modules/azubi-seite.js')) && /beratungAnlegen\(\$\{s\.id\}\)/.test(K_SRC), 'Knopf auf der Azubi-Seite und im ⋯-Menü der Durchsicht');
  check(/nur mit anschließender Vorlage/.test(WV.NACHWEIS_ARTEN.telefon), 'Nachweis „telefonisch“ mit Hinweis');
  check(!/Digitale Signatur/.test(read('src/js/modules/pdf-export.js')) && !/Digitale Signatur/.test(K_SRC) && /Namensvermerk/.test(read('src/js/modules/pdf-export.js')), 'Kein „Digitale Signatur“ mehr – Namensvermerk');
  check(/Schuljahr ' \+ bnd\.schoolYear/.test(K_SRC) && /\. Lehrjahr/.test(K_SRC) && /\. Vertragsjahr/.test(K_SRC), 'Rasterkopf: Schuljahr · Lehrjahr · Vertragsjahr (bei Verkürzern)');
  check(/beratung_betrieb: 14/.test(APP_SRC) && App.WV_FRISTEN_LABELS.beratung_betrieb, 'Frist für Beratungsgespräch einstellbar');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
