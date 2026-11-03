// ═══════════════════════════════════════════════════════════════════
//  Laufzeit-Smoke-Test: startet dist/berichtsheftkontrolle.html im
//  echten Chromium, klickt alle Ansichten/Tabs/Modals durch und meldet
//  jeden Konsolenfehler. Findet Fehler, die statische Prüfung nicht sieht.
//
//  Voraussetzung: playwright-core + Chromium (im Dev-Container vorhanden)
//  Ausführen:  node tests/smoke-test.mjs
//  Ohne Playwright wird der Test übersprungen (Exit 0).
// ═══════════════════════════════════════════════════════════════════
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const APP = 'file://' + path.join(ROOT, 'dist/berichtsheftkontrolle.html');

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.CHROME_PATH,
];
const exe = CHROME_CANDIDATES.find(p => p && fs.existsSync(p));

// Auflösung auch über NODE_PATH (Playwright liegt im Dev-Container außerhalb
// des Projekts – das Tool selbst hat bewusst keine npm-Abhängigkeiten).
let chromium;
const modCandidates = ['playwright-core', 'playwright',
  ...(process.env.NODE_PATH || '').split(':').filter(Boolean)
    .flatMap(base => [path.join(base, 'playwright-core', 'index.mjs'), path.join(base, 'playwright', 'index.mjs')])
    .map(p => url.pathToFileURL(p).href)];
for (const cand of modCandidates) {
  try { ({ chromium } = await import(cand)); if (chromium) break; } catch { /* nächster Kandidat */ }
}
if (!chromium || !exe) {
  console.log('⊘ Smoke-Test übersprungen (Playwright oder Chromium nicht verfügbar)');
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 250)); });
page.on('pageerror', e => errors.push('[pageerror] ' + (e.message || String(e)).slice(0, 250)));

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(1500);
// Startbildschirm: ein sichtbarer Hauptknopf, Demo unter „Weitere Möglichkeiten“
const haupt = await page.evaluate(() => Array.from(document.querySelectorAll('#connectScreen .btn-primary')).filter(b => b.offsetParent !== null).length);
check(haupt === 1, `Startbildschirm zeigt genau einen Hauptknopf (${haupt})`);
const demo = page.locator('button:has-text("Demo-Modus")');
check(await demo.count() > 0 && !(await demo.first().isVisible()), 'Demo-Modus liegt eingeklappt unter „Weitere Möglichkeiten“');
await page.locator('#connectMehr summary').click();
await page.waitForTimeout(200);
check(await demo.first().isVisible(), '„Weitere Möglichkeiten“ klappt die Nebenwege auf');
await demo.first().click();
await page.waitForTimeout(2500);
check(await page.locator('#appMain').isVisible(), 'App nach Demo-Start sichtbar');

const anzahl = await page.evaluate(() => App.scalar('SELECT COUNT(*) FROM schueler'));
check(anzahl > 0, `Demo-Datenbank gefüllt (${anzahl} Schüler)`);

console.log('\n══ Alle Ansichten ══');
for (const v of ['dashboard','stammdaten','import','planung','kontrolle','nacherfassung','wiedervorlagen','berichte','einstellungen','hilfe']) {
  const before = errors.length;
  await page.evaluate(vv => App.navigate(vv), v);
  await page.waitForTimeout(600);
  const len = await page.evaluate(() => (document.getElementById('mainContent')?.innerHTML || '').length);
  check(errors.length === before && len > 500, `Ansicht "${v}" (${len} Zeichen)`);
}

console.log('\n══ Stammdaten-Tabs ══');
await page.evaluate(() => App.navigate('stammdaten'));
await page.waitForTimeout(400);
for (const tab of ['azubis','jahrgaenge','schulen','klassen','betriebe','fachrichtungen','pruefer']) {
  const before = errors.length;
  await page.evaluate(t => StammdatenTab.show(t), tab);
  await page.waitForTimeout(350);
  check(errors.length === before, `Tab "${tab}"`);
}

console.log('\n══ Kernfunktionen ══');
{
  const before = errors.length;
  const n = await page.evaluate(() => { GlobalSearch.search('mueller'); return GlobalSearch._results.length; });
  check(errors.length === before && n >= 0, `Globale Suche liefert ${n} Treffer`);
}
{
  const before = errors.length;
  const n = await page.evaluate(() => BerichteHandler._dqRun().length);
  check(errors.length === before, `Datenqualitätsprüfung läuft (${n} Befunde)`);
}
{
  const before = errors.length;
  const r = await page.evaluate(() => {
    // Termin mit den meisten Schülern – sonst testet man ein leeres Raster
    const t = App.query(`SELECT kt.id FROM kontrolltermine kt
      ORDER BY (SELECT COUNT(*) FROM kontrolltermin_schueler WHERE kontrolltermin_id=kt.id) DESC LIMIT 1`)[0];
    if (!t) return 'kein Termin';
    App.navigate('kontrolle'); KontrolleHandler.loadTermin(t.id);
    return KontrolleHandler.currentSchuelerList?.length ?? 0;
  });
  await page.waitForTimeout(900);
  check(errors.length === before, `Kontrolldurchführung geladen (${r} Schüler)`);
}
for (const call of ['BerichteHandler.datenqualitaet()','BerichteHandler.zulassungsliste()','GlobalSearch.showCheatSheet()']) {
  const before = errors.length;
  await page.evaluate(c => eval(c), call);
  await page.waitForTimeout(400);
  await page.evaluate(() => App.closeModal());
  check(errors.length === before, `Dialog ${call}`);
}

// PDF-Briefe an Betriebe im Briefbogen des RP: Erzeugung läuft im echten
// Browser mit jsPDF + autoTable, vor und nach der Kontrolle, ohne Fehler
{
  const before = errors.length;
  const r = await page.evaluate(() => {
    const out = {};
    const fertig = App.query("SELECT kt.id FROM kontrolltermine kt WHERE kt.status='durchgefuehrt' ORDER BY (SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=kt.id) DESC LIMIT 1")[0];
    // Offener Termin, der Betriebe mit Azubis hat (fremde Ämter zählen nicht), sonst gibt es keinen Brief
    const offen = App.query("SELECT kt.id FROM kontrolltermine kt WHERE kt.status!='durchgefuehrt' ORDER BY kt.geplant_datum").find(k => Workflows._betriebeDesTermins(k.id, false).betriebe.length > 0);
    if (fertig) { const b = Workflows.exportSeriendruckPDF(fertig.id, false, null, { bytes: true }); out.fertig = b ? b.length : 0; }
    if (offen) { const b = Workflows.exportSeriendruckPDF(offen.id, false, null, { bytes: true }); out.offen = b ? b.length : 0; }
    return out;
  });
  check(errors.length === before && (r.fertig || 0) > 2000, `PDF-Brief nach der Kontrolle erzeugt (${r.fertig || 0} Bytes)`);
  check(errors.length === before && (r.offen || 0) > 2000, `PDF-Brief vor der Kontrolle erzeugt (${r.offen || 0} Bytes)`);
}

// Brief-Editor: Vorschau im Briefbogen, Felder direkt änderbar, Ausgabe als
// PDF, Word (gültiges XML) und E-Mail-Entwurf mit Antwortadresse
{
  const before = errors.length;
  const terminId = await page.evaluate(() => {
    const t = App.query("SELECT kt.id FROM kontrolltermine kt WHERE kt.status='durchgefuehrt' ORDER BY (SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=kt.id) DESC LIMIT 1")[0];
    if (!t) return null;
    Workflows.briefeBearbeiten(t.id);
    return t.id;
  });
  await page.waitForTimeout(400);
  const felder = await page.locator('.bz-blatt .bz-feld').count();
  check(terminId && felder >= 15, `Brief-Editor zeigt den Brief mit änderbaren Feldern (${felder})`);
  if (process.env.BRIEF_SCREENSHOT) await page.screenshot({ path: process.env.BRIEF_SCREENSHOT, fullPage: false });
  const betreff = page.locator('.bz-blatt .bz-betreff');
  await betreff.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (geändert)');
  const r = await page.evaluate(() => {
    const m = BriefEditor.aktuell();
    const docx = BriefEditor.docxBytes([m]);
    const z = new PizZip(docx);
    const ok = (x) => !new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror');
    const pdf = Workflows.briefPdfBytes([m]);
    const eml = m.email ? BriefEditor.emlFuer(m, { anhang: 'beide', boegen: true }) : '';
    return { betreff: m.betreff, xml: ok(z.file('word/document.xml').asText()) && ok(z.file('word/footer1.xml').asText()) && ok(z.file('word/styles.xml').asText()) && ok(z.file('[Content_Types].xml').asText()),
      bild: !!z.file(/word\/media\/logo\./).length, pdf: pdf.length, eml: eml.length, reply: /Reply-To:[^\r]*\r\n <Freisprechung\.GB@rpf\.bwl\.de>/.test(eml), mail: !!m.email, n: BriefEditor.modelle().length };
  });
  check(/\(geändert\)$/.test(r.betreff), 'Tippen im Brief ändert den Betreff im Modell');
  check(r.xml && r.bild, 'Word-Datei: wohlgeformtes XML, Logo eingebettet');
  check(r.pdf > 2000, `PDF aus dem bearbeiteten Brief (${r.pdf} Bytes)`);
  check(!r.mail || (r.eml > r.pdf && r.reply), 'E-Mail-Entwurf mit PDF und Word als Anhang, Antwort an das Funktionspostfach');
  await page.evaluate(() => App.closeModal());
  check(errors.length === before, 'Brief-Editor ohne Konsolenfehler');
}

// Rückfrage während einer Ladeanzeige (Feldfall Import → „Aktiver Jahrgang“):
// Die Ladeanzeige (z-index 10000) lag über der Rückfrage, der Import wartete
// endlos. Jetzt tritt sie für die Rückfrage zurück und kommt danach wieder.
{
  const before = errors.length;
  await page.evaluate(() => { App.showLoading('Importiere Azubi-Daten…'); window.__antwort = App.confirm('Jahrgang setzen?', { titel: 'Aktiver Jahrgang', ok: 'Jahrgang setzen' }); });
  await page.waitForTimeout(200);
  const vorher = await page.evaluate(() => {
    const ok = document.getElementById('dlgOk'); const r = ok.getBoundingClientRect();
    const oben = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { laden: document.getElementById('loadingOverlay').style.display, klickbar: oben === ok || ok.contains(oben) };
  });
  check(vorher.laden === 'none' && vorher.klickbar, 'Rückfrage während der Ladeanzeige ist sichtbar und klickbar');
  await page.click('#dlgOk');
  const nachher = await page.evaluate(async () => ({ antwort: await window.__antwort, laden: document.getElementById('loadingOverlay').style.display, text: document.getElementById('loadingText').textContent }));
  check(nachher.antwort === true && nachher.laden === 'flex' && /Importiere Azubi-Daten/.test(nachher.text), 'Nach der Antwort läuft die Ladeanzeige weiter');
  await page.evaluate(() => App.hideLoading());
  check(errors.length === before, 'Ladeanzeige + Rückfrage ohne Konsolenfehler');
}

if (errors.length) {
  console.log('\n──── Konsolenfehler ────');
  [...new Set(errors)].forEach(e => console.log('  ' + e));
}
console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
await browser.close();
process.exit(failed ? 1 : 0);
