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

// Dialog schließen und in eine andere Ansicht springen (ein Klick): der
// asynchrone Zurück-Schritt aus closeModal() nahm den neuen Hash wieder zurück
// und die Ansicht sprang auf die alte.
{
  const before = errors.length;
  await page.evaluate(() => App.navigate('wiedervorlagen'));
  await page.waitForTimeout(300);
  const wv = await page.evaluate(() => { const w = App.query('SELECT w.id FROM wiedervorlagen w JOIN kontrollergebnisse ke ON ke.id=w.kontrollergebnis_id LIMIT 1')[0]; if (w) WiedervorlagenHandler.details(w.id); return !!w; });
  if (wv) {
    await page.waitForTimeout(300);
    await page.locator('#modalContent button:has-text("Zur Kontrolle springen")').click();
    await page.waitForTimeout(1300);
    const nach = await page.evaluate(() => ({ view: App.currentView, hash: location.hash, termin: !!document.getElementById('terminWahlCard') || !!document.getElementById('lockableContent') }));
    check(nach.view === 'kontrolle' && nach.hash === '#kontrolle', `Sprung aus einem Dialog bleibt in der Zielansicht (${nach.view} ${nach.hash})`);
    await page.evaluate(() => { App.navigate('wiedervorlagen'); });
    await page.waitForTimeout(200);
    await page.goBack(); await page.waitForTimeout(300);
    check(await page.evaluate(() => App.currentView) === 'kontrolle', 'Zurück-Taste führt danach in die vorige Ansicht');
  } else check(true, 'Sprung aus einem Dialog (keine Wiedervorlage in den Demodaten – übersprungen)');
  check(errors.length === before, 'Sprung aus einem Dialog ohne Konsolenfehler');
}

// Export an jeder Tabelle: Leiste unter den Listen, Auswahl = angehakte
// Zeilen, sonst alle angezeigten; Betriebe als Adressliste.
{
  const before = errors.length;
  await page.evaluate(() => {
    window.__wb = []; window.__clip = [];
    window.__xlsxAlt = XLSX.writeFile; window.__kopAlt = App.kopieren;
    XLSX.writeFile = (wb, name) => { window.__wb.push({ name, blaetter: wb.SheetNames.map(n => ({ n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) })) }); };
    App.kopieren = async (t, m) => { window.__clip.push({ t, m }); return true; };
    App.navigate('stammdaten'); StammdatenTab.show('betriebe');
  });
  await page.waitForTimeout(400);
  const leiste = await page.evaluate(() => { const b = document.querySelector('#mainContent .tab-export'); return b ? { text: b.querySelector('.te-zahl').textContent, knoepfe: [...b.querySelectorAll('button')].map(x => x.dataset.te).join(','), unterTabelle: b.previousElementSibling && b.previousElementSibling.dataset.export, zeilen: document.querySelectorAll('#betriebeTableBody tr').length } : null; });
  check(!!leiste && leiste.unterTabelle === 'betriebe' && leiste.knoepfe === 'xlsx,kopie,mail' && leiste.text === `${leiste.zeilen} Betriebe`, `Export-Leiste unter der Betriebsliste (${leiste && leiste.text})`);
  await page.locator('#mainContent .tab-export [data-te="xlsx"]').click();
  let wb = await page.evaluate(() => window.__wb.pop());
  check(!!wb && /^Betriebe_Adressliste_\d{4}-\d{2}-\d{2}\.xlsx$/.test(wb.name) && wb.blaetter[0].n === 'Betriebe' && wb.blaetter[0].aoa.length === leiste.zeilen + 1 && wb.blaetter[0].aoa[0].slice(4, 8).join('|') === 'Ansprechpartner|Straße|PLZ|Ort', 'Alle Betriebe als Excel-Adressliste');
  await page.evaluate(() => { const c = document.querySelectorAll('.chk-betr'); c[0].click(); c[2].click(); });
  await page.waitForTimeout(300);
  const wahl = await page.evaluate(() => ({ text: document.querySelector('#mainContent .tab-export .te-zahl').textContent, oben: getComputedStyle(document.getElementById('bulkBarBetriebe')).display, namen: [...document.querySelectorAll('.chk-betr:checked')].map(c => c.closest('tr').querySelector('strong').textContent.trim()) }));
  check(wahl.text === '2 Betriebe ausgewählt' && wahl.oben === 'flex', 'Auswahl: Leiste zählt die angehakten Betriebe, Auswahl-Leiste oben erscheint');
  await page.locator('#mainContent .tab-export [data-te="xlsx"]').click();
  wb = await page.evaluate(() => window.__wb.pop());
  check(!!wb && /_Auswahl_/.test(wb.name) && wb.blaetter[0].aoa.length === 3 && wb.blaetter[0].aoa.slice(1).map(r => r[1]).join('|') === wahl.namen.join('|'), 'Excel enthält nur die ausgewählten Betriebe');
  await page.locator('#mainContent .tab-export [data-te="kopie"]').click();
  await page.locator('#bulkBarBetriebe button:has-text("E-Mail-Adressen")').click();
  await page.waitForTimeout(150);
  const clip = await page.evaluate(() => window.__clip.splice(0));
  check(clip.length === 2 && clip[0].t.split('\n').length === 3 && /\t/.test(clip[0].t) && /@/.test(clip[1].t) && /Bcc/.test(clip[1].m), 'Kopieren (Tabelle) und E-Mail-Adressen der Auswahl');
  // Suche blendet Zeilen aus → der Export folgt der Anzeige
  await page.evaluate(() => StammdatenTab._betriebeAlle(false));
  const wort = await page.evaluate(() => document.querySelector('#betriebeTableBody tr').dataset.search.split(' ')[0]);
  await page.locator('input[placeholder="Betrieb suchen…"]').fill(wort);
  await page.waitForTimeout(350);
  const gefiltert = await page.evaluate(() => ({ text: document.querySelector('#mainContent .tab-export .te-zahl').textContent, sichtbar: [...document.querySelectorAll('#betriebeTableBody tr')].filter(r => r.style.display !== 'none').length }));
  check(gefiltert.sichtbar >= 1 && gefiltert.sichtbar < leiste.zeilen && gefiltert.text === `${gefiltert.sichtbar} Betrieb${gefiltert.sichtbar === 1 ? '' : 'e'}`, `Suche: Leiste zählt nur die angezeigten Betriebe (${gefiltert.text})`);
  // Azubi-Liste: eine Seite am Bildschirm, der Export nimmt die ganze gefilterte Liste
  await page.evaluate(() => StammdatenTab.show('azubis'));
  await page.waitForTimeout(500);
  const az = await page.evaluate(() => ({ text: document.querySelector('#mainContent .tab-export .te-zahl').textContent, seite: document.querySelectorAll('.chk-azubi').length, gesamt: StammdatenTab._getFilteredAzubis().length }));
  await page.locator('#mainContent .tab-export [data-te="xlsx"]').click();
  wb = await page.evaluate(() => window.__wb.pop());
  check(az.text === `${az.gesamt} Azubis` && !!wb && wb.blaetter[0].aoa.length === az.gesamt + 1 && az.gesamt >= az.seite, `Azubi-Liste: Export der ganzen gefilterten Liste (${az.gesamt}), nicht nur der Seite (${az.seite})`);
  // Tabelle ohne eigene Datenquelle (Dialog): Export so, wie sie dasteht
  await page.evaluate(() => { const id = App.scalar('SELECT k.berufsschule_id FROM schueler s JOIN klassen k ON s.klasse_id=k.id WHERE s.aktiv=1 GROUP BY k.berufsschule_id ORDER BY COUNT(*) DESC LIMIT 1'); StammdatenTab.showSchuleAzubis(id); });
  await page.waitForTimeout(500);
  const dlg = await page.locator('#modalContent .tab-export [data-te="xlsx"]').count();
  if (dlg) {
    await page.locator('#modalContent .tab-export [data-te="xlsx"]').first().click();
    wb = await page.evaluate(() => window.__wb.pop());
    const zeilen = await page.evaluate(() => document.querySelector('#modalContent table.data-table').tBodies[0].rows.length);
    check(!!wb && wb.blaetter[0].aoa.length === zeilen + 1 && wb.blaetter[0].aoa[0].includes('Name') && !wb.blaetter[0].aoa[0].some(h => /^Spalte|Aktion/.test(h)), 'Liste in einem Dialog: Export der angezeigten Spalten ohne Symbol- und Aktionsspalten');
  } else check(true, 'Liste in einem Dialog (zu wenige Zeilen in den Demodaten – übersprungen)');
  await page.evaluate(() => { App.closeModal(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => App.navigate('dashboard'));
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelectorAll('#mainContent .tab-export').length) === 0, 'Startseite bleibt ohne Export-Leisten');
  await page.evaluate(() => { XLSX.writeFile = window.__xlsxAlt; App.kopieren = window.__kopAlt; });
  check(errors.length === before, 'Export ohne Konsolenfehler');
}

// Vom Azubi aus zum Termin: Menü „Termin“ auf der Azubi-Seite – einem neuen
// Termin zuweisen, von dort in einen anderen verschieben, Einzeltermin starten.
{
  const before = errors.length;
  const sid = await page.evaluate(() => {
    const s = App.query("SELECT s.id FROM schueler s WHERE s.aktiv=1 AND NOT EXISTS (SELECT 1 FROM kontrolltermin_schueler k WHERE k.schueler_id=s.id) ORDER BY s.id LIMIT 1")[0];
    AzubiSeite.oeffnen(s.id); return s.id;
  });
  await page.waitForTimeout(500);
  const menue = await page.evaluate(() => { const d = document.querySelector('.az-titel details.az-termin'); return d ? [...d.querySelectorAll('.menue-liste *')].map(x => x.textContent.trim()).filter(Boolean).join('|') : ''; });
  check(/Einzeltermin jetzt starten/.test(menue) && /Einem Termin zuweisen/.test(menue), 'Azubi-Seite: Menü „Termin“ mit „Einzeltermin jetzt starten“ und „Einem Termin zuweisen“');
  // Neuen Termin für den Azubi planen
  await page.evaluate((id) => AzubiSeite.terminZuweisen(id), sid);
  await page.waitForTimeout(300);
  await page.locator('#uzArt_neu').click();
  await page.locator('#uzDatum').fill('2027-01-12');
  await page.locator('#modalContent button:has-text("Zuweisen")').click();
  await page.waitForTimeout(400);
  const nach1 = await page.evaluate((id) => ({
    knoepfe: [...document.querySelectorAll('#modalContent button')].map(b => b.textContent.trim()).join('|'),
    termin: (App.query("SELECT kt.id FROM kontrolltermin_schueler k JOIN kontrolltermine kt ON kt.id=k.kontrolltermin_id WHERE k.schueler_id=? AND kt.geplant_datum='2027-01-12'", [id])[0] || {}).id || 0,
  }), sid);
  check(nach1.termin > 0 && /Hier bleiben/.test(nach1.knoepfe) && /Termin öffnen/.test(nach1.knoepfe) && /Durchsicht öffnen/.test(nach1.knoepfe), 'Azubi einem neuen Termin zugewiesen; danach „Hier bleiben“, „Termin öffnen“, „Durchsicht öffnen“');
  await page.locator('#modalContent button:has-text("Hier bleiben")').click();
  await page.waitForTimeout(500);
  const zeile = await page.evaluate(() => { const r = document.querySelector('#azTeil_kontrollen tr.az-geplant'); return r ? r.textContent.replace(/\s+/g, ' ') : ''; });
  check(/12\.01\.2027/.test(zeile) && /geplant/.test(zeile) && /einzeln zugeordnet/.test(zeile), 'Azubi-Seite → Kontrollen zeigt den geplanten Termin (einzeln zugeordnet)');
  // Von dort in einen anderen (neuen) Termin verschieben
  await page.evaluate(([id, tid]) => AzubiSeite.terminZuweisen(id, tid), [sid, nach1.termin]);
  await page.waitForTimeout(300);
  const hatHeraus = await page.locator('#uzHeraus').count();
  await page.locator('#uzArt_neu').click();
  await page.locator('#uzDatum').fill('2027-02-09');
  if (hatHeraus) await page.locator('#uzHeraus').check();
  await page.locator('#modalContent button:has-text("Zuweisen")').click();
  await page.waitForTimeout(400);
  const nach2 = await page.evaluate(([id, tid]) => ({
    alt: App.scalar('SELECT COUNT(*) FROM kontrolltermin_schueler WHERE kontrolltermin_id=? AND schueler_id=?', [tid, id]),
    neu: App.scalar("SELECT COUNT(*) FROM kontrolltermin_schueler k JOIN kontrolltermine kt ON kt.id=k.kontrolltermin_id WHERE k.schueler_id=? AND kt.geplant_datum='2027-02-09'", [id]),
  }), [sid, nach1.termin]);
  check(hatHeraus === 1 && nach2.alt === 0 && nach2.neu === 1, 'Verschieben: Azubi steht im neuen Termin und nicht mehr im bisherigen');
  await page.evaluate(() => App.closeModal());
  await page.waitForTimeout(400);
  // Einzeltermin sofort starten → Durchsicht bei diesem Azubi
  await page.evaluate((id) => AzubiSeite.einzelterminStarten(id), sid);
  await page.waitForTimeout(900);
  // Im Demo-Modus ist noch kein Prüfer gewählt: die Durchsicht wartet und öffnet den Azubi danach
  const wartet = await page.evaluate(() => KontrolleHandler._wartetAufPruefer === true);
  if (wartet) {
    await page.evaluate(() => { const sel = document.getElementById('topbarUserSelect'); const o = [...sel.options].find(x => x.value); sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(700);
  }
  const start = await page.evaluate((id) => ({
    view: App.currentView, modus: KontrolleHandler._viewMode,
    azubi: (KontrolleHandler.currentSchuelerList[KontrolleHandler.currentIndex] || {}).id === id,
    termin: App.query('SELECT typ, geplant_datum, pruefer FROM kontrolltermine WHERE id=?', [KontrolleHandler.currentTerminId])[0] || {},
    heute: App._heuteIso(), raster: !!document.querySelector('.kw-grid'),
  }), sid);
  check(start.view === 'kontrolle' && start.modus === 'einzeln' && start.azubi && start.termin.typ === 'einsendung' && start.termin.geplant_datum === start.heute && start.raster, `„Einzeltermin jetzt starten“ öffnet die Durchsicht dieses Azubis (${start.view}/${start.modus})`);
  check(errors.length === before, 'Vom Azubi zum Termin ohne Konsolenfehler');
}

// Feldfall „Weiß“: Namen mit ß/Umlaut beim Hinzufügen zu einem Termin finden
{
  const before = errors.length;
  const r = await page.evaluate(async () => {
    // ein Azubi außerhalb der geladenen Durchsicht heißt jetzt „Weiß“, ein zweiter „Ärmel“
    const drin = new Set((KontrolleHandler.currentSchuelerList || []).map(s => s.id));
    const frei = App.query('SELECT id FROM schueler WHERE aktiv=1 ORDER BY id DESC').map(x => x.id).filter(id => !drin.has(id));
    App.run("UPDATE schueler SET nachname='Weiß' WHERE id=?", [frei[0]]);
    App.run("UPDATE schueler SET nachname='Ärmel' WHERE id=?", [frei[1]]);
    KontrolleHandler._viewMode = 'uebersicht'; KontrolleHandler.renderUebersicht();
    KontrolleHandler.showAddSchueler();
    await new Promise(z => setTimeout(z, 200));
    const suche = (q) => { KontrolleHandler._liveSearchSchueler(q); return document.getElementById('addSchuelerResults').textContent.replace(/\s+/g, ' '); };
    const a = suche('weiss'), b = suche('Weiß'), c = suche('ärmel'), d = suche('wei');
    // Termin-Dialog: Einzelne Azubis hinzufügen
    App.closeModal(); await new Promise(z => setTimeout(z, 300));
    PlanungHandler.addTermin(); await new Promise(z => setTimeout(z, 300));
    PlanungHandler._searchEinsendSchueler('weiss');
    const e = document.getElementById('mKtEinsendResults').textContent.replace(/\s+/g, ' ');
    PlanungHandler._searchEinsendSchueler('aermel');
    const f = document.getElementById('mKtEinsendResults').textContent.replace(/\s+/g, ' ');
    App.closeModal();
    return { a, b, c, d, e, f };
  });
  check(/Weiß,/.test(r.a) && /Weiß,/.test(r.b) && /Ärmel,/.test(r.c) && r.d.trim().startsWith('Weiß,'), 'Durchsicht „+ Azubi hinzufügen“: „weiss“ und „Weiß“ finden Weiß, „ärmel“ findet Ärmel, Nachname steht vorn');
  check(/Weiß/.test(r.e) && /Ärmel/.test(r.f), 'Termin-Dialog „Einzelne Azubis hinzufügen“: „weiss“ findet Weiß, „aermel“ findet Ärmel');
  await page.waitForTimeout(300);
  check(errors.length === before, 'Namenssuche ohne Konsolenfehler');
}

// ── Berichtsheft digital: Spalte „Heft · Notiz“ in der Übersicht, Einzelansicht, Abschluss-Dialog ──
console.log('\n══ Berichtsheft digital vorgelegt / nachgereicht ══');
{
  const before = errors.length;
  const r = await page.evaluate(async () => {
    const warte = (ms) => new Promise(z => setTimeout(z, ms));
    App.closeModal(); await warte(300);
    // der geplante Termin mit den meisten Azubis (frühere Blöcke legen Einzeltermine an)
    const t = App.query("SELECT id FROM kontrolltermine WHERE status='geplant' AND COALESCE(archiviert_am,'')=''")
      .map(x => ({ id: x.id, n: App.getTerminSchueler(x.id).length })).sort((a, b) => b.n - a.n)[0];
    if (!t || t.n < 2) return null;
    App.navigate('kontrolle'); await warte(300);
    if (!KontrolleHandler.activePruefer) KontrolleHandler.activePruefer = App.currentUser || App.query('SELECT name FROM pruefer WHERE aktiv=1 LIMIT 1')[0].name;
    KontrolleHandler.loadTermin(t.id); await warte(600);
    KontrolleHandler._viewMode = 'uebersicht'; KontrolleHandler.renderUebersicht(); await warte(200);
    const auswahl = [...document.querySelectorAll('.ueb-heft')], notizen = [...document.querySelectorAll('.ueb-notiz')];
    const zeilen = document.querySelectorAll('.ueb-tabelle tbody tr[data-sid]').length;
    if (auswahl.length < 2) return { zeilen, felder: auswahl.length };
    const sid = parseInt(auswahl[0].dataset.sid);
    KontrolleHandler.heftFormSetzen(sid, 'digital_offen'); await warte(200);
    const feld = document.querySelector(`.ueb-notiz[data-sid="${sid}"]`);
    feld.value = 'schickt PDF bis Freitag'; feld.dispatchEvent(new Event('change', { bubbles: true })); await warte(100);
    const ke = App.query('SELECT heft_form, heft_notiz FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [t.id, sid])[0];
    const fortschritt = document.querySelector('.fortschritt .fs-text').textContent.replace(/\s+/g, ' ');
    const sel = document.querySelector(`.ueb-heft[data-sid="${sid}"]`);
    const zeile = sel.closest('tr');
    const breite = { text: sel.scrollWidth, feld: sel.clientWidth };
    // Einzelansicht zeigt dieselben Felder
    KontrolleHandler.currentIndex = KontrolleHandler.currentSchuelerList.findIndex(x => x.id === sid);
    KontrolleHandler._viewMode = 'einzeln'; KontrolleHandler.enterSchüler(); await warte(500);
    const einzel = { form: document.getElementById('keHeftForm')?.value, notiz: document.getElementById('keHeftNotiz')?.value };
    // Abschluss-Dialog nennt das Heft und schlägt die Wiedervorlage vor
    KontrolleHandler._viewMode = 'uebersicht'; KontrolleHandler.renderUebersicht(); await warte(200);
    KontrolleHandler.abschliessen(); await warte(400);
    const wiz = document.getElementById('wizDigital');
    const abschluss = { text: wiz ? wiz.textContent.replace(/\s+/g, ' ') : '', wv: !!document.getElementById('wizDigitalWV')?.checked, frist: document.getElementById('wizDigitalFrist')?.value || '' };
    App.closeModal(); await warte(300);
    // Ergebnis eintragen → Heft liegt digital vor
    KontrolleHandler._markOK([sid]);
    const danach = App.query('SELECT heft_form, ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [t.id, sid])[0];
    KontrolleHandler.renderUebersicht();
    return { zeilen, felder: auswahl.length, notizFelder: notizen.length, ke, fortschritt, blau: /blue/.test(zeile.getAttribute('style') || ''), breite, einzel, abschluss, danach };
  });
  if (r && r.felder >= 2) {
    check(r.felder === r.zeilen && r.notizFelder === r.zeilen, `Übersicht: je Azubi eine Auswahl „Heft“ und ein Notizfeld (${r.felder}/${r.zeilen})`);
    check(r.ke.heft_form === 'digital_offen' && r.ke.heft_notiz === 'schickt PDF bis Freitag', '„Wird digital nachgereicht“ und Notiz werden gespeichert');
    check(/davon 1 wird digital nachgereicht/.test(r.fortschritt) && r.blau, `Fortschrittszeile und Zeilenfarbe zeigen das nachzureichende Heft (${r.fortschritt.slice(-70)})`);
    check(r.breite.text <= r.breite.feld + 1, `Längste Auswahl „wird digital nachgereicht“ ist nicht abgeschnitten (${r.breite.text}/${r.breite.feld})`);
    check(r.einzel.form === 'digital_offen' && r.einzel.notiz === 'schickt PDF bis Freitag', 'Einzelansicht zeigt dieselbe Vorlage und Notiz');
    check(/wird digital nachgereicht \(1\)/.test(r.abschluss.text) && /schickt PDF bis Freitag/.test(r.abschluss.text) && r.abschluss.wv && /^\d{4}-\d{2}-\d{2}$/.test(r.abschluss.frist), 'Abschluss-Dialog: Wiedervorlage mit Frist vorgeschlagen');
    check(r.danach.ergebnis === 'in_ordnung' && r.danach.heft_form === 'digital', 'Ergebnis eingetragen → Vorlage springt auf „digital“');
  } else check(true, 'Berichtsheft digital (kein passender Termin in den Demodaten – übersprungen)');
  await page.waitForTimeout(300);
  check(errors.length === before, 'Berichtsheft digital ohne Konsolenfehler');
}

// ── Teil 1 des Berichtshefts: Reihenfolge, Kennzeichnung, neue Auswahlwerte, 1.5 als Anzahl + Zusammenstellung ──
console.log('\n══ Pflichtteile und Hinweise (Teil 1) ══');
{
  const before = errors.length;
  const r = await page.evaluate(async () => {
    const warte = (ms) => new Promise(z => setTimeout(z, ms));
    App.closeModal(); await warte(300);
    const t = App.query("SELECT id FROM kontrolltermine WHERE status='geplant' AND COALESCE(archiviert_am,'')=''")
      .map(x => ({ id: x.id, n: App.getTerminSchueler(x.id).length })).sort((a, b) => b.n - a.n)[0];
    if (!t || t.n < 2) return null;
    App.navigate('kontrolle'); await warte(300);
    if (!KontrolleHandler.activePruefer) KontrolleHandler.activePruefer = App.currentUser || App.query('SELECT name FROM pruefer WHERE aktiv=1 LIMIT 1')[0].name;
    KontrolleHandler.loadTermin(t.id); await warte(600);
    KontrolleHandler._viewMode = 'einzeln'; KontrolleHandler.currentIndex = KontrolleHandler.currentSchuelerList.length - 1; KontrolleHandler.enterSchüler(); await warte(600);
    const karte = document.querySelector('.pfl-karte');
    if (!karte) return { karte: false };
    const sid = KontrolleHandler.currentSchuelerList[KontrolleHandler.currentIndex].id;
    const ke = () => App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [t.id, sid])[0];
    const waehle = async (sel, wert) => { const e = karte.querySelector(sel); e.value = wert; e.dispatchEvent(new Event('change', { bubbles: true })); await warte(150); };
    App.run("UPDATE kontrollergebnisse SET bemerkung='', p_1_1_ausbildungsplan='', p_1_4_auszubildende='', p_1_5_bescheinigungen='', p_1_5_gefuehrt='', f_1_6_ausbildungsbetrieb='' WHERE id=?", [ke().id]);
    KontrolleHandler.renderSchueler(); await warte(400);
    const k2 = document.querySelector('.pfl-karte');
    const nummern = [...k2.querySelectorAll('.pfl-nr')].map(e => e.textContent.trim()).join(' ');
    const marken = [...k2.querySelectorAll('.pfl-liste .pfl-marke')].map(e => e.textContent.trim()).join(' | ');
    const optionen14 = [...k2.querySelectorAll('[data-field="p_1_4_auszubildende"] option')].map(o => o.textContent.trim()).join(' / ');
    const w = async (sel, wert) => { const e = document.querySelector('.pfl-karte ' + sel); e.value = wert; e.dispatchEvent(new Event('change', { bubbles: true })); await warte(200); };
    await w('[data-field="p_1_4_auszubildende"]', 'unterschrift');
    await w('#keZusammenstellung', 'nein');
    await w('[data-field="f_1_6_ausbildungsbetrieb"]', 'skizze');
    await w('#keUbaAnzahl', '2');
    const nach = ke();
    const feld = document.getElementById('keBemerkung');
    return { karte: true, nummern, marken, optionen14, p14: nach.p_1_4_auszubildende, p15: nach.p_1_5_bescheinigungen, g15: nach.p_1_5_gefuehrt, f16: nach.f_1_6_ausbildungsbetrieb, anz: nach.bescheinigungen_anzahl,
      bem: nach.bemerkung, feldBem: feld ? feld.value : '', schrift: feld ? getComputedStyle(feld).fontSize : '', uba: document.getElementById('keUbaStand').textContent.trim(),
      farbe14: document.querySelector('.pfl-karte [data-field="p_1_4_auszubildende"]').className, wege: [...document.querySelectorAll('#keWeg option')].map(o => o.value).join(' ') };
  });
  if (r && r.karte) {
    check(r.nummern === '1.1 1.2 1.4 1.5 1.6', `Teile aufsteigend nach Nummern (${r.nummern})`);
    check(r.marken === 'Pflicht§ 43 | Hinweis | Pflicht | Pflicht§ 43 | Hinweis', `Kennzeichnung Pflicht / § 43 / Hinweis (${r.marken})`);
    check(r.optionen14 === '– / geführt / nicht geführt / Unterschrift fehlt / nicht vorhanden', '1.4 mit vier Auswahlwerten');
    check(r.p14 === 'unterschrift' && r.f16 === 'skizze' && r.p15 === 'ja' && r.g15 === 'nein' && r.anz === 2, 'Neue Werte werden gespeichert (1.4 Unterschrift fehlt, 1.6 Skizze, 1.5 Zusammenstellung nicht geführt, Anzahl 2)');
    check(r.bem === '1.4 Angaben zur/zum Auszubildenden: Unterschrift fehlt.\n1.5 Zusammenstellung der ÜBA-Bescheinigungen wird nicht geführt.\n1.6 Betriebsskizze fehlt.' && r.feldBem === r.bem, 'Kurze Sätze stehen in der Bemerkung (auch im Feld)');
    check(r.schrift === '14px' && /pfl-wahl--teil/.test(r.farbe14) && /^2\/\d+ \(/.test(r.uba), `Bemerkung 14 px, Auswahl eingefärbt, ÜBA-Stand „${r.uba}“`);
    check(r.wege === 'naechste_durchsicht email post persoenlich', 'Nachweisweg „fehlendes Wetter“ wird nicht mehr angeboten');
  } else check(true, 'Pflichtteile (kein passender Termin in den Demodaten – übersprungen)');
  await page.waitForTimeout(300);
  check(errors.length === before, 'Pflichtteile ohne Konsolenfehler');
}

// ── Termin der Wiedervorlage ist freiwillig: Vorschlag, ✕, „Termin im RP“ ──
console.log('\n══ Wiedervorlage: Termin freiwillig ══');
{
  const before = errors.length;
  const r = await page.evaluate(async () => {
    const warte = (ms) => new Promise(z => setTimeout(z, ms));
    App.closeModal(); await warte(300);
    if (App.currentView !== 'kontrolle' || !KontrolleHandler.currentTerminId) return null;
    const liste = KontrolleHandler.currentSchuelerList;
    const tid = KontrolleHandler.currentTerminId;
    const i = liste.findIndex(s => { const k = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, s.id])[0]; return k && !k.ergebnis; });
    if (i < 0) return null;
    KontrolleHandler._viewMode = 'einzeln'; KontrolleHandler.currentIndex = i; KontrolleHandler.enterSchüler(); await warte(600);
    const stand = () => ({ label: document.getElementById('wvLabel').textContent, datum: document.getElementById('wvDatum').value, x: document.getElementById('wvLeeren').style.display !== 'none' });
    const wv = () => App.query('SELECT w.art, w.frist_datum, w.status FROM wiedervorlagen w JOIN kontrollergebnisse k ON k.id=w.kontrollergebnis_id WHERE k.kontrolltermin_id=? AND k.schueler_id=? ORDER BY w.id DESC', [tid, liste[i].id])[0];
    KontrolleHandler.setzeBefund('maengel'); await warte(200);
    const weg = document.getElementById('keWeg');
    weg.value = 'email'; weg.dispatchEvent(new Event('change', { bubbles: true })); await warte(300);
    const email = { ...stand(), wv: wv() };
    document.getElementById('wvLeeren').click(); await warte(300);
    const leer = { ...stand(), wv: wv() };
    weg.value = 'persoenlich'; weg.dispatchEvent(new Event('change', { bubbles: true })); await warte(300);
    const rp = { ...stand(), wv: wv() };
    // aufräumen: Azubi wieder ohne Ergebnis
    KontrolleHandler.setzeBefund(''); await warte(200);
    return { email, leer, rp, text: App.wvFristText({ art: 'berichte_bis_termin_email', frist_datum: '' }) };
  });
  if (r) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(r.email.datum) && r.email.x && r.email.label === 'Wiedervorlage' && r.email.wv.frist_datum === r.email.datum, 'Mängel per E-Mail: Datum vorgeschlagen, ✕ sichtbar');
    check(r.leer.datum === '' && !r.leer.x && r.leer.wv.frist_datum === '' && r.leer.wv.status === 'offen' && r.text === 'ohne Termin', '✕ entfernt den Termin – Wiedervorlage bleibt offen, „ohne Termin“');
    check(r.rp.label === 'Termin im RP' && r.rp.datum === '' && r.rp.wv.art === 'persoenliche_vorlage_rp' && r.rp.wv.frist_datum === '', 'Persönliche Vorlage: Feld heißt „Termin im RP“ und bleibt leer');
  } else check(true, 'Wiedervorlage-Termin (kein offener Azubi in der Durchsicht – übersprungen)');
  await page.waitForTimeout(300);
  check(errors.length === before, 'Wiedervorlage-Termin ohne Konsolenfehler');
}

console.log('\n── E-Mail an die Betriebe: Tabellen und Bögen ──');
{
  const before = errors.length;
  const r = await page.evaluate(() => {
    const t = App.query("SELECT kontrolltermin_id t FROM kontrollergebnisse WHERE ergebnis!='' GROUP BY kontrolltermin_id ORDER BY COUNT(*) DESC LIMIT 1")[0];
    if (!t) return null;
    const alt = App.query('SELECT status FROM kontrolltermine WHERE id=?', [t.t])[0].status;
    App.run("UPDATE kontrolltermine SET status='durchgefuehrt' WHERE id=?", [t.t]); App.invalidateTerminCache();
    Workflows.emailBetriebIndividuell(t.t);
    const d = Workflows._individualData;
    const idx = d.betriebe.findIndex(g => g.azubis.some(a => a.ke && a.ke.ergebnis));
    const g = d.betriebe[idx]; const merk = g.email; if (!g.email) g.email = 'betrieb@example.org';
    const e = Workflows._betriebEntwurf(idx);
    const bewertet = g.azubis.filter(a => a.ke && a.ke.ergebnis);
    g.email = merk;
    App.closeModal();
    App.run('UPDATE kontrolltermine SET status=? WHERE id=?', [alt, t.t]); App.invalidateTerminCache();
    const liste = e.anhaenge.find(a => /^Checkliste_/.test(a.name));
    const pdf = liste ? new TextDecoder('latin1').decode(liste.bytes) : '';
    const checkliste = { da: !!liste, acro: /\/AcroForm/.test(pdf), kaestchen: (pdf.match(/\/FT \/Btn/g) || []).length, leer: !/\/V \/On/.test(pdf), felder: (pdf.match(/\/FT \/Tx/g) || []).length, mail: /Checkliste als PDF bei/.test(e.m.html) && /muss nicht zurückgesendet/.test(e.m.body) };
    return { checkliste, n: bewertet.length - 0, namen: e.anhaenge.filter(a => !/^Checkliste_/.test(a.name)).map(a => a.name), ok: bewertet.filter(a => a.ke.ergebnis === 'in_ordnung').length, fehlend: e.fehlend, html: /Ergebnis je Auszubildender/.test(e.m.html) && /<table/.test(e.m.html), eml: /multipart\/alternative/.test(e.eml) && /Content-Type: application\/pdf/.test(e.eml) };
  });
  if (r) {
    check(r.namen.length === r.n && !r.fehlend.length && r.eml && r.html, `Entwurf an einen Betrieb: alle ${r.n} Bögen der bewerteten Azubis (echte PDFs), HTML-Tabellen`);
    check(r.checkliste.da && r.checkliste.acro && r.checkliste.kaestchen >= 9 && r.checkliste.leer && r.checkliste.mail, `Checkliste als PDF-Formular angehängt: ${r.checkliste.kaestchen} Kästchen (leer), ${r.checkliste.felder} Felder „erledigt am“, Hinweis „keine Rücksendung“ in der E-Mail`);
    check(r.namen.every(n => /^BH-Durchsicht_(OK|Maengel)_/.test(n)) && r.namen.filter(n => /^BH-Durchsicht_OK_/.test(n)).length === r.ok, `Dateinamen nennen das Ergebnis (${r.namen[0]})`);
  } else check(true, 'Betriebs-E-Mail (kein bewerteter Termin – übersprungen)');
  check(errors.length === before, 'Betriebs-E-Mail ohne Konsolenfehler');
}

if (errors.length) {
  console.log('\n──── Konsolenfehler ────');
  [...new Set(errors)].forEach(e => console.log('  ' + e));
}
console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
await browser.close();
process.exit(failed ? 1 : 0);
