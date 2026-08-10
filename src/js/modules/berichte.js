const BerichteHandler = {
  exportKlasse() {
    const klassen = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name`);
    App.openModal('Klassenübersicht exportieren', `
      <div class="form-group"><label>Klasse auswählen</label><select class="form-control" id="mExpKlasse">
        ${klassen.map(k => `<option value="${k.id}">${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BerichteHandler.doExportKlasse()">PDF erstellen</button>`);
  },
  doExportKlasse() {
    const klasseId = document.getElementById('mExpKlasse').value;
    const klasse = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?`, [klasseId])[0];
    // Eine Zeile PRO AZUBI mit dem jeweils letzten Ergebnis. Der frühere JOIN
    // erzeugte eine Zeile je Kontrolle – wer dreimal kontrolliert wurde, stand
    // dreimal im PDF, und die Anzahl im Dateinamen war entsprechend falsch.
    const schueler = App.query(`SELECT s.*,
        (SELECT ke.ergebnis FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
           WHERE ke.schueler_id=s.id AND ke.ergebnis!='' ORDER BY kt.geplant_datum DESC LIMIT 1) AS ergebnis,
        (SELECT ke.fehltage_gesamt FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
           WHERE ke.schueler_id=s.id AND ke.ergebnis!='' ORDER BY kt.geplant_datum DESC LIMIT 1) AS fehltage_gesamt,
        (SELECT ke.bemerkung FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
           WHERE ke.schueler_id=s.id AND ke.ergebnis!='' ORDER BY kt.geplant_datum DESC LIMIT 1) AS ke_bemerkung
      FROM schueler s
      WHERE s.klasse_id=? AND s.aktiv=1 ORDER BY s.nachname`, [klasseId]);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`Berichtsheftkontrolle – ${klasse.schule} – ${klasse.klassenbezeichnung}`, 14, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    const rows = schueler.map(s => [
      s.nachname + ', ' + s.vorname,
      s.ausbildungsstaette,
      ergebnisLabel(s.ergebnis),
      s.fehltage_gesamt || '0',
      s.ke_bemerkung || ''
    ]);

    doc.autoTable({
      startY: 22,
      head: [['Name', 'Betrieb', 'Ergebnis', 'Fehltage', 'Bemerkung']],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [45, 80, 22] },
    });

    const today = todayStr().replace(/-/g,'');
    doc.save(`Klassenuebersicht_${klasse.schule}_${klasse.klassenbezeichnung}_${schueler.length}Schueler_${today}.pdf`.replace(/[\/ \\:,;]/g,'_'));
    App.closeModal();
    App.toast('PDF erstellt', 'success');
  },

  exportEinzel() {
    const termine = App.query(`SELECT kt.*
      FROM kontrolltermine kt
      ORDER BY kt.geplant_datum DESC`);
    App.openModal('Einzelnen Durchsichtsbogen exportieren', `
      <div class="form-group"><label>Kontrolltermin</label><select class="form-control" id="mExpTermin" onchange="BerichteHandler.loadSchuelerForExport(this.value)">
        <option value="">– Bitte wählen –</option>
        ${termine.map(t => `<option value="${t.id}">${esc(App.formatTerminLabel(t))}</option>`).join('')}
      </select></div>
      <div class="form-group"><label>Schüler</label><select class="form-control" id="mExpSchueler"><option value="">– Termin wählen –</option></select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BerichteHandler.doExportEinzel()">PDF erstellen</button>`);
  },
  loadSchuelerForExport(terminId) {
    const sel = document.getElementById('mExpSchueler');
    if (!terminId) { sel.innerHTML = '<option value="">– Termin wählen –</option>'; return; }
    const schueler = App.getTerminSchueler(parseInt(terminId));
    sel.innerHTML = schueler.map(s => `<option value="${s.id}">${esc(s.nachname)}, ${esc(s.vorname)}</option>`).join('');
  },
  doExportEinzel() {
    const tid = document.getElementById('mExpTermin')?.value;
    const sid = document.getElementById('mExpSchueler')?.value;
    if (!tid || !sid) return App.toast('Bitte Termin und Schüler wählen', 'error');
    PDFExport.generateSingle(parseInt(tid), parseInt(sid));
    App.closeModal();
  },

  exportStatistik() {
    App.showLoading('Excel-Dashboard wird erstellt...');
    setTimeout(() => {
    // Helper: column index (0-based) to Excel letter (0=A, 25=Z, 26=AA, 27=AB...)
    const colLetter = (n) => { let s=''; n++; while(n>0){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}return s; };
    const autoRef = (cols, rows) => `A1:${colLetter(cols-1)}${rows+1}`;
    try {
      const wb = XLSX.utils.book_new();
      const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail (Wetter)',berichte_bis_termin_email:'E-Mail (Berichte)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

      // ═══ Blatt 1: Rohdaten (alle aktiven Azubis) ═══
      const azubis = App.query(`SELECT s.*,
        COALESCE(b.name, s.ausbildungsstaette) as betrieb_name, b.ort as betrieb_ort, b.email as betrieb_email, b.telefon as betrieb_tel,
        k.klassenbezeichnung, bs.name as schule, j.bezeichnung as jahrgang,
        fr.bezeichnung as fachrichtung, fr.typ as fr_typ, fr.code as fr_code,
        (SELECT ke.ergebnis FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1) as letztes_ergebnis,
        (SELECT MAX(kt.geplant_datum) FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '') as letzte_kontrolle,
        (SELECT COUNT(*) FROM kontrollergebnisse ke WHERE ke.schueler_id=s.id AND ke.ergebnis != '') as anzahl_kontrollen,
        (SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=s.id) as fehltage_gesamt,
        (SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=s.id AND status IN ('offen','ueberfaellig')) as offene_wv
        FROM schueler s
        LEFT JOIN betriebe b ON s.betrieb_id=b.id
        LEFT JOIN klassen k ON s.klasse_id=k.id
        LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
        LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
        LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
        WHERE s.aktiv=1 ORDER BY bs.name, k.klassenbezeichnung, s.nachname`);

      const rdHeader = ['Nachname','Vorname','Geschlecht','Betrieb','Betrieb Ort','Betrieb E-Mail','Betrieb Telefon','Schule','Schule (aktuell)','LFK','Klasse','Jahrgang','Fachrichtung','Fachrichtungstyp','Lehrjahr','AV-Beginn','AV-Ende','Zuständiges Amt','Status','BAV-Status','Letztes Ergebnis','Letzte Kontrolle','Anzahl Kontrollen','Fehltage','Offene WV','iBykus-ID','Telefon','E-Mail'];
      const rdRows = azubis.map(s => {
        const ak = App.getAktuelleSchule(s);
        const lj = s.ausbildungsbeginn ? (() => { const d = new Date(s.ausbildungsbeginn); const now = new Date(); let l = now.getFullYear() - d.getFullYear(); if (now.getMonth() < d.getMonth()) l--; return Math.max(1, Math.min(4, l + 1)); })() : '';
        return [s.nachname, s.vorname, s.geschlecht||'', s.betrieb_name||'', s.betrieb_ort||'', s.betrieb_email||'', s.betrieb_tel||'',
          s.schule||'', ak.schule||'', ak.isLandesfachklasse ? 'Ja' : '', s.klassenbezeichnung||'', s.jahrgang||'',
          s.fachrichtung||'', s.fr_typ||'', lj, s.ausbildungsbeginn||'', s.ausbildungsende||'',
          s.zustaendiges_amt ? (s.zustaendiges_amt + ' ' + (App.AEMTER[s.zustaendiges_amt]||'')) : '',
          s.status||'aktiv', s.bav_status||'', eLbl[s.letztes_ergebnis]||s.letztes_ergebnis||'', s.letzte_kontrolle||'',
          s.anzahl_kontrollen||0, s.fehltage_gesamt||0, s.offene_wv||0, s.ibykus_id||'', s.telefon||'', s.email||''];
      });
      const ws1 = XLSX.utils.aoa_to_sheet([rdHeader, ...rdRows]);
      ws1['!cols'] = rdHeader.map((h,i) => ({wch: i < 2 ? 16 : i === 3 ? 25 : i === 7 || i === 8 ? 22 : 14}));
      ws1['!autofilter'] = { ref: autoRef(rdHeader.length, rdRows.length) };
      XLSX.utils.book_append_sheet(wb, ws1, 'Rohdaten');

      // ═══ Blatt 2: Schulstatistik ═══
      const schulData = App.query(`SELECT bs.name as schule, k.klassenbezeichnung, k.lehrjahr,
        COUNT(s.id) as gesamt,
        SUM(CASE WHEN ke.ergebnis='in_ordnung' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN 1 ELSE 0 END) as mangelhaft,
        SUM(CASE WHEN ke.ergebnis='' OR ke.ergebnis IS NULL THEN 1 ELSE 0 END) as unkontrolliert
        FROM schueler s
        JOIN klassen k ON s.klasse_id=k.id
        JOIN berufsschulen bs ON k.berufsschule_id=bs.id
        LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
        WHERE s.aktiv=1
        GROUP BY bs.name, k.klassenbezeichnung, k.lehrjahr
        ORDER BY bs.name, k.klassenbezeichnung`);
      const sh2Header = ['Schule','Klasse','Lehrjahr','Gesamt','In Ordnung','Mangelhaft','Unkontrolliert','OK-Quote %'];
      const sh2Rows = schulData.map(r => [r.schule, r.klassenbezeichnung, r.lehrjahr||'', r.gesamt, r.ok, r.mangelhaft, r.unkontrolliert,
        r.gesamt > 0 ? Math.round(r.ok / r.gesamt * 100) : 0]);
      // Summenzeile
      const sh2Sum = ['GESAMT','','', sh2Rows.reduce((s,r)=>s+r[3],0), sh2Rows.reduce((s,r)=>s+r[4],0), sh2Rows.reduce((s,r)=>s+r[5],0), sh2Rows.reduce((s,r)=>s+r[6],0), ''];
      if (sh2Sum[3] > 0) sh2Sum[7] = Math.round(sh2Sum[4] / sh2Sum[3] * 100);
      const ws2 = XLSX.utils.aoa_to_sheet([sh2Header, ...sh2Rows, [], sh2Sum]);
      ws2['!cols'] = [{wch:25},{wch:18},{wch:10},{wch:8},{wch:12},{wch:12},{wch:14},{wch:12}];
      ws2['!autofilter'] = { ref: autoRef(sh2Header.length, sh2Rows.length) };
      XLSX.utils.book_append_sheet(wb, ws2, 'Schulstatistik');

      // ═══ Blatt 3: Betriebsstatistik ═══
      const betriebData = App.query(`SELECT
        COALESCE(b.name, s.ausbildungsstaette) as betrieb, b.ort, b.email, b.telefon,
        COUNT(s.id) as azubi_count,
        SUM(CASE WHEN ke.ergebnis='in_ordnung' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN 1 ELSE 0 END) as mangelhaft,
        SUM(CASE WHEN ke.ergebnis='' OR ke.ergebnis IS NULL THEN 1 ELSE 0 END) as unkontrolliert
        FROM schueler s
        LEFT JOIN betriebe b ON s.betrieb_id=b.id
        LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
        WHERE s.aktiv=1
        GROUP BY COALESCE(b.name, s.ausbildungsstaette), b.ort
        ORDER BY mangelhaft DESC, betrieb`);
      const sh3Header = ['Betrieb','Ort','E-Mail','Telefon','Azubis','In Ordnung','Mangelhaft','Unkontrolliert','Mängelquote %'];
      const sh3Rows = betriebData.map(r => [r.betrieb||'', r.ort||'', r.email||'', r.telefon||'',
        r.azubi_count, r.ok, r.mangelhaft, r.unkontrolliert,
        r.azubi_count > 0 ? Math.round(r.mangelhaft / r.azubi_count * 100) : 0]);
      const ws3 = XLSX.utils.aoa_to_sheet([sh3Header, ...sh3Rows]);
      ws3['!cols'] = [{wch:28},{wch:15},{wch:25},{wch:16},{wch:8},{wch:12},{wch:12},{wch:14},{wch:14}];
      ws3['!autofilter'] = { ref: autoRef(sh3Header.length, sh3Rows.length) };
      XLSX.utils.book_append_sheet(wb, ws3, 'Betriebsstatistik');

      // ═══ Blatt 4: Fachrichtungsstatistik ═══
      const frData = App.query(`SELECT
        CASE WHEN fr.typ='Fachwerker' THEN 'FW: ' ELSE '' END || fr.bezeichnung as fachrichtung, fr.typ,
        COUNT(s.id) as gesamt,
        SUM(CASE WHEN ke.ergebnis='in_ordnung' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN 1 ELSE 0 END) as mangelhaft,
        SUM(CASE WHEN ke.ergebnis='' OR ke.ergebnis IS NULL THEN 1 ELSE 0 END) as unkontrolliert
        FROM schueler s
        JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
        LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
        WHERE s.aktiv=1
        GROUP BY fr.bezeichnung, fr.typ
        ORDER BY gesamt DESC`);
      const sh4Header = ['Fachrichtung','Typ','Gesamt','In Ordnung','Mangelhaft','Unkontrolliert','OK-Quote %'];
      const sh4Rows = frData.map(r => [r.fachrichtung, r.typ||'', r.gesamt, r.ok, r.mangelhaft, r.unkontrolliert,
        r.gesamt > 0 ? Math.round(r.ok / r.gesamt * 100) : 0]);
      const sh4Sum = ['GESAMT','', sh4Rows.reduce((s,r)=>s+r[2],0), sh4Rows.reduce((s,r)=>s+r[3],0), sh4Rows.reduce((s,r)=>s+r[4],0), sh4Rows.reduce((s,r)=>s+r[5],0), ''];
      if (sh4Sum[2] > 0) sh4Sum[6] = Math.round(sh4Sum[3] / sh4Sum[2] * 100);
      const ws4 = XLSX.utils.aoa_to_sheet([sh4Header, ...sh4Rows, [], sh4Sum]);
      ws4['!cols'] = [{wch:28},{wch:14},{wch:8},{wch:12},{wch:12},{wch:14},{wch:12}];
      ws4['!autofilter'] = { ref: autoRef(sh4Header.length, sh4Rows.length) };
      XLSX.utils.book_append_sheet(wb, ws4, 'Fachrichtungen');

      // ═══ Blatt 5: Amt-Statistik ═══
      const amtData = App.query(`SELECT s.zustaendiges_amt as amt,
        COUNT(s.id) as gesamt,
        SUM(CASE WHEN ke.ergebnis='in_ordnung' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN 1 ELSE 0 END) as mangelhaft,
        SUM(CASE WHEN ke.ergebnis='' OR ke.ergebnis IS NULL THEN 1 ELSE 0 END) as unkontrolliert
        FROM schueler s
        LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
        WHERE s.aktiv=1 AND s.zustaendiges_amt != ''
        GROUP BY s.zustaendiges_amt
        ORDER BY gesamt DESC`);
      const sh5Header = ['Amt (Code)','Amt (Name)','Gesamt','In Ordnung','Mangelhaft','Unkontrolliert','OK-Quote %'];
      const sh5Rows = amtData.map(r => [r.amt||'', App.AEMTER[r.amt]||'', r.gesamt, r.ok, r.mangelhaft, r.unkontrolliert,
        r.gesamt > 0 ? Math.round(r.ok / r.gesamt * 100) : 0]);
      const sh5Sum = ['GESAMT','', sh5Rows.reduce((s,r)=>s+r[2],0), sh5Rows.reduce((s,r)=>s+r[3],0), sh5Rows.reduce((s,r)=>s+r[4],0), sh5Rows.reduce((s,r)=>s+r[5],0), ''];
      if (sh5Sum[2] > 0) sh5Sum[6] = Math.round(sh5Sum[3] / sh5Sum[2] * 100);
      const ws5 = XLSX.utils.aoa_to_sheet([sh5Header, ...sh5Rows, [], sh5Sum]);
      ws5['!cols'] = [{wch:12},{wch:28},{wch:8},{wch:12},{wch:12},{wch:14},{wch:12}];
      ws5['!autofilter'] = { ref: autoRef(sh5Header.length, sh5Rows.length) };
      XLSX.utils.book_append_sheet(wb, ws5, 'Amt-Statistik');

      // ═══ Export ═══
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `BH-Dashboard_${todayStr()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      App.hideLoading();
      App.toast(`Excel-Dashboard exportiert (${azubis.length} Azubis, 5 Blätter)`, 'success');
    } catch(e) {
      App.hideLoading();
      console.warn('Excel-Export:', e);
      App.toast('Fehler beim Excel-Export', 'error');
    }
    }, 100);
  },

  // ── Jahresbericht-Generator ──
  // ── Gesamtpaket: Alle Exports für einen Termin auf einmal ──
  gesamtpaket(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return;
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const schueler = App.getTerminSchueler(terminId);
    const mangelCount = schueler.filter(s => {
      const ke = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
      return ke?.ergebnis && ke.ergebnis !== 'in_ordnung';
    }).length;

    App.openModal('Gesamtpaket – ' + klassenStr, `
      <p style="font-size:13px;margin-bottom:12px">${formatDate(termin.geplant_datum)} · ${esc(schule)} · ${schueler.length} Schüler · ${mangelCount} beanstandet</p>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpPDF" checked style="accent-color:var(--clr-forest)"> ▤ Durchsichtsbögen als PDF (alle ${schueler.length} Schüler)
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpCSV" ${mangelCount?'checked':''} style="accent-color:var(--clr-forest)"> Seriendruck-CSV für Betriebe (${mangelCount} beanstandet)
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpEmail" style="accent-color:var(--clr-forest)"> ✉︎ E-Mail an Schule öffnen
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpBriefe" style="accent-color:var(--clr-forest)"> ▤ PDF-Anschreiben an Betriebe
        </label>
        ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template'") ? `<label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpWord" checked style="accent-color:var(--clr-forest)"> ✎ Word-Serienbriefe (aus Vorlage)
        </label>` : ''}
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="gpStatistik" style="accent-color:var(--clr-forest)"> Excel-Dashboard
        </label>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BerichteHandler.doGesamtpaket(${terminId})">Alles exportieren</button>`);
  },

  doGesamtpaket(terminId) {
    App.closeModal();
    App.showLoading('Gesamtpaket wird erstellt…');
    let delay = 0;
    if (document.getElementById('gpPDF')?.checked) {
      setTimeout(() => PlanungHandler.exportTerminPDF(terminId), delay);
      delay += 500;
    }
    if (document.getElementById('gpCSV')?.checked) {
      setTimeout(() => Workflows.exportSeriendruckCSV(terminId), delay);
      delay += 500;
    }
    if (document.getElementById('gpBriefe')?.checked) {
      setTimeout(() => Workflows.exportSeriendruckPDF(terminId), delay);
      delay += 500;
    }
    if (document.getElementById('gpWord')?.checked) {
      setTimeout(() => Workflows.exportSeriendruckWord(terminId), delay);
      delay += 800;
    }
    if (document.getElementById('gpStatistik')?.checked) {
      setTimeout(() => BerichteHandler.exportStatistik(), delay);
      delay += 500;
    }
    if (document.getElementById('gpEmail')?.checked) {
      setTimeout(() => Workflows.emailSchule(terminId), delay);
      delay += 500;
    }
    setTimeout(() => { App.hideLoading(); App.toast('Gesamtpaket erstellt', 'success'); }, delay + 300);
  },

  jahresbericht() {
    try {
    App.showLoading('Erstelle Jahresbericht…');
    setTimeout(() => { // Allow spinner to render
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const LM = 18; const RM = 192; const PW = RM - LM;
    const COL_GREEN = [45, 80, 22];
    const COL_LIGHT = [245, 240, 232];
    const COL_GRAY = [130, 130, 130];
    const today = new Date().toLocaleDateString('de-DE');
    const sj = (() => { const now = new Date(); return now.getMonth() >= 7 ? `${now.getFullYear()}/${now.getFullYear()+1}` : `${now.getFullYear()-1}/${now.getFullYear()}`; })();

    // ── Data queries ──
    const totalSchueler = App.scalar('SELECT COUNT(*) FROM schueler WHERE aktiv=1') || 0;
    const totalInaktiv = App.scalar('SELECT COUNT(*) FROM schueler WHERE aktiv=0') || 0;
    const totalAbgeschlossen = App.scalar("SELECT COUNT(*) FROM schueler WHERE status='ap_bestanden'") || 0;
    // Alle Kontroll-Kennzahlen nur über AKTIVE Azubis: sonst zählen archivierte
    // Jahrgänge weiter als 'kontrolliert', während der Nenner nur die Aktiven
    // enthält -> die Abdeckung stieg nach jedem Jahrgangsabschluss und lief
    // über 100 %, 'noch offen' wurde negativ.
    const kontrolliert = App.scalar(`SELECT COUNT(DISTINCT ke.schueler_id) FROM kontrollergebnisse ke
      JOIN schueler s ON s.id=ke.schueler_id WHERE ke.ergebnis != '' AND s.aktiv=1`) || 0;
    const nichtKontrolliert = Math.max(0, totalSchueler - kontrolliert);
    // Kopf-Kennzahlen (nicht Ergebnis-Zeilen): Bei mehreren Durchsichten pro
    // Azubi ergab die Zeilenzählung Erfolgsquoten weit über 100 %.
    const okCount = App.scalar(`SELECT COUNT(DISTINCT ke.schueler_id) FROM kontrollergebnisse ke
      JOIN schueler s ON s.id=ke.schueler_id WHERE ke.ergebnis='in_ordnung' AND s.aktiv=1
      AND ke.schueler_id NOT IN (SELECT schueler_id FROM kontrollergebnisse WHERE ergebnis!='' AND ergebnis!='in_ordnung')`) || 0;
    const mangelCount = App.scalar(`SELECT COUNT(DISTINCT ke.schueler_id) FROM kontrollergebnisse ke
      JOIN schueler s ON s.id=ke.schueler_id WHERE ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' AND s.aktiv=1`) || 0;
    const termine = App.scalar('SELECT COUNT(*) FROM kontrolltermine WHERE status="durchgefuehrt"') || 0;
    const termineGeplant = App.scalar('SELECT COUNT(*) FROM kontrolltermine WHERE status="geplant"') || 0;
    const offeneWV = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE status IN ('offen','ueberfaellig')") || 0;
    const erledigteWV = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE status='erledigt'") || 0;
    const einsendungen = App.scalar("SELECT COUNT(*) FROM kontrolltermine WHERE typ='einsendung' AND status='durchgefuehrt'") || 0;

    // Top Mängel-Codes
    // Nur Wochen aktiver Azubis; 'H' (Fehltage) ist kein Mangelcode und wird
    // beim Aufsplitten unten einzeln aussortiert – der frühere Filter griff
    // nur bei GENAU 'H', bei "A,H" wurde das H mitgezählt.
    const topCodes = App.query(`SELECT kws.maengel_codes FROM kw_status kws
      JOIN schueler s ON s.id=kws.schueler_id
      WHERE kws.maengel_codes != '' AND s.aktiv=1`);
    const codeCount = {};
    topCodes.forEach(r => r.maengel_codes.split(',').filter(Boolean).forEach(c => { if (c !== 'H') codeCount[c] = (codeCount[c]||0) + 1; }));
    const sortedCodes = Object.entries(codeCount).sort((a,b) => b[1] - a[1]);
    const totalCodeEntries = sortedCodes.reduce((s, [,c]) => s + c, 0);
    const codeLabels = {A:'Unterschrift Azubi',B:'Unterschrift Ausbilder',C:'BS-Themen',D:'Wetter',E:'Inhaltlich lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'};

    // Per-school stats
    const schoolStats = App.query(`SELECT bs.name as schule, bs.ort,
      COUNT(DISTINCT s.id) as total,
      COUNT(DISTINCT CASE WHEN ke.ergebnis='in_ordnung' THEN s.id END) as ok,
      COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN s.id END) as mangel,
      COUNT(DISTINCT CASE WHEN ke.ergebnis IS NULL OR ke.ergebnis='' THEN s.id END) as offen
      FROM schueler s
      JOIN klassen k ON s.klasse_id=k.id
      JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
      WHERE s.aktiv=1
      GROUP BY bs.id ORDER BY bs.name`);

    // Per-Fachrichtung stats
    const frStats = App.query(`SELECT 
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'Unbekannt') as fachrichtung,
      COUNT(DISTINCT s.id) as total,
      COUNT(DISTINCT CASE WHEN ke.ergebnis='in_ordnung' THEN s.id END) as ok,
      COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN s.id END) as mangel
      FROM schueler s
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
      WHERE s.aktiv=1
      GROUP BY f.id ORDER BY total DESC`);

    // Betrieb-Ranking (top 10 problematic)
    const betriebRank = App.query(`SELECT 
      CASE WHEN b.zusatzbezeichnung != '' THEN b.zusatzbezeichnung || ' ' ELSE '' END || COALESCE(b.vorname || ' ','') || COALESCE(b.name, s.ausbildungsstaette) as betrieb,
      COUNT(DISTINCT s.id) as azubis,
      COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN ke.id END) as maengel,
      COUNT(DISTINCT CASE WHEN w.status IN ('offen','ueberfaellig') THEN w.id END) as offene_wv
      FROM schueler s
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN kontrollergebnisse ke ON s.id=ke.schueler_id
      LEFT JOIN wiedervorlagen w ON w.schueler_id=s.id
      WHERE s.aktiv=1
      GROUP BY COALESCE(b.id, s.ausbildungsstaette) HAVING maengel > 0
      ORDER BY maengel DESC LIMIT 10`);

    // ── Helper functions ──
    function drawHeader(doc, y) {
      doc.setFillColor(...COL_GREEN);
      doc.rect(LM, y, PW, 14, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold'); doc.setFontSize(14);
      doc.text('Jahresbericht Berichtsheftkontrolle Gärtner', LM + 5, y + 9);
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(`Schuljahr ${sj}`, RM - 5, y + 6, { align: 'right' });
      doc.text(`Stand: ${today}`, RM - 5, y + 10, { align: 'right' });
      return y + 18;
    }

    function drawFooter(doc, page) {
      doc.setDrawColor(...COL_GREEN); doc.setLineWidth(0.5);
      doc.line(LM, 286, RM, 286);
      doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(...COL_GRAY);
      doc.text('Regierungspräsidium Freiburg · Abt. 3 · Referat 31 · Berichtsheftkontrolle Gärtner', LM, 290);
      doc.text(`Seite ${page}`, RM, 290, { align: 'right' });
    }

    function drawSectionTitle(doc, y, title) {
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...COL_GREEN);
      doc.text(title, LM, y);
      doc.setDrawColor(...COL_GREEN); doc.setLineWidth(0.3);
      doc.line(LM, y + 1.5, LM + doc.getTextWidth(title) + 2, y + 1.5);
      return y + 6;
    }

    function drawMetric(doc, x, y, w, label, value, sub) {
      doc.setFillColor(...COL_LIGHT); doc.setDrawColor(220,215,208);
      doc.roundedRect(x, y, w, 22, 2, 2, 'FD');
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...COL_GRAY);
      doc.text(label, x + w/2, y + 6, { align: 'center' });
      doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(...COL_GREEN);
      doc.text(`${value}`, x + w/2, y + 15, { align: 'center' });
      if (sub) { doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(...COL_GRAY); doc.text(sub, x + w/2, y + 20, { align: 'center' }); }
    }

    function drawTableHeader(doc, y, cols) {
      doc.setFillColor(...COL_GREEN); doc.rect(LM, y, PW, 7, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(255,255,255);
      cols.forEach((c, i) => {
        const maxW = (i < cols.length - 1) ? (cols[i+1].x - c.x - 2) : (RM - c.x);
        const opts = c.align === 'right' ? { align: 'right', maxWidth: maxW } : c.align === 'center' ? { align: 'center', maxWidth: maxW } : { maxWidth: maxW };
        doc.text(c.label, c.x, y + 5, opts);
      });
      return y + 8;
    }

    function drawTableRow(doc, y, cols, values, stripe) {
      if (stripe) { doc.setFillColor(250,248,244); doc.rect(LM, y - 3.5, PW, 5.5, 'F'); }
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
      cols.forEach((c, i) => {
        const val = `${values[i] || ''}`;
        const maxW = (i < cols.length - 1) ? (cols[i+1].x - c.x - 2) : (RM - c.x);
        const opts = c.align === 'right' ? { align: 'right', maxWidth: maxW } : c.align === 'center' ? { align: 'center', maxWidth: maxW } : { maxWidth: maxW };
        doc.text(val.substring(0, 60), c.x, y, opts);
      });
      return y + 5.5;
    }

    // ══════════════════════════════════════
    // PAGE 1: Zusammenfassung
    // ══════════════════════════════════════
    let y = drawHeader(doc, 12);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...COL_GRAY);
    doc.text('Regierungspräsidium Freiburg · Abteilung 3 · Referat 31', LM, y); y += 7;

    // Key Metrics (6 boxes)
    const mw = (PW - 10) / 3;
    drawMetric(doc, LM, y, mw, 'Aktive Azubis', totalSchueler, nichtKontrolliert > 0 ? `${nichtKontrolliert} noch offen` : 'alle kontrolliert');
    drawMetric(doc, LM + mw + 5, y, mw, 'Kontrolliert', kontrolliert, `${totalSchueler > 0 ? Math.round(kontrolliert/totalSchueler*100) : 0}% Abdeckung`);
    drawMetric(doc, LM + 2*(mw+5), y, mw, 'In Ordnung', okCount, `${kontrolliert > 0 ? Math.round(okCount/kontrolliert*100) : 0}% Erfolgsquote`);
    y += 26;
    drawMetric(doc, LM, y, mw, 'Beanstandungen', mangelCount, '');
    drawMetric(doc, LM + mw + 5, y, mw, 'Termine', termine, einsendungen ? `davon ${einsendungen} Einsendungen` : `${termineGeplant} geplant`);
    drawMetric(doc, LM + 2*(mw+5), y, mw, 'Wiedervorlagen', offeneWV, `${erledigteWV} erledigt`);
    y += 30;

    // Mängel-Codes Ranking
    y = drawSectionTitle(doc, y, 'Häufigste Mängelcodes');
    if (sortedCodes.length) {
      const maxCodeCount = sortedCodes[0]?.[1] || 1;
      const barStartX = LM + 60;
      const barMaxW = 65;
      sortedCodes.slice(0, 9).forEach(([code, count], i) => {
        const pct = Math.round(count / totalCodeEntries * 100);
        const barW = Math.max(count / maxCodeCount * barMaxW, 2);
        // Alternating background
        if (i % 2 === 0) { doc.setFillColor(250,248,245); doc.rect(LM, y - 3.5, PW, 5.5, 'F'); }
        // Code letter
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...COL_GREEN);
        doc.text(`${code}`, LM + 1, y);
        // Label
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(80,80,80);
        doc.text(`${codeLabels[code]||code}`, LM + 7, y);
        // Bar
        doc.setFillColor(253,230,226); doc.rect(barStartX, y - 3, barW, 4, 'F');
        doc.setFillColor(192, 57, 43); doc.rect(barStartX, y - 3, Math.min(barW * 0.4, barW), 4, 'F');
        // Count + percentage
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0);
        doc.text(`${count}`, barStartX + barW + 3, y);
        doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...COL_GRAY);
        doc.text(`(${pct}%)`, barStartX + barW + 3 + doc.getTextWidth(`${count}`) + 2, y);
        y += 6;
      });
    } else {
      doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(...COL_GRAY);
      doc.text('Keine Mängel erfasst', LM, y); y += 5;
    }
    y += 5;

    // Ergebnisse pro Schule
    y = drawSectionTitle(doc, y, 'Ergebnisse pro Berufsschule');
    const sCols = [{label:'Schule',x:LM+2},{label:'Ort',x:LM+72},{label:'Azubis',x:LM+108,align:'center'},{label:'OK',x:LM+124,align:'center'},{label:'Mängel',x:LM+140,align:'center'},{label:'Offen',x:LM+156,align:'center'},{label:'Quote',x:RM-2,align:'right'}];
    y = drawTableHeader(doc, y, sCols);
    schoolStats.forEach((s, i) => {
      // Umbruch VOR der Zeile: ohne diese Prüfung liefen die letzten Zeilen
      // unter die Fußzeile bzw. aus dem Blatt heraus und fehlten im PDF.
      if (y > 268) { drawFooter(doc, doc.internal.getNumberOfPages()); doc.addPage(); y = drawHeader(doc, 12); y = drawTableHeader(doc, y, sCols); }
      const q = s.ok + s.mangel > 0 ? Math.round(s.ok / (s.ok + s.mangel) * 100) + '%' : '–';
      y = drawTableRow(doc, y, sCols, [s.schule, s.ort || '', s.total, s.ok, s.mangel, s.offen, q], i % 2 === 0);
    });
    y += 6;

    // Ergebnisse pro Fachrichtung
    if (y > 235) { drawFooter(doc, doc.internal.getNumberOfPages()); doc.addPage(); y = drawHeader(doc, 12); }
    y = drawSectionTitle(doc, y, 'Ergebnisse pro Fachrichtung');
    const fCols = [{label:'Fachrichtung',x:LM+2},{label:'Azubis',x:LM+108,align:'center'},{label:'OK',x:LM+126,align:'center'},{label:'Mängel',x:LM+144,align:'center'},{label:'Quote',x:RM-2,align:'right'}];
    y = drawTableHeader(doc, y, fCols);
    frStats.forEach((f, i) => {
      if (y > 268) { drawFooter(doc, doc.internal.getNumberOfPages()); doc.addPage(); y = drawHeader(doc, 12); y = drawTableHeader(doc, y, fCols); }
      const q = f.ok + f.mangel > 0 ? Math.round(f.ok / (f.ok + f.mangel) * 100) + '%' : '–';
      y = drawTableRow(doc, y, fCols, [f.fachrichtung, f.total, f.ok, f.mangel, q], i % 2 === 0);
    });
    y += 6;

    // Auffällige Betriebe
    if (betriebRank.length) {
      if (y > 230) { drawFooter(doc, 1); doc.addPage(); y = drawHeader(doc, 12); }
      y = drawSectionTitle(doc, y, 'Betriebe mit häufigsten Beanstandungen');
      const bCols = [{label:'#',x:LM+2},{label:'Betrieb',x:LM+10},{label:'Azubis',x:LM+115,align:'center'},{label:'Mängel',x:LM+135,align:'center'},{label:'Off. WV',x:RM-2,align:'right'}];
      y = drawTableHeader(doc, y, bCols);
      betriebRank.forEach((b, i) => {
        y = drawTableRow(doc, y, bCols, [i+1, b.betrieb, b.azubis, b.maengel, b.offene_wv || '–'], i % 2 === 0);
      });
    }

    // Zusatzinfos
    y += 8;
    if (y > 265) { drawFooter(doc, doc.internal.getNumberOfPages()); doc.addPage(); y = drawHeader(doc, 12); }
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(80);
    doc.text(`Noch geplante Termine: ${termineGeplant} · Abgeschlossene Prüflinge (AP bestanden): ${totalAbgeschlossen} · Inaktive Schüler: ${totalInaktiv}`, LM, y);

    drawFooter(doc, doc.internal.getNumberOfPages());

    // ══════════════════════════════════════
    // NEUE SEITE: Detaillierte Berufsschul-Statistik
    // ══════════════════════════════════════
    doc.addPage();
    let pageNum = doc.internal.getNumberOfPages();
    y = drawHeader(doc, 12);
    y = drawSectionTitle(doc, y, 'Detaillierte Berufsschul-Statistik');
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...COL_GRAY);
    doc.text('Aufschlüsselung der aktiven Azubis je Berufsschule nach Fachrichtung und zuständigem Amt', LM, y); y += 6;

    // Query: Per school → per Fachrichtung → count
    const schulDetail = App.query(`SELECT bs.id as bs_id, bs.name as schule, bs.ort,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'Unbekannt') as fachrichtung,
      f.typ as fr_typ, COUNT(s.id) as cnt
      FROM schueler s
      JOIN klassen k ON s.klasse_id=k.id
      JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      WHERE s.aktiv=1
      GROUP BY bs.id, f.id ORDER BY bs.name, f.typ DESC, cnt DESC`);

    // Query: Per school → per Amt → count
    const schulAmt = App.query(`SELECT bs.id as bs_id, bs.name as schule,
      s.zustaendiges_amt as amt, COUNT(s.id) as cnt
      FROM schueler s
      JOIN klassen k ON s.klasse_id=k.id
      JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      WHERE s.aktiv=1 AND s.zustaendiges_amt != ''
      GROUP BY bs.id, s.zustaendiges_amt ORDER BY bs.name, cnt DESC`);

    // Group data by school
    const schoolIds = [...new Set(schulDetail.map(r => r.bs_id))];

    schoolIds.forEach(bsId => {
      const frRows = schulDetail.filter(r => r.bs_id === bsId);
      const amtRows = schulAmt.filter(r => r.bs_id === bsId);
      if (!frRows.length) return;
      const schoolName = frRows[0].schule;
      const schoolOrt = frRows[0].ort || '';
      const schoolTotal = frRows.reduce((s, r) => s + r.cnt, 0);

      // Check page space (school header + rows)
      const neededHeight = 16 + Math.max(frRows.length, amtRows.length) * 5 + 8;
      if (y + neededHeight > 270) {
        drawFooter(doc, pageNum); doc.addPage(); pageNum = doc.internal.getNumberOfPages();
        y = drawHeader(doc, 12);
      }

      // School header bar
      doc.setFillColor(240,237,230); doc.rect(LM, y - 1, PW, 8, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...COL_GREEN);
      doc.text(`${schoolName}`, LM + 2, y + 4);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...COL_GRAY);
      if (schoolOrt) doc.text(`${schoolOrt}`, LM + 2 + doc.getTextWidth(schoolName + '  '), y + 4);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...COL_GREEN);
      doc.text(`${schoolTotal} Azubis`, RM - 2, y + 4, { align: 'right' });
      y += 10;

      // Two-column layout: left = Fachrichtungen, right = Ämter
      const midX = LM + PW * 0.52;
      const leftW = midX - LM - 4;
      const rightW = RM - midX - 2;

      // Left column header: Fachrichtungen
      doc.setFillColor(...COL_GREEN);
      doc.rect(LM, y, leftW, 5.5, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(255,255,255);
      doc.text('Fachrichtung', LM + 2, y + 4);
      doc.text('Anz.', LM + leftW - 12, y + 4, { align: 'right' });
      doc.text('%', LM + leftW - 2, y + 4, { align: 'right' });

      // Right column header: Ämter
      doc.setFillColor(...COL_GREEN);
      doc.rect(midX, y, rightW, 5.5, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(255,255,255);
      doc.text('Zuständiges Amt', midX + 2, y + 4);
      doc.text('Anz.', midX + rightW - 12, y + 4, { align: 'right' });
      doc.text('%', midX + rightW - 2, y + 4, { align: 'right' });
      y += 6.5;

      const maxRows = Math.max(frRows.length, amtRows.length);
      for (let i = 0; i < maxRows; i++) {
        if (i % 2 === 0) {
          doc.setFillColor(250,248,244);
          doc.rect(LM, y - 3, leftW, 5, 'F');
          doc.rect(midX, y - 3, rightW, 5, 'F');
        }
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(40,40,40);

        // Left: Fachrichtung
        if (i < frRows.length) {
          const fr = frRows[i];
          const isFW = fr.fr_typ === 'Fachwerker';
          if (isFW) { doc.setTextColor(180,130,20); } else { doc.setTextColor(40,40,40); }
          doc.text(fr.fachrichtung.substring(0, 35), LM + 2, y);
          doc.setTextColor(40,40,40);
          doc.text(`${fr.cnt}`, LM + leftW - 12, y, { align: 'right' });
          doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...COL_GRAY);
          doc.text(`${Math.round(fr.cnt / schoolTotal * 100)}%`, LM + leftW - 2, y, { align: 'right' });
        }

        // Right: Amt
        if (i < amtRows.length) {
          const a = amtRows[i];
          const amtName = App.AEMTER[a.amt] || a.amt;
          doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(40,40,40);
          doc.text(`${a.amt} ${amtName}`.substring(0, 30), midX + 2, y);
          doc.text(`${a.cnt}`, midX + rightW - 12, y, { align: 'right' });
          doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...COL_GRAY);
          doc.text(`${Math.round(a.cnt / schoolTotal * 100)}%`, midX + rightW - 2, y, { align: 'right' });
        }
        y += 5;
      }
      y += 4;
    });

    // Gesamtübersicht nach Amt (alle Schulen)
    if (y + 50 > 270) {
      drawFooter(doc, pageNum); doc.addPage(); pageNum = doc.internal.getNumberOfPages();
      y = drawHeader(doc, 12);
    }
    y = drawSectionTitle(doc, y + 2, 'Gesamtübersicht nach zuständigem Amt');
    const amtGesamt = App.query(`SELECT s.zustaendiges_amt as amt, COUNT(s.id) as cnt
      FROM schueler s WHERE s.aktiv=1 AND s.zustaendiges_amt != ''
      GROUP BY s.zustaendiges_amt ORDER BY cnt DESC`);
    const amtCols = [{label:'Amt',x:LM+2},{label:'Bezeichnung',x:LM+22},{label:'Azubis',x:LM+110,align:'center'},{label:'Anteil',x:RM-2,align:'right'}];
    y = drawTableHeader(doc, y, amtCols);
    amtGesamt.forEach((a, i) => {
      const pct = totalSchueler > 0 ? Math.round(a.cnt / totalSchueler * 100) + '%' : '–';
      y = drawTableRow(doc, y, amtCols, [a.amt, App.AEMTER[a.amt] || '?', a.cnt, pct], i % 2 === 0);
      if (y > 275) { drawFooter(doc, pageNum); doc.addPage(); pageNum = doc.internal.getNumberOfPages(); y = drawHeader(doc, 12); }
    });

    drawFooter(doc, pageNum);

    doc.save(`Jahresbericht_BH-Kontrolle_${sj.replace('/', '-')}_Stand-${todayStr()}.pdf`);
    App.hideLoading();
    App.toast('Jahresbericht erstellt', 'success');
    }, 50); // end setTimeout
    } catch(e) {
      console.error('Jahresbericht:', e);
      App.toast('Jahresbericht konnte nicht erstellt werden: ' + (e.message || e), 'error');
    } finally {
      App.hideLoading();
    }
  },

  // ═══════════════════════════════════════════
  //  ZULASSUNGSLISTE AP
  // ═══════════════════════════════════════════
  zulassungsliste() {
    this._zlFilter = { schule: '', fachrichtung: '', jahrgang: '', amt: '', pa: '' };
    this._renderZulassungsliste();
  },

  _renderZulassungsliste() {
    const f = this._zlFilter;
    const gf = App.gf('schueler');
    let sql = `SELECT s.*,
      COALESCE(b.name, s.ausbildungsstaette) as betrieb_display, b.ort as b_ort,
      CASE WHEN fr.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(fr.bezeichnung,'') as fachrichtung,
      fr.code as fr_code,
      j.bezeichnung as jahrgang,
      k.klassenbezeichnung, bs.name as schule,
      (SELECT ke.ergebnis FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1) as letztes_ergebnis,
      (SELECT ke2.pruefungsausschuss FROM kontrollergebnisse ke2 JOIN kontrolltermine kt2 ON ke2.kontrolltermin_id=kt2.id WHERE ke2.schueler_id=s.id ORDER BY kt2.geplant_datum DESC LIMIT 1) as pruefungsausschuss,
      (SELECT COUNT(*) FROM wiedervorlagen w WHERE w.schueler_id=s.id AND w.status IN ('offen','ueberfaellig')) as offene_wv,
      (SELECT COUNT(*) FROM kw_status kws WHERE kws.schueler_id=s.id AND kws.maengel_codes != '' AND kws.maengel_codes != 'H') as offene_maengel
      FROM schueler s
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      WHERE s.ap_zugelassen=1 AND s.aktiv=1${gf}`;
    const params = [];
    if (f.schule) { sql += ' AND bs.name=?'; params.push(f.schule); }
    if (f.fachrichtung) { sql += ' AND s.fachrichtung_id=?'; params.push(parseInt(f.fachrichtung)); }
    if (f.jahrgang) { sql += ' AND s.jahrgang_id=?'; params.push(parseInt(f.jahrgang)); }
    if (f.amt) { sql += ' AND s.zustaendiges_amt=?'; params.push(f.amt); }
    if (f.pa === 'ja') sql += ' AND s.id IN (SELECT ke3.schueler_id FROM kontrollergebnisse ke3 WHERE ke3.pruefungsausschuss=1)';
    if (f.pa === 'nein') sql += ' AND s.id NOT IN (SELECT ke3.schueler_id FROM kontrollergebnisse ke3 WHERE ke3.pruefungsausschuss=1)';
    sql += ' ORDER BY bs.name, fr.bezeichnung, s.nachname';
    const azubis = App.query(sql, params);

    const schulen = App.query(`SELECT DISTINCT bs.name FROM schueler s JOIN klassen k ON s.klasse_id=k.id JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE s.ap_zugelassen=1 AND s.aktiv=1${gf} ORDER BY bs.name`);
    const frs = App.query(`SELECT DISTINCT fr.id, CASE WHEN fr.typ='Fachwerker' THEN 'FW: ' ELSE '' END || fr.bezeichnung as label FROM schueler s JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE s.ap_zugelassen=1 AND s.aktiv=1${gf} ORDER BY fr.bezeichnung`);
    const jgs = App.query(`SELECT DISTINCT j.id, j.bezeichnung FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id WHERE s.ap_zugelassen=1 AND s.aktiv=1${gf} ORDER BY j.jahr DESC`);
    const aemter = App.query(`SELECT DISTINCT s.zustaendiges_amt FROM schueler s WHERE s.ap_zugelassen=1 AND s.aktiv=1 AND s.zustaendiges_amt!=''${gf} ORDER BY s.zustaendiges_amt`);

    const ampelIcon = (e) => !e ? '<span style="color:var(--clr-sage-light)">○</span>' : e === 'in_ordnung' ? '<span style="color:var(--clr-green)">●</span>' : '<span style="color:var(--clr-red)">◆</span>';
    const ergebnisLabel = {in_ordnung:'OK',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail',berichte_bis_termin_email:'E-Mail',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

    App.openModal(`${svgIcon('abschluss', 17)} Zulassungsliste AP (${azubis.length} Azubis)`, `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        <select class="form-control" style="width:auto;font-size:12px" onchange="BerichteHandler._zlFilter.schule=this.value;BerichteHandler._renderZulassungsliste()">
          <option value="">Alle Schulen</option>${schulen.map(s => `<option value="${esc(s.name)}" ${f.schule===s.name?'selected':''}>${esc(s.name)}</option>`).join('')}
        </select>
        <select class="form-control" style="width:auto;font-size:12px" onchange="BerichteHandler._zlFilter.fachrichtung=this.value;BerichteHandler._renderZulassungsliste()">
          <option value="">Alle Fachrichtungen</option>${frs.map(fr => `<option value="${fr.id}" ${f.fachrichtung==fr.id?'selected':''}>${esc(fr.label)}</option>`).join('')}
        </select>
        <select class="form-control" style="width:auto;font-size:12px" onchange="BerichteHandler._zlFilter.jahrgang=this.value;BerichteHandler._renderZulassungsliste()">
          <option value="">Alle Jahrgänge</option>${jgs.map(j => `<option value="${j.id}" ${f.jahrgang==j.id?'selected':''}>${esc(j.bezeichnung)}</option>`).join('')}
        </select>
        <select class="form-control" style="width:auto;font-size:12px" onchange="BerichteHandler._zlFilter.amt=this.value;BerichteHandler._renderZulassungsliste()">
          <option value="">Alle Ämter</option>${aemter.map(a => `<option value="${esc(a.zustaendiges_amt)}" ${f.amt===a.zustaendiges_amt?'selected':''}>${a.zustaendiges_amt} ${App.AEMTER[a.zustaendiges_amt]||''}</option>`).join('')}
        </select>
        <select class="form-control" style="width:auto;font-size:12px" onchange="BerichteHandler._zlFilter.pa=this.value;BerichteHandler._renderZulassungsliste()">
          <option value="">PA: Alle</option><option value="ja" ${f.pa==='ja'?'selected':''}>Prüfungsausschuss</option><option value="nein" ${f.pa==='nein'?'selected':''}>Kein PA</option>
        </select>
      </div>
      ${azubis.length ? `<div style="overflow-x:auto;max-height:400px;overflow-y:auto">
        <table class="data-table" style="font-size:12px" id="zlTable">
          <thead><tr><th></th><th>Name</th><th>Betrieb</th><th>Schule/Klasse</th><th>FR</th><th>JG</th><th>Ergebnis</th><th>WV</th><th>PA</th></tr></thead>
          <tbody>${azubis.map(s => `<tr>
            <td style="text-align:center">${ampelIcon(s.letztes_ergebnis)}</td>
            <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}</td>
            <td style="font-size:11px">${esc(s.betrieb_display||'')}${s.b_ort ? ' <span style="color:var(--clr-text-light)">('+esc(s.b_ort)+')</span>' : ''}</td>
            <td style="font-size:11px">${esc(s.schule||'')} <span style="color:var(--clr-text-light)">${esc(s.klassenbezeichnung||'')}</span></td>
            <td style="font-size:11px">${esc(s.fachrichtung||'')}</td>
            <td>${esc(s.jahrgang||'')}</td>
            <td>${s.letztes_ergebnis ? `<span class="badge-status ${s.letztes_ergebnis==='in_ordnung'?'badge-ok':'badge-open'}" style="font-size:10px">${ergebnisLabel[s.letztes_ergebnis]||s.letztes_ergebnis}</span>` : '–'}</td>
            <td style="text-align:center">${s.offene_wv > 0 ? `<span style="color:var(--clr-red);font-weight:700">${s.offene_wv}</span>` : '–'}</td>
            <td style="text-align:center">${s.pruefungsausschuss ? '<span style="color:var(--clr-red);font-weight:700">PA</span>' : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : '<p style="text-align:center;color:var(--clr-text-light);padding:20px">Keine zugelassenen Azubis mit diesen Filtern gefunden.</p>'}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-sm btn-secondary" onclick="BerichteHandler.exportZulassungExcel()">Excel</button>
        <button class="btn btn-primary" onclick="BerichteHandler.exportZulassungPDF()">▤ PDF</button>`);
    _makeModalWide();
  },

  exportZulassungExcel() {
    if (typeof XLSX === 'undefined') return App.toast('Excel-Bibliothek nicht geladen', 'error');
    const f = this._zlFilter;
    const gf = App.gf('schueler');
    let sql = `SELECT s.nachname, s.vorname, COALESCE(b.name, s.ausbildungsstaette) as betrieb, b.ort,
      CASE WHEN fr.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(fr.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jahrgang, bs.name as schule, k.klassenbezeichnung,
      s.ausbildungsbeginn, s.ausbildungsende, s.zustaendiges_amt,
      (SELECT ke.ergebnis FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1) as letztes_ergebnis,
      (SELECT ke2.pruefungsausschuss FROM kontrollergebnisse ke2 JOIN kontrolltermine kt2 ON ke2.kontrolltermin_id=kt2.id WHERE ke2.schueler_id=s.id ORDER BY kt2.geplant_datum DESC LIMIT 1) as pa
      FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      WHERE s.ap_zugelassen=1 AND s.aktiv=1${gf}`;
    const params = [];
    if (f.schule) { sql += ' AND bs.name=?'; params.push(f.schule); }
    if (f.fachrichtung) { sql += ' AND s.fachrichtung_id=?'; params.push(parseInt(f.fachrichtung)); }
    if (f.jahrgang) { sql += ' AND s.jahrgang_id=?'; params.push(parseInt(f.jahrgang)); }
    if (f.amt) { sql += ' AND s.zustaendiges_amt=?'; params.push(f.amt); }
    // PA-Filter MUSS identisch zur Modal-Anzeige sein — sonst exportiert man andere Azubis als angezeigt!
    if (f.pa === 'ja') sql += ' AND s.id IN (SELECT ke3.schueler_id FROM kontrollergebnisse ke3 WHERE ke3.pruefungsausschuss=1)';
    if (f.pa === 'nein') sql += ' AND s.id NOT IN (SELECT ke3.schueler_id FROM kontrollergebnisse ke3 WHERE ke3.pruefungsausschuss=1)';
    sql += ' ORDER BY bs.name, fr.bezeichnung, s.nachname';
    const data = App.query(sql, params);
    if (!data.length) return App.toast('Keine Daten zum Exportieren', 'warning');

    const ws = XLSX.utils.json_to_sheet(data.map(s => ({
      'Nachname': s.nachname, 'Vorname': s.vorname, 'Betrieb': s.betrieb, 'Ort': s.ort,
      'Fachrichtung': s.fachrichtung, 'Jahrgang': s.jahrgang, 'Schule': s.schule, 'Klasse': s.klassenbezeichnung,
      'AV-Beginn': s.ausbildungsbeginn, 'AV-Ende': s.ausbildungsende, 'Amt': s.zustaendiges_amt,
      'Letztes Ergebnis': s.letztes_ergebnis || '',
      'Prüfungsausschuss': s.pa ? 'Ja' : ''
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Zulassungsliste');
    XLSX.writeFile(wb, `Zulassungsliste_AP_${todayStr()}.xlsx`);
    App.toast(`${data.length} Azubis exportiert`, 'success');
  },

  exportZulassungPDF() {
    const table = document.getElementById('zlTable');
    if (!table) return App.toast('Keine Tabelle gefunden', 'error');
    if (!window.jspdf) return App.toast('PDF-Bibliothek nicht geladen', 'error');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(45, 80, 22);
    doc.text('Zulassungsliste Abschlussprüfung', 20, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 120, 120);
    const filterParts = [];
    if (this._zlFilter.schule) filterParts.push('Schule: ' + this._zlFilter.schule);
    if (this._zlFilter.jahrgang) filterParts.push('JG: ' + App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [this._zlFilter.jahrgang]));
    if (this._zlFilter.fachrichtung) filterParts.push('FR: ' + App.scalar('SELECT bezeichnung FROM fachrichtungen WHERE id=?', [this._zlFilter.fachrichtung]));
    if (this._zlFilter.amt) filterParts.push('Amt: ' + this._zlFilter.amt);
    doc.text(`Stand: ${new Date().toLocaleDateString('de-DE')}${filterParts.length ? ' · Filter: ' + filterParts.join(', ') : ''}`, 20, 24);

    // Ampel-Emojis → Text (jsPDF helvetica kann keine Emojis → Müll-Zeichen)
    const ampelText = { '○': '–', '●': 'OK', '◆': 'Mangel', '◐': 'Achtung' };
    const rows = [...table.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map((td, i) => {
        const t = td.textContent.trim();
        return i === 0 ? (ampelText[t] ?? t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '')) : t;
      })
    );
    const head = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim() || 'Status');

    doc.autoTable({
      startY: 30, margin: { left: 14, right: 14 },
      head: [head], body: rows,
      styles: { fontSize: 9, cellPadding: 2.5, lineWidth: 0.2 },
      headStyles: { fillColor: [45, 80, 22], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 247, 242] },
      theme: 'grid',
    });

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
      doc.text('Berichtsheftkontrolle · RP Freiburg', 14, 200);
      doc.text(`Seite ${i} / ${totalPages}`, 267, 200);
    }

    doc.save(`Zulassungsliste_AP_${todayStr()}.pdf`);
    App.toast('PDF erstellt', 'success');
  },

  // ════════════════════════════════════════════
  //  DATENQUALITÄTS-PRÜFUNG (IBYKUS-Datenbestand)
  //  Korrekturen erfolgen in IBYKUS (Datenfluss ist einbahnig) – der Export
  //  dient der Assistenz als Abarbeitungsliste.
  // ════════════════════════════════════════════
  _dqIssues: [],
  _dqFilter: { sev: '', kat: '' },

  _dqValidDate(d) { return !d || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00').getTime())); },
  _dqMonate(von, bis) {
    const a = new Date(von + 'T00:00:00'), b = new Date(bis + 'T00:00:00');
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  },

  _dqRun() {
    const issues = [];
    const add = (sev, kat, name, problem, feld, action, ibykusId) =>
      issues.push({ sev, kat, name, problem, feld, action, ibykusId: ibykusId || '' });

    // ── Azubis ──
    const alle = App.query(`SELECT s.*, k.jahrgang_id AS klassen_jg, k.klassenbezeichnung, b.name AS b_name,
        b.email AS b_email, b.telefon AS b_tel, j.bezeichnung AS jahrgang, j.jahr AS jg_jahr
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id`);
    const heute = todayStr();
    const seenIbk = {};
    const seenPerson = {};
    alle.forEach(s => {
      if (s.ibykus_id) (seenIbk[s.ibykus_id] = seenIbk[s.ibykus_id] || []).push(s);
      const pKey = ((s.nachname || '') + '|' + (s.vorname || '') + '|' + (s.geburtsdatum || '')).toLowerCase();
      if (s.nachname && s.geburtsdatum) (seenPerson[pKey] = seenPerson[pKey] || []).push(s);
    });

    alle.forEach(s => {
      const nm = `${s.nachname || '?'}, ${s.vorname || '?'}`;
      const edit = () => { App.closeModal(); ImportHandler.editSchueler(s.id); };
      // Ungültige Datumsformate zuerst (verhindert Folge-Fehlalarme)
      let datesOk = true;
      [['ausbildungsbeginn', s.ausbildungsbeginn], ['ausbildungsende', s.ausbildungsende], ['geburtsdatum', s.geburtsdatum]].forEach(([f, v]) => {
        if (!this._dqValidDate(v)) { add('fehler', 'Azubi', nm, `Ungültiges Datum: "${v}"`, f, edit, s.ibykus_id); datesOk = false; }
      });
      if (!s.ibykus_id) add('fehler', 'Azubi', nm, 'Keine IBYKUS-ID – Datensatz nicht zuordenbar', 'ibykus_id', edit, '');
      if (s.aktiv) {
        if (!s.ausbildungsbeginn) add('fehler', 'Azubi', nm, 'Ausbildungsbeginn fehlt', 'ausbildungsbeginn', edit, s.ibykus_id);
        if (!s.ausbildungsende) add('fehler', 'Azubi', nm, 'Ausbildungsende fehlt', 'ausbildungsende', edit, s.ibykus_id);
        if (!s.betrieb_id && !s.ausbildungsstaette) add('fehler', 'Azubi', nm, 'Kein Ausbildungsbetrieb zugeordnet', 'betrieb', edit, s.ibykus_id);
        if (!s.klasse_id) add('warnung', 'Azubi', nm, 'Keine Klasse/Berufsschule zugeordnet', 'klasse', edit, s.ibykus_id);
        if (!s.jahrgang_id) add('warnung', 'Azubi', nm, 'Kein Abschlussjahrgang zugeordnet', 'jahrgang', edit, s.ibykus_id);
        if (!s.fachrichtung_id) add('warnung', 'Azubi', nm, 'Keine Fachrichtung zugeordnet', 'fachrichtung', edit, s.ibykus_id);
        if (!s.geburtsdatum) add('warnung', 'Azubi', nm, 'Geburtsdatum fehlt (Urlaubs-/JArbSchG-Berechnung)', 'geburtsdatum', edit, s.ibykus_id);
        if (!s.email && !s.telefon && !s.b_email && !s.b_tel) add('warnung', 'Azubi', nm, 'Nicht erreichbar: weder eigene noch Betriebs-Kontaktdaten', 'email/telefon', edit, s.ibykus_id);
        if (datesOk && s.ausbildungsende && s.ausbildungsende < heute) {
          const m = this._dqMonate(s.ausbildungsende, heute);
          if (m >= 6) add('warnung', 'Azubi', nm, `Aktiv, aber Ausbildungsende liegt ${m} Monate zurück – beendet?`, 'aktiv/ende', edit, s.ibykus_id);
        }
      } else if (!s.inaktiv_grund) {
        add('hinweis', 'Azubi', nm, 'Inaktiv ohne hinterlegten Grund', 'inaktiv_grund', edit, s.ibykus_id);
      }
      if (datesOk && s.ausbildungsbeginn && s.ausbildungsende) {
        if (s.ausbildungsende <= s.ausbildungsbeginn) add('fehler', 'Azubi', nm, 'Ausbildungsende liegt vor dem Beginn', 'beginn/ende', edit, s.ibykus_id);
        else {
          const dauer = this._dqMonate(s.ausbildungsbeginn, s.ausbildungsende);
          if (dauer < 12 || dauer > 54) add('warnung', 'Azubi', nm, `Unplausible Ausbildungsdauer: ${dauer} Monate`, 'beginn/ende', edit, s.ibykus_id);
        }
      }
      if (datesOk && s.geburtsdatum && s.ausbildungsbeginn) {
        const alter = this._dqMonate(s.geburtsdatum, s.ausbildungsbeginn) / 12;
        if (alter < 14 || alter > 60) add('warnung', 'Azubi', nm, `Unplausibles Alter bei Ausbildungsbeginn: ${Math.round(alter)} Jahre`, 'geburtsdatum', edit, s.ibykus_id);
      }
      if (s.jahrgang_id && s.klassen_jg && s.jahrgang_id !== s.klassen_jg) {
        add('warnung', 'Azubi', nm, `Jahrgang des Azubis weicht vom Jahrgang der Klasse ${s.klassenbezeichnung || ''} ab`, 'jahrgang/klasse', edit, s.ibykus_id);
      }
      if (datesOk && s.jg_jahr && s.ausbildungsende) {
        const endeJahr = parseInt(s.ausbildungsende.substring(0, 4));
        if (Math.abs(endeJahr - s.jg_jahr) > 1) add('hinweis', 'Azubi', nm, `Jahrgang ${s.jahrgang} passt nicht zum Ausbildungsende ${endeJahr}`, 'jahrgang/ende', edit, s.ibykus_id);
      }
    });
    Object.values(seenIbk).filter(g => g.length > 1).forEach(g => {
      g.forEach(s => add('fehler', 'Azubi', `${s.nachname}, ${s.vorname}`, `IBYKUS-ID ${s.ibykus_id} ist ${g.length}× vergeben`, 'ibykus_id', () => { App.closeModal(); ImportHandler.editSchueler(s.id); }, s.ibykus_id));
    });
    Object.values(seenPerson).filter(g => g.length > 1).forEach(g => {
      g.forEach(s => add('warnung', 'Azubi', `${s.nachname}, ${s.vorname}`, `Mögliches Duplikat: Name + Geburtsdatum ${g.length}× vorhanden`, 'duplikat', () => { App.closeModal(); ImportHandler.editSchueler(s.id); }, s.ibykus_id));
    });

    // ── Betriebe ──
    const betriebe = App.query(`SELECT b.*, (SELECT COUNT(*) FROM schueler WHERE betrieb_id=b.id AND aktiv=1) AS cnt FROM betriebe b`);
    const seenBnr = {}, seenBName = {};
    betriebe.forEach(b => {
      if (b.betriebsnummer) (seenBnr[b.betriebsnummer] = seenBnr[b.betriebsnummer] || []).push(b);
      const key = ((b.name || '') + '|' + (b.ort || '')).toLowerCase();
      if (b.name) (seenBName[key] = seenBName[key] || []).push(b);
      const edit = () => { App.closeModal(); StammdatenTab.editBetrieb(b.id); };
      if (b.cnt > 0) {
        if (!b.ort) add('warnung', 'Betrieb', b.name || '?', 'Kein Ort/Adresse hinterlegt', 'ort', edit);
        if (!b.telefon && !b.email) add('warnung', 'Betrieb', b.name || '?', `Kein Kontakt (${b.cnt} aktive Azubis) – Anschreiben unmöglich`, 'telefon/email', edit);
        if (!b.betriebsnummer) add('hinweis', 'Betrieb', b.name || '?', 'Betriebsnummer fehlt (Import-Zuordnung unsicher)', 'betriebsnummer', edit);
      }
    });
    Object.values(seenBnr).filter(g => g.length > 1).forEach(g => {
      g.forEach(b => add('warnung', 'Betrieb', b.name || '?', `Betriebsnummer ${b.betriebsnummer} ist ${g.length}× vergeben`, 'betriebsnummer', () => { App.closeModal(); StammdatenTab.editBetrieb(b.id); }));
    });
    Object.values(seenBName).filter(g => g.length > 1).forEach(g => {
      g.forEach(b => add('hinweis', 'Betrieb', b.name || '?', `Mögliches Duplikat: Name+Ort ${g.length}× vorhanden`, 'duplikat', () => { App.closeModal(); StammdatenTab.editBetrieb(b.id); }));
    });

    // ── Klassen / Schulen ──
    App.query(`SELECT k.*, bs.name AS schule, (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) AS cnt
      FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id`).forEach(k => {
      const edit = () => { App.closeModal(); StammdatenTab.editKlasse(k.id); };
      if (k.cnt > 0 && !k.lehrjahr) add('hinweis', 'Klasse', `${k.klassenbezeichnung} (${k.schule || '?'})`, 'Kein Lehrjahr gepflegt (Anzeige nutzt Fallback-Berechnung)', 'lehrjahr', edit);
      if (k.cnt > 0 && !k.jahrgang_id) add('hinweis', 'Klasse', `${k.klassenbezeichnung} (${k.schule || '?'})`, 'Kein Jahrgang zugeordnet', 'jahrgang', edit);
    });
    App.query(`SELECT bs.*, (SELECT COUNT(*) FROM schueler s JOIN klassen k ON s.klasse_id=k.id WHERE k.berufsschule_id=bs.id AND s.aktiv=1) AS cnt FROM berufsschulen bs`).forEach(sc => {
      if (sc.cnt > 0 && !sc.email) add('warnung', 'Schule', sc.name, `Keine E-Mail hinterlegt (${sc.cnt} aktive Azubis) – Anschreiben unmöglich`, 'email', () => { App.closeModal(); StammdatenTab.editSchule(sc.id); });
    });

    const rank = { fehler: 0, warnung: 1, hinweis: 2 };
    issues.sort((a, b) => rank[a.sev] - rank[b.sev] || a.kat.localeCompare(b.kat) || a.name.localeCompare(b.name));
    return issues;
  },

  datenqualitaet() {
    this._dqIssues = this._dqRun();
    this._dqFilter = { sev: '', kat: '' };
    const nF = this._dqIssues.filter(i => i.sev === 'fehler').length;
    const nW = this._dqIssues.filter(i => i.sev === 'warnung').length;
    const nH = this._dqIssues.filter(i => i.sev === 'hinweis').length;
    const gesamt = App.scalar('SELECT COUNT(*) FROM schueler') || 0;
    const betroffen = new Set(this._dqIssues.filter(i => i.kat === 'Azubi' && i.sev !== 'hinweis').map(i => i.name)).size;
    const score = gesamt ? Math.max(0, Math.round(100 * (1 - betroffen / gesamt))) : 100;
    const scoreColor = score >= 90 ? 'var(--clr-green)' : score >= 70 ? 'var(--clr-amber)' : 'var(--clr-red)';

    App.openModal('Datenqualität IBYKUS-Datenbestand', `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <div style="font-size:26px;font-weight:700;color:${scoreColor};font-family:var(--font-display)">${score}%</div>
        <div style="font-size:11px;color:var(--clr-text-light);line-height:1.4">Qualitäts-Score<br>(Azubis ohne Fehler/Warnung)</div>
        <span style="margin-left:auto"></span>
        <span class="badge-status badge-overdue" style="cursor:pointer" onclick="BerichteHandler._dqSetFilter('sev','fehler')">${nF} Fehler</span>
        <span class="badge-status badge-open" style="cursor:pointer" onclick="BerichteHandler._dqSetFilter('sev','warnung')">${nW} Warnungen</span>
        <span class="badge-status" style="cursor:pointer;background:var(--clr-warm);color:var(--clr-text-light)" onclick="BerichteHandler._dqSetFilter('sev','hinweis')">${nH} Hinweise</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <select class="form-control" style="width:auto;font-size:12px;padding:4px 8px" onchange="BerichteHandler._dqSetFilter('sev',this.value)">
          <option value="">Alle Schweregrade</option>
          <option value="fehler">Nur Fehler</option>
          <option value="warnung">Nur Warnungen</option>
          <option value="hinweis">Nur Hinweise</option>
        </select>
        <select class="form-control" style="width:auto;font-size:12px;padding:4px 8px" onchange="BerichteHandler._dqSetFilter('kat',this.value)">
          <option value="">Alle Kategorien</option>
          <option value="Azubi">Azubis</option>
          <option value="Betrieb">Betriebe</option>
          <option value="Klasse">Klassen</option>
          <option value="Schule">Schulen</option>
        </select>
        <span style="font-size:11px;color:var(--clr-text-light)">Spalten-Klick sortiert · Zeilen-Klick öffnet den Datensatz</span>
      </div>
      <div id="dqTableWrap" style="max-height:55vh;overflow:auto"></div>
      <p style="font-size:11px;color:var(--clr-text-light);margin-top:8px">Wichtig: Korrekturen an IBYKUS-Stammdaten in <strong>IBYKUS</strong> vornehmen (der nächste Import überschreibt lokale Änderungen). Der Excel-Export dient als Abarbeitungsliste für die Assistenz.</p>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-secondary" onclick="BerichteHandler.datenqualitaet()">↻ Neu prüfen</button>
        <button class="btn btn-primary" onclick="BerichteHandler.exportDatenqualitaet()">Excel-Export</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
    this._dqRenderTable();
  },

  _dqSetFilter(key, val) {
    this._dqFilter[key] = this._dqFilter[key] === val ? '' : val;
    this._dqRenderTable();
  },

  _dqFiltered() {
    return this._dqIssues.filter(i =>
      (!this._dqFilter.sev || i.sev === this._dqFilter.sev) &&
      (!this._dqFilter.kat || i.kat === this._dqFilter.kat));
  },

  _dqRenderTable() {
    const wrap = document.getElementById('dqTableWrap');
    if (!wrap) return;
    const list = this._dqFiltered();
    if (!list.length) {
      wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--clr-green);font-weight:600">✓ Keine Befunde' + (this._dqFilter.sev || this._dqFilter.kat ? ' (Filter aktiv)' : ' – Datenbestand sauber') + '</div>';
      return;
    }
    const sevBadge = { fehler: '<span class="badge-status badge-overdue">Fehler</span>', warnung: '<span class="badge-status badge-open">Warnung</span>', hinweis: '<span class="badge-status" style="background:var(--clr-warm);color:var(--clr-text-light)">Hinweis</span>' };
    const sevRank = { fehler: 0, warnung: 1, hinweis: 2 };
    wrap.innerHTML = `<table class="data-table" style="font-size:12px"><thead><tr>
        <th>Schweregrad</th><th>Kategorie</th><th>Datensatz</th><th>IBYKUS-ID</th><th>Problem</th><th>Feld</th>
      </tr></thead><tbody>
      ${list.map((i, idx) => `<tr style="cursor:pointer" onclick="BerichteHandler._dqOpen(${idx})">
        <td data-sort="${sevRank[i.sev]}">${sevBadge[i.sev]}</td>
        <td>${esc(i.kat)}</td>
        <td><strong>${esc(i.name)}</strong></td>
        <td style="font-size:11px;color:var(--clr-text-light)">${esc(i.ibykusId || '–')}</td>
        <td>${esc(i.problem)}</td>
        <td style="font-size:11px;color:var(--clr-text-light)">${esc(i.feld)}</td>
      </tr>`).join('')}
      </tbody></table>`;
    this._dqRendered = list;
    setTimeout(() => { if (typeof TableSort !== 'undefined') TableSort.initAll(); }, 50);
  },

  _dqOpen(idx) {
    const i = (this._dqRendered || [])[idx];
    if (i && i.action) i.action();
  },

  exportDatenqualitaet() {
    if (typeof XLSX === 'undefined') return App.toast('Excel-Bibliothek nicht geladen', 'error');
    const list = this._dqFiltered();
    if (!list.length) return App.toast('Keine Befunde zum Exportieren', 'info');
    const rows = list.map(i => ({
      Schweregrad: i.sev === 'fehler' ? 'Fehler' : i.sev === 'warnung' ? 'Warnung' : 'Hinweis',
      Kategorie: i.kat,
      Datensatz: i.name,
      'IBYKUS-ID': i.ibykusId || '',
      Problem: i.problem,
      Feld: i.feld,
      'Korrigiert in IBYKUS am': '',
      'Bearbeitet von': '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 9 }, { wch: 28 }, { wch: 12 }, { wch: 60 }, { wch: 16 }, { wch: 20 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datenqualität');
    XLSX.writeFile(wb, `Datenqualitaet_IBYKUS_${todayStr()}.xlsx`);
    App.toast(`${rows.length} Befunde exportiert`, 'success');
  }
};
