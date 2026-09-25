const PDFExport = {
  generateBatch(transform, termin, terminId, schuelerList, opts) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const kwRows = [[36,37,38,39,40,41,42,43,44,45,46,47,48],[49,50,51,52,1,2,3,4,5,6,7,8,9],[10,11,12,13,14,15,16,17,18,19,20,21,22],[23,24,25,26,27,28,29,30,31,32,33,34,35]];
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bis nächste Durchsicht',sachberichte_wetter_email:'Sachberichte (Wetter) per E-Mail',berichte_bis_termin_email:'Berichte per E-Mail bis Termin',persoenliche_vorlage_rp:'Persönliche Vorlage im RP',post_an_rp:'Per Post ans RP'};
    const codeLabels = {A:'Unterschrift Azubi',B:'Unterschrift Ausbilder',C:'Berufsschulthemen',D:'Wetter',E:'Inhaltlich lückenhaft',F:'Berichte fehlen komplett',G:'Datum/KW falsch',H:'Fehltage',I:'Sonstiges'};
    const LM = 10; // left margin
    const RM = 200; // right margin (210 - 10)
    const PW = RM - LM; // page width usable = 190
    const CW = PW / 13; // cell width = ~14.6mm
    // Zellhöhe: bei vier oder mehr Rastern (März-Beginner, Verlängerer) flacher,
    // damit Raster, Pflichtteile und Ergebnis möglichst auf eine Seite passen
    const CH_STD = 10;

    // Farben nach Landes-CI (wie die Oberfläche): Warm-Schwarz als Primär-
    // farbe, BaWü-Gelb als Akzent, warme Grautöne für Flächen und Linien.
    // Grün, Rot und Orange bleiben reine Statusfarben.
    const COL_INK = [42, 38, 35];         // --clr-forest (BaWü Warm-Schwarz)
    const COL_GELB = [255, 252, 0];       // --clr-gelb
    const COL_GREEN = [63, 107, 10];      // --clr-green (Status OK)
    const COL_GREEN_LIGHT = [239, 245, 228];
    const COL_RED = [192, 57, 43];
    const COL_RED_LIGHT = [253, 240, 239];
    const COL_AMBER = [169, 78, 0];       // --clr-amber (Hinweis / Fehltage)
    const COL_AMBER_LIGHT = [255, 245, 230];
    const COL_GRAY = [108, 101, 96];      // --clr-sage
    const COL_BORDER = [228, 225, 222];   // --clr-sand
    const COL_WARM = [242, 240, 239];     // --clr-warm
    const COL_INACTIVE = [235, 233, 231];
    const logo = this._logoDataUrl();

    // Schule/Klasse JE AZUBI (tatsächlicher Standort inkl. Landesfachklasse) –
    // nicht pauschal die Termin-Schule: der Bogen eines LFK-Gasts oder
    // Fremd-Amt-Azubis würde sonst mit falscher Schul-/Klassenangabe
    // weitergegeben.
    const schuelerInfo = {};
    schuelerList.forEach(s => {
      try {
        const kl = App.query('SELECT k.klassenbezeichnung, bs.name as schule FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] || {};
        const ak = App.getAktuelleSchule({ ...s, schule: kl.schule || '' });
        schuelerInfo[s.id] = {
          schule: (ak && ak.schule) || kl.schule || termin.schule || '',
          klasse: kl.klassenbezeichnung || termin.klassenbezeichnung || '',
          lfk: !!(ak && ak.isLandesfachklasse),
        };
      } catch(e) { schuelerInfo[s.id] = { schule: termin.schule || '', klasse: termin.klassenbezeichnung || '', lfk: false }; }
    });

    schuelerList.forEach((s, idx) => {
      if (idx > 0) doc.addPage();
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
      const kwData = {};
      if (ke) App.query('SELECT * FROM kw_status WHERE schueler_id=?', [s.id]).forEach(r => {
        kwData[`${r.ausbildungsjahr}_${r.kalenderwoche}`] = {codes:r.maengel_codes,behoben:r.behobene_codes,fehltage:r.fehltage,geprueft:r.geprueft};
      });

      let y = 10;

      // ══════════════════════════════════════
      // 1) KOPF im Landes-CI: Logo links, Titel und Datum, Gelb-Akzent
      // ══════════════════════════════════════
      let logoH = 0;
      if (logo) {
        try { doc.addImage(logo.data, 'PNG', LM, y, 36, 36 / logo.ratio); logoH = 36 / logo.ratio; } catch(e) { logoH = 0; }
      }
      doc.setTextColor(...COL_INK);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text('Berichtsheftdurchsicht', RM, y + 6, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...COL_GRAY);
      doc.text(`Kontrolle am ${formatDate(termin.geplant_datum)}`, RM, y + 11, { align: 'right' });
      y += Math.max(logoH, 12) + 3;
      doc.setFillColor(...COL_GELB);
      doc.rect(LM, y, PW, 1.6, 'F');
      y += 4;

      // ══════════════════════════════════════
      // 2) INFO GRID (2 rows, structured)
      // ══════════════════════════════════════
      doc.setFillColor(...COL_WARM);
      doc.rect(LM, y, PW, 16, 'F');
      doc.setDrawColor(...COL_BORDER);
      doc.rect(LM, y, PW, 16);
      // Dividers
      doc.line(LM, y + 8, RM, y + 8);
      doc.line(LM + PW * 0.55, y, LM + PW * 0.55, y + 16);

      doc.setTextColor(0); doc.setFontSize(7);
      // Row 1
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...COL_GRAY);
      doc.text('NAME', LM + 3, y + 3);
      doc.text('SCHULE / KLASSE', LM + PW * 0.55 + 3, y + 3);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COL_INK);
      doc.text(`${s.nachname}, ${s.vorname}`, LM + 3, y + 7);
      doc.setFontSize(8);
      const si = schuelerInfo[s.id] || { schule: termin.schule || '', klasse: termin.klassenbezeichnung || '', lfk: false };
      doc.text(`${(si.schule||'').substring(0,35)}${si.lfk ? ' (LFK)' : ''} – ${(si.klasse||'').substring(0,30)}`, LM + PW * 0.55 + 3, y + 7);
      // Row 2
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...COL_GRAY);
      doc.text('AUSBILDUNGSSTÄTTE', LM + 3, y + 11);
      doc.text('PRÜFER', LM + PW * 0.55 + 3, y + 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COL_INK);
      const betrieb = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      const betriebName = betrieb ? ((betrieb.zusatzbezeichnung ? betrieb.zusatzbezeichnung + ' ' : '') + betrieb.name + (betrieb.ort ? ', ' + betrieb.ort : '')) : (s.ausbildungsstaette || '');
      doc.text(betriebName.substring(0, 60), LM + 3, y + 15);
      doc.text(`${termin.pruefer || '–'}`, LM + PW * 0.55 + 3, y + 15);
      y += 19;

      // ══════════════════════════════════════
      // 3) KW-RASTER je Ausbildungsjahr – nur der AKTUELLE Stand jeder Woche
      //    (behobene Codes erscheinen nicht mehr: eine Zelle zeigte sonst
      //    „H1“ und „(H)“ übereinander), inaktive Wochen grau, viele Codes
      //    kompakt, Kopf mit Schuljahr und Lehrjahr
      // ══════════════════════════════════════
      const schuelerAJs = App.getSchuelerAJs(s.id);
      const CH = schuelerAJs.length >= 4 ? 8.5 : CH_STD;
      let bounds = {}, ljInfo = null;
      try { bounds = App.getAJKWBounds(s.id) || {}; } catch(e) {}
      try { ljInfo = App._lehrjahrInfo ? App._lehrjahrInfo(s.id) : null; } catch(e) {}
      for (const aj of schuelerAJs) {
        // Page break if not enough room for AJ header + 4 KW rows (~50mm)
        if (y > 240) {
          doc.addPage();
          y = 10;
          // Mini header on continuation page
          doc.setFillColor(...COL_INK);
          doc.rect(LM, y, PW, 6, 'F');
          doc.setTextColor(255,255,255);
          doc.setFont('helvetica','bold'); doc.setFontSize(8);
          doc.text(`${s.nachname}, ${s.vorname} – Fortsetzung`, LM+3, y+4);
          y += 8;
        }
        const fehlSum = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=?', [s.id, aj]) || 0;
        const b = bounds[aj] || {};
        const inaktiv = new Set(b.inactiveKWs || []);
        let ljLabel = '';
        try { if (ljInfo && App.lehrjahrLabel) ljLabel = App.lehrjahrLabel(s.id, aj, ljInfo); } catch(e) {}

        // Rasterkopf: warme Fläche mit gelbem Marker, wie die Jahresköpfe am Bildschirm
        doc.setFillColor(...COL_WARM);
        doc.rect(LM, y, PW, 5.5, 'F');
        doc.setFillColor(...COL_GELB);
        doc.rect(LM, y, 2, 5.5, 'F');
        doc.setTextColor(...COL_INK);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text(`Ausbildungsjahr ${aj}`, LM + 4, y + 3.8);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...COL_GRAY);
        const kopfZusatz = [b.schoolYear ? `Schuljahr ${b.schoolYear}` : '', ljLabel].filter(Boolean).join(' · ');
        if (kopfZusatz) doc.text(kopfZusatz, LM + 4 + doc.getTextWidth('Ausbildungsjahr 0 ') * 8 / 7 + 2, y + 3.8);
        doc.text(`Fehltage: ${fehlSum}`, RM - 3, y + 3.8, { align: 'right' });
        y += 6.5;

        // KW cells
        kwRows.forEach(row => {
          row.forEach((kw, ci) => {
            const x = LM + ci * CW;
            const d = kwData[`${aj}_${kw}`];
            const codes = (d && d.codes ? d.codes : '').split(',').map(c => c.trim()).filter(Boolean);
            const fehl = d?.fehltage || 0;
            // Wochen außerhalb der Ausbildungszeit grau – außer sie tragen Einträge (Stand zeigen, nie verstecken)
            const istInaktiv = inaktiv.has(kw) && !codes.length && !fehl;
            const real = codes.filter(c => c !== 'H');       // Mängel/Hinweise außer Fehltage
            const zulMangel = real.length && App.istZulassungsMangel(real.join(','), ke);
            // Anzeige: Codes in Rasterreihenfolge, H mit Fehltagezahl, Fehltage ohne H als „H3“
            let anzeige = codes.slice();
            if (fehl > 0 && !anzeige.includes('H')) anzeige.push('H');
            anzeige = anzeige.map(c => c === 'H' && fehl > 0 ? `H${fehl}` : c);

            // Zellhintergrund: inaktiv grau · Zulassungsmangel rot · Hinweis (D/I) orange · geprüft grün
            if (istInaktiv) { doc.setFillColor(...COL_INACTIVE); doc.rect(x, y, CW, CH, 'F'); }
            else if (zulMangel) { doc.setFillColor(...COL_RED_LIGHT); doc.rect(x, y, CW, CH, 'F'); }
            else if (real.length) { doc.setFillColor(...COL_AMBER_LIGHT); doc.rect(x, y, CW, CH, 'F'); }
            else if (d && (d.geprueft || codes.length || fehl > 0)) { doc.setFillColor(...COL_GREEN_LIGHT); doc.rect(x, y, CW, CH, 'F'); }
            doc.setDrawColor(...COL_BORDER);
            doc.rect(x, y, CW, CH);

            // KW-Nummer oben links
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
            if (istInaktiv) doc.setTextColor(170, 166, 162);
            else if (zulMangel) doc.setTextColor(...COL_RED);
            else doc.setTextColor(100, 100, 100);
            doc.text(`${kw}`, x + 1.2, y + 3.5);
            if (istInaktiv) return;

            // Codes mittig: bis drei mit Leerzeichen, mehr kompakt und kleiner,
            // damit „ABCEFG“ in der Zelle bleibt statt in die Nachbarn zu laufen
            if (anzeige.length) {
              const n = anzeige.length;
              const text = n <= 3 ? anzeige.join(' ') : anzeige.join('');
              let fs = n <= 3 ? 8 : n <= 5 ? 7 : 6;
              doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
              while (fs > 4.5 && doc.getTextWidth(text) > CW - 1.5) { fs -= 0.5; doc.setFontSize(fs); }
              doc.setTextColor(...(zulMangel ? COL_RED : COL_AMBER));
              doc.text(text, x + CW / 2, y + CH - 2, { align: 'center' });
            }
          });
          y += CH + 0.3;
        });
        y += 1.5; // gap between AJs
      }

      // ══════════════════════════════════════
      // 4) LEGENDE
      // ══════════════════════════════════════
      doc.setFillColor(...COL_WARM);
      doc.setDrawColor(...COL_BORDER);
      doc.rect(LM, y, PW, 10, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...COL_INK);
      doc.text('LEGENDE:', LM + 2, y + 4);

      doc.setTextColor(50, 50, 50);
      const legendItems = Object.entries(codeLabels);
      // Row 1: A-E
      let lx = LM + 20;
      legendItems.slice(0, 5).forEach(([code, label]) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(code, lx, y + 4);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(`=${label}`, lx + 3, y + 4);
        lx += 34;
      });
      // Row 2: F-I (Abstand nach Textbreite) + Farblegende rechts daneben
      lx = LM + 20;
      legendItems.slice(5).forEach(([code, label]) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(code, lx, y + 8.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(`=${label}`, lx + 3, y + 8.5);
        lx += 3 + doc.getTextWidth(`=${label}`) + 4;
      });
      // Farblegende: Mangel · Hinweis · geprüft · außerhalb der Ausbildungszeit
      lx = Math.max(lx + 4, LM + 118);
      const swatch = (farbe, label, breite) => {
        doc.setFillColor(...farbe); doc.rect(lx, y + 6.5, 4, 3, 'F');
        doc.setDrawColor(...COL_BORDER); doc.rect(lx, y + 6.5, 4, 3);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(50, 50, 50);
        doc.text(label, lx + 5, y + 8.5);
        lx += breite;
      };
      swatch(COL_RED_LIGHT, 'Mangel', 16); swatch(COL_AMBER_LIGHT, 'Hinweis', 17); swatch(COL_GREEN_LIGHT, 'geprüft', 16); swatch(COL_INACTIVE, 'inaktiv', 0);

      y += 12;

      // ══════════════════════════════════════
      // 5) PFLICHTTEILE + FREIWILLIGE TEILE (page break if needed)
      // ══════════════════════════════════════
      if (y > 250) {
        doc.addPage(); y = 10;
        doc.setFillColor(...COL_INK); doc.rect(LM, y, PW, 6, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text(`${s.nachname}, ${s.vorname} – Ergebnis`, LM+3, y+4);
        y += 8;
      }
      const valLabel = (v) => v === 'ja' ? 'Ja' : v === 'nein' ? 'Nein' : v === 'nicht_vorhanden' ? 'N. vorh.' : '–';
      const valColor = (v) => v === 'ja' ? COL_GREEN : v === 'nein' ? COL_RED : v === 'nicht_vorhanden' ? COL_AMBER : [160,160,160];

      // Box background
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(...COL_BORDER);
      doc.rect(LM, y, PW, 15, 'FD');

      // Pflicht header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
      doc.setTextColor(...COL_INK);
      doc.text('PFLICHT:', LM + 2, y + 4);

      // Pflicht items (§ 43 Abs. 1 Nr. 2 BBiG): 1.1 Ausbildungsplan, 1.5 Bescheinigungen ÜA
      // (1.4 „Der/die Auszubildende“ ist keine Zulassungsvoraussetzung → Hinweis)
      const pflichtItems = [
        ['1.1', 'Ausbildungsplan', ke?.p_1_1_ausbildungsplan],
        ['1.5', 'Beschein. überbetr. Ausb.', ke?.p_1_5_bescheinigungen, ke?.bescheinigungen_anzahl, App.getRequiredUBA(s.fachrichtung_id)],
      ];
      let px = LM + 18;
      pflichtItems.forEach(([nr, label, val, count, reqUBA]) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.setTextColor(60, 60, 60);
        doc.text(`${nr}`, px, y + 4);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(label, px + 5, y + 4);
        // Value
        const displayVal = val || '';
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.setTextColor(...valColor(displayVal));
        let valText = valLabel(displayVal);
        if (nr === '1.5' && reqUBA) valText += ` (${count||0}/${reqUBA})`;
        doc.text(valText, px + 5, y + 7.5);
        // Zusatz „geführt / nicht geführt“ (1.1 Inhalte angekreuzt, 1.5 Zusammenstellung)
        const gef = nr === '1.1' ? ke?.p_1_1_gefuehrt : nr === '1.5' ? ke?.p_1_5_gefuehrt : '';
        if (gef === 'ja' || gef === 'nein') {
          const breite = doc.getTextWidth(valText);
          doc.setFont('helvetica', gef === 'nein' ? 'bold' : 'normal'); doc.setFontSize(6);
          doc.setTextColor(...(gef === 'nein' ? [180, 40, 30] : [60, 120, 60]));
          doc.text(gef === 'nein' ? '· nicht geführt' : '· geführt', px + 6 + breite, y + 7.5);
        }
        px += 58;
      });

      // Freiwillig header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
      doc.setTextColor(...COL_GRAY);
      doc.text('HINWEIS:', LM + 2, y + 11.5);

      const freiItems = [
        ['1.2', 'Zusatzvereinbarung', ke?.f_1_2_vertragliche_regelungen],
        ['1.4', 'Der/die Auszubildende', ke?.p_1_4_auszubildende],
        ['1.6', 'Ausbildungsbetrieb / Skizze', ke?.f_1_6_ausbildungsbetrieb],
      ];
      px = LM + 18;
      freiItems.forEach(([nr, label, val]) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.setTextColor(100, 100, 100);
        doc.text(`${nr}`, px, y + 11.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(label, px + 5, y + 11.5);
        // Value
        const displayVal = val || '';
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.setTextColor(...valColor(displayVal));
        doc.text(valLabel(displayVal), px + 5, y + 14);
        // Leave space but we're outside box, that's fine – box is 14 high
        px += 58;
      });

      y += 16;

      // ══════════════════════════════════════
      // 6) ERGEBNIS + BEMERKUNG BOX (dynamic height, proper overflow)
      // ══════════════════════════════════════
      // Page break if less than 50mm remaining
      if (y > 240) {
        doc.addPage(); y = 10;
        doc.setFillColor(...COL_INK); doc.rect(LM, y, PW, 6, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text(`${s.nachname}, ${s.vorname} – Ergebnis`, LM+3, y+4);
        y += 8;
      }
      const halfW = PW * 0.5 - 6; // usable width per half minus padding
      const ergebnisText = eLbl[ke?.ergebnis] || 'Nicht kontrolliert';

      // Pre-calculate LEFT side content height
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      const ergebnisSplit = doc.splitTextToSize(ergebnisText, halfW);
      let leftH = 6 + (ergebnisSplit.length * 3.8) + 2; // header gap + text + gap
      // Fehltage line
      leftH += 5;
      // WV section
      const wv = ke ? App.query('SELECT * FROM wiedervorlagen WHERE kontrollergebnis_id=?', [ke.id]) : [];
      const wvArt = wv.length ? wv[0].art : '';
      if (wv.length) {
        leftH += 5; // WV date line
        leftH += 4; // Art label
        if (wvArt === 'persoenliche_vorlage_rp' || wvArt === 'post_an_rp') {
          const addr = App.scalar("SELECT wert FROM einstellungen WHERE schluessel=?", [wvArt === 'persoenliche_vorlage_rp' ? 'rp_adresse_persoenlich' : 'rp_adresse_post']) || 'RP Freiburg, Ref. 31';
          leftH += 4 + addr.replace(/,\s*/g, '\n').split('\n').length * 3;
        } else {
          leftH += 7; // email line
        }
      }

      // Pre-calculate RIGHT side content height (Bemerkung)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      const bemLines = ke?.bemerkung ? doc.splitTextToSize(ke.bemerkung, halfW) : [];
      let rightH = 6 + Math.max(bemLines.length * 3.2, 4) + 2;

      // Box height: fit content, minimum 22mm
      const boxH = Math.max(leftH, rightH, 22);

      // Another page break if box won't fit
      if (y + boxH > 268) {
        doc.addPage(); y = 10;
        doc.setFillColor(...COL_INK); doc.rect(LM, y, PW, 6, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text(`${s.nachname}, ${s.vorname} – Ergebnis`, LM+3, y+4);
        y += 8;
      }

      // Draw complete box (with bottom line!)
      doc.setDrawColor(...COL_INK);
      doc.setLineWidth(0.5);
      doc.rect(LM, y, PW, boxH); // complete box
      doc.setLineWidth(0.2);
      doc.setDrawColor(...COL_BORDER);
      // Center divider
      doc.line(LM + PW * 0.5, y, LM + PW * 0.5, y + boxH);

      // ── Left half: Ergebnis ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...COL_INK);
      doc.text('ERGEBNIS', LM + 3, y + 4);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      const ergebnisCol = ke?.ergebnis === 'in_ordnung' ? COL_GREEN : (ke?.ergebnis ? COL_RED : COL_GRAY);
      doc.setTextColor(...ergebnisCol);
      doc.text(ergebnisSplit, LM + 3, y + 9);

      // Fehltage
      let curY = y + 9 + ergebnisSplit.length * 3.8 + 2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      // Fehltage mit Anteil an der bisherigen Ausbildungszeit (ohne Urlaub/Berufsschule) –
      // Prozent aus der GEDRUCKTEN Zahl (Stand des Ergebnisses), nicht aus der
      // heutigen Wochensumme: sonst stand „7 (0,0 %)“ nebeneinander
      const fzGesamt = ke?.fehltage_gesamt || 0;
      let fzText = `Fehltage gesamt: ${fzGesamt}`;
      try {
        const fz = App.fehlzeitenStand(s);
        const pct = fz.arbeitstageBisher > 0 ? fzGesamt / fz.arbeitstageBisher * 100 : 0;
        fzText += ` (${pct.toFixed(1).replace('.', ',')} % der bisherigen Ausbildungszeit${pct >= fz.schwelle ? ' – über ' + fz.schwelle + ' %' : ''})`;
      } catch(e) {}
      doc.text(fzText, LM + 3, curY);
      // Zulassung trotz Abweichung / Prüfungsausschuss
      if (ke && (ke.zulassung_ap === 1 || ke.pruefungsausschuss === 1)) {
        curY += 4;
        const trotz = ke.zulassung_ap === 1 && String(ke.bemerkung || '').includes(KontrolleHandler.ZULASSUNG_TROTZ_PREFIX);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.setTextColor(...(ke.pruefungsausschuss === 1 && ke.zulassung_ap !== 1 ? COL_RED : [60, 100, 60]));
        doc.text([ke.zulassung_ap === 1 ? (trotz ? 'Zulassung trotz Abweichung (Einzelfall, s. Bemerkung)' : 'Berichtsheft-Voraussetzung erfüllt (§ 43 Abs. 1 Nr. 2 BBiG)') : '', ke.pruefungsausschuss === 1 ? 'Prüfungsausschuss (§ 46 BBiG)' : ''].filter(Boolean).join(' · '), LM + 3, curY);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
      }

      // Wiedervorlage
      if (wv.length) {
        curY += 5;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.setTextColor(...COL_RED);
        doc.text(wv[0].frist_datum ? `Wiedervorlage bis ${formatDate(wv[0].frist_datum)}` : 'Wiedervorlage bei der nächsten Durchsicht', LM + 3, curY);
        curY += 3.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        doc.setTextColor(120, 50, 40);
        doc.text(wvArtLabel(wvArt), LM + 3, curY);
        curY += 4;
        // Context-specific address/email (clipped to box)
        const maxWvY = y + boxH - 2;
        if (curY < maxWvY) {
          if (wvArt === 'persoenliche_vorlage_rp' || wvArt === 'post_an_rp') {
            const addr = App.scalar("SELECT wert FROM einstellungen WHERE schluessel=?",
              [wvArt === 'persoenliche_vorlage_rp' ? 'rp_adresse_persoenlich' : 'rp_adresse_post']) || 'RP Freiburg, Ref. 31';
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
            doc.setTextColor(60, 60, 60);
            doc.text(wvArt === 'persoenliche_vorlage_rp' ? 'Persönlich abgeben bei:' : 'Per Post senden an:', LM + 3, curY);
            curY += 3;
            doc.setFont('helvetica', 'normal');
            addr.replace(/,\s*/g, '\n').split('\n').forEach(line => {
              if (curY < maxWvY) { doc.text(line.trim(), LM + 3, curY); curY += 3; }
            });
          } else if (wvArt === 'sachberichte_wetter_email' || wvArt === 'berichte_bis_termin_email') {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
            doc.setTextColor(60, 60, 60);
            doc.text('Per E-Mail senden an:', LM + 3, curY);
            curY += 3;
            doc.setFont('helvetica', 'normal');
            doc.text(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='email_freisprechung'") || 'Freisprechung.GB@rpf.bwl.de', LM + 3, curY);
          }
        }
      }

      // ── Right half: Bemerkung ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...COL_INK);
      doc.text('BEMERKUNG', LM + PW * 0.5 + 3, y + 4);
      if (bemLines.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.setTextColor(40, 40, 40);
        const maxBemLines = Math.floor((boxH - 8) / 3.2);
        const visibleLines = bemLines.slice(0, maxBemLines);
        doc.text(visibleLines, LM + PW * 0.5 + 3, y + 9);
        if (bemLines.length > maxBemLines) {
          doc.setFontSize(6); doc.setTextColor(160,160,160);
          doc.text(`[+${bemLines.length - maxBemLines} Zeilen]`, LM + PW * 0.5 + 3, y + boxH - 2);
        }
      } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text('Keine Bemerkung', LM + PW * 0.5 + 3, y + 9);
      }
      y += boxH + 4;

      // ══════════════════════════════════════
      // 7) DIGITALE SIGNATUR
      // ══════════════════════════════════════
      y = Math.max(y, 270);
      // Prüfer des Ergebnisses, sonst Termin-Prüfer; der letzte Schreiber nur als Notnagel
      const prName = (ke?.pruefer || termin.pruefer || ke?.geaendert_von || 'Ausbildungsberater').trim();
      // Namensvermerk einmal (rechts), keine Signatur im Rechtssinn (§ 126a BGB) –
      // deshalb „gez.“; links das Amt
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.setTextColor(...COL_GRAY);
      doc.text('Regierungspräsidium Freiburg · Referat 31 · Ausbildungsberatung Gärtner', LM, y + 4);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
      doc.setTextColor(...COL_INK);
      doc.text(`gez. ${prName}`, RM, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.setTextColor(...COL_GRAY);
      doc.text('Ausbildungsberatung (Namensvermerk)', RM, y + 4, { align: 'right' });

      // Fußzeile mit Gelb-Akzent
      doc.setFillColor(...COL_GELB);
      doc.rect(LM, 289.2, PW, 1.2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      doc.setTextColor(...COL_GRAY);
      doc.text('Regierungspräsidium Freiburg · Abteilung 3 · Berichtsheftkontrolle Gärtner', LM, 293);
      doc.text(`Erstellt: ${new Date().toLocaleDateString('de-DE')}`, RM, 293, { align: 'right' });
      doc.setLineWidth(0.2);
    });

    const dateStr = termin.geplant_datum.replace(/-/g,'');
    const fname = schuelerList.length === 1
      ? `BH-Durchsicht_${schuelerList[0].nachname}_${schuelerList[0].vorname}_${termin.schule}_${termin.klassenbezeichnung}_${dateStr}.pdf`
      : `BH-Durchsicht_${termin.schule}_${termin.klassenbezeichnung}_${schuelerList.length}Schueler_${dateStr}.pdf`;
    const dateiname = fname.replace(/[\/ \\\\:,;+]/g,'_');
    // Als Bytes zurückgeben (E-Mail-Entwürfe mit Anhang) statt herunterzuladen
    if (opts && opts.bytes) return { name: dateiname, bytes: new Uint8Array(doc.output('arraybuffer')) };
    doc.save(dateiname);
    App.toast(`PDF erstellt: ${schuelerList.length} Durchsichtsbög${schuelerList.length===1?'en':'en'}`, 'success');
  },

  _terminFuerBogen(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return null;
    const klassen = App.getTerminKlassen(terminId);
    termin.klassenbezeichnung = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
    const ortBs = App.getTerminSchule ? App.getTerminSchule(terminId) : null;
    termin.schule = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : 'Einsendung');
    return termin;
  },
  // Single export for one Schüler
  generateSingle(terminId, schuelerId) {
    const termin = this._terminFuerBogen(terminId);
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return App.toast('Daten nicht gefunden', 'error');
    this.generateBatch(d=>d, termin, terminId, [s]);
  },
  // Durchsichtsbogen eines Azubis als { name, bytes } – Anhang für E-Mail-Entwürfe
  bogenBytes(terminId, schuelerId) {
    const termin = this._terminFuerBogen(terminId);
    const s = termin && App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!termin || !s) return null;
    return this.generateBatch(d=>d, termin, terminId, [s], { bytes: true });
  },

  // RPF-Logo aus der Kopfzeile der Oberfläche (in der gebauten Datei ein
  // data:-Bild); im Entwicklungsmodus über eine Zeichenfläche, ohne DOM null
  _logoDataUrl() {
    try {
      if (this._logoCache !== undefined) return this._logoCache;
      const img = typeof document !== 'undefined' && document.querySelector ? document.querySelector('img.topbar-logo--pos') : null;
      if (!img || !img.src) { this._logoCache = null; return null; }
      const ratio = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 663 / 160;
      if (/^data:image\/png/i.test(img.src)) { this._logoCache = { data: img.src, ratio }; return this._logoCache; }
      const c = document.createElement('canvas'); c.width = img.naturalWidth || 663; c.height = img.naturalHeight || 160;
      c.getContext('2d').drawImage(img, 0, 0);
      this._logoCache = { data: c.toDataURL('image/png'), ratio };
      return this._logoCache;
    } catch(e) { this._logoCache = null; return null; }
  },

  // Einheitliche Fußzeile für alle erzeugten PDFs (Anschreiben, Listen)
  footer(doc, seite, gesamt) {
    try {
      doc.setFillColor(255, 252, 0); doc.rect(25, 282.5, 160, 1, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(108, 101, 96);
      doc.text('Regierungspräsidium Freiburg · Berichtsheftkontrolle Gärtner', 25, 287);
      doc.text(`Erstellt: ${new Date().toLocaleDateString('de-DE')}${gesamt ? ` · Seite ${seite} von ${gesamt}` : ''}`, 185, 287, { align: 'right' });
      doc.setTextColor(0); doc.setLineWidth(0.2);
    } catch(e) {}
  }
};
