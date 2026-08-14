const PDFExport = {
  generateBatch(transform, termin, terminId, schuelerList) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const kwRows = [[36,37,38,39,40,41,42,43,44,45,46,47,48],[49,50,51,52,1,2,3,4,5,6,7,8,9],[10,11,12,13,14,15,16,17,18,19,20,21,22],[23,24,25,26,27,28,29,30,31,32,33,34,35]];
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bis nächste Durchsicht',sachberichte_wetter_email:'Sachberichte (Wetter) per E-Mail',berichte_bis_termin_email:'Berichte per E-Mail bis Termin',persoenliche_vorlage_rp:'Persönliche Vorlage im RP',post_an_rp:'Per Post ans RP'};
    const codeLabels = {A:'Unterschrift Azubi',B:'Unterschrift Ausbilder',C:'Berufsschulthemen',D:'Wetter',E:'Inhaltlich lückenhaft',F:'Berichte fehlen komplett',G:'Datum/KW falsch',H:'Fehltage',I:'Sonstiges'};
    const LM = 10; // left margin
    const RM = 200; // right margin (210 - 10)
    const PW = RM - LM; // page width usable = 190
    const CW = PW / 13; // cell width = ~14.6mm
    const CH = 10; // cell height – taller for multiple codes

    // Colors
    const COL_GREEN = [45, 80, 22];
    const COL_GREEN_LIGHT = [232, 240, 226];
    const COL_RED = [192, 57, 43];
    const COL_RED_LIGHT = [253, 240, 239];
    const COL_AMBER = [212, 132, 10];
    const COL_AMBER_LIGHT = [255, 245, 230];
    const COL_GRAY = [108, 108, 108];
    const COL_BORDER = [200, 200, 200];
    const COL_WARM = [245, 240, 232];

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
        kwData[`${r.ausbildungsjahr}_${r.kalenderwoche}`] = {codes:r.maengel_codes,behoben:r.behobene_codes,fehltage:r.fehltage};
      });

      let y = 10;

      // ══════════════════════════════════════
      // 1) HEADER BAR (green)
      // ══════════════════════════════════════
      doc.setFillColor(...COL_GREEN);
      doc.rect(LM, y, PW, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Berichtsheftdurchsicht', LM + 4, y + 7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(`${formatDate(termin.geplant_datum)}`, RM - 4, y + 7, { align: 'right' });
      y += 12;

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
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0);
      doc.text(`${s.nachname}, ${s.vorname}`, LM + 3, y + 7);
      doc.setFontSize(8);
      const si = schuelerInfo[s.id] || { schule: termin.schule || '', klasse: termin.klassenbezeichnung || '', lfk: false };
      doc.text(`${(si.schule||'').substring(0,35)}${si.lfk ? ' (LFK)' : ''} – ${(si.klasse||'').substring(0,30)}`, LM + PW * 0.55 + 3, y + 7);
      // Row 2
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...COL_GRAY);
      doc.text('AUSBILDUNGSSTÄTTE', LM + 3, y + 11);
      doc.text('PRÜFER', LM + PW * 0.55 + 3, y + 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0);
      const betrieb = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      const betriebName = betrieb ? ((betrieb.zusatzbezeichnung ? betrieb.zusatzbezeichnung + ' ' : '') + betrieb.name + (betrieb.ort ? ', ' + betrieb.ort : '')) : (s.ausbildungsstaette || '');
      doc.text(betriebName.substring(0, 60), LM + 3, y + 15);
      doc.text(`${termin.pruefer || '–'}`, LM + PW * 0.55 + 3, y + 15);
      y += 19;

      // ══════════════════════════════════════
      // 3) KW GRIDS – Ausbildungsjahre (dynamisch: Verkürzer/Verlängerer)
      // ══════════════════════════════════════
      const schuelerAJs = App.getSchuelerAJs(s.id);
      for (const aj of schuelerAJs) {
        // Page break if not enough room for AJ header + 4 KW rows (~50mm)
        if (y > 240) {
          doc.addPage();
          y = 10;
          // Mini header on continuation page
          doc.setFillColor(...COL_GREEN);
          doc.rect(LM, y, PW, 6, 'F');
          doc.setTextColor(255,255,255);
          doc.setFont('helvetica','bold'); doc.setFontSize(8);
          doc.text(`${s.nachname}, ${s.vorname} – Fortsetzung`, LM+3, y+4);
          y += 8;
        }
        const fehlSum = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=?', [s.id, aj]) || 0;

        // AJ Header bar
        doc.setFillColor(...COL_GREEN);
        doc.rect(LM, y, PW, 5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text(`Ausbildungsjahr ${aj}`, LM + 3, y + 3.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(`Fehltage: ${fehlSum}`, RM - 3, y + 3.5, { align: 'right' });
        y += 6;

        // KW cells
        kwRows.forEach(row => {
          row.forEach((kw, ci) => {
            const x = LM + ci * CW;
            const d = kwData[`${aj}_${kw}`];
            const hasCodes = d && d.codes;
            const hasRealMaengel = hasCodes && d.codes.split(',').some(c => c.trim() && c.trim() !== 'H');
            const hasBehoben = d && d.behoben && !hasRealMaengel;
            const fehl = d?.fehltage || 0;

            // Cell background
            if (hasRealMaengel) {
              doc.setFillColor(...COL_RED_LIGHT);
              doc.rect(x, y, CW, CH, 'F');
            } else if (hasBehoben) {
              doc.setFillColor(...COL_AMBER_LIGHT);
              doc.rect(x, y, CW, CH, 'F');
            } else if (d?.geprueft || (d && !hasCodes && !hasBehoben)) {
              doc.setFillColor(...COL_GREEN_LIGHT);
              doc.rect(x, y, CW, CH, 'F');
            }
            // Cell border
            doc.setDrawColor(...COL_BORDER);
            doc.rect(x, y, CW, CH);

            // KW number (top-left)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
            doc.setTextColor(hasRealMaengel ? COL_RED[0] : 100, hasRealMaengel ? COL_RED[1] : 100, hasRealMaengel ? COL_RED[2] : 100);
            doc.text(`${kw}`, x + 1.2, y + 3.5);

            // Mängel codes (center of cell, larger for readability)
            if (hasRealMaengel) {
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
              doc.setTextColor(...COL_RED);
              // Merge H with Fehltage count: "A B H" + 3 Fehltage → "A B H3"
              let displayCodes = d.codes;
              if (fehl > 0 && displayCodes.includes('H')) {
                displayCodes = displayCodes.replace(/\bH\b/, `H${fehl}`);
              }
              doc.text(displayCodes.replace(/,/g,' '), x + CW/2, y + 8, { align: 'center' });
            }

            // Behoben codes (strikethrough-style)
            if (hasBehoben) {
              doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
              doc.setTextColor(...COL_AMBER);
              doc.text(`(${d.behoben.replace(/,/g,' ')})`, x + CW/2, y + 7.5, { align: 'center' });
            }

            // Fehltage badge (top-right) – only when H is NOT already in codes
            if (fehl > 0 && !(hasCodes && d.codes.includes('H'))) {
              const bx = x + CW - 4.5;
              const by = y + 0.5;
              doc.setFillColor(...COL_AMBER);
              doc.circle(bx + 1.5, by + 1.8, 2.2, 'F');
              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
              doc.text(`${fehl}`, bx + 1.5, by + 2.5, { align: 'center' });
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
      doc.setTextColor(...COL_GREEN);
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
      // Row 2: F-I + color swatches
      lx = LM + 20;
      legendItems.slice(5).forEach(([code, label]) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(code, lx, y + 8.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(`=${label}`, lx + 3, y + 8.5);
        lx += 34;
      });
      // Color legend on right side
      lx = LM + 148;
      doc.setFillColor(...COL_RED_LIGHT); doc.rect(lx, y+6.5, 5, 3, 'F');
      doc.setDrawColor(...COL_BORDER); doc.rect(lx, y+6.5, 5, 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(50,50,50);
      doc.text('Mangel', lx + 6.5, y + 8.5);
      lx += 22;
      doc.setFillColor(...COL_GREEN_LIGHT); doc.rect(lx, y+6.5, 5, 3, 'F');
      doc.setDrawColor(...COL_BORDER); doc.rect(lx, y+6.5, 5, 3);
      doc.text('OK', lx + 6.5, y + 8.5);

      y += 12;

      // ══════════════════════════════════════
      // 5) PFLICHTTEILE + FREIWILLIGE TEILE (page break if needed)
      // ══════════════════════════════════════
      if (y > 250) {
        doc.addPage(); y = 10;
        doc.setFillColor(...COL_GREEN); doc.rect(LM, y, PW, 6, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text(`${s.nachname}, ${s.vorname} – Ergebnis`, LM+3, y+4);
        y += 8;
      }
      const valLabel = (v) => v === 'ja' ? 'Ja' : v === 'nein' ? 'Nein' : v === 'nicht_vorhanden' ? 'N. vorh.' : '–';
      const valColor = (v) => v === 'ja' ? [39,174,96] : v === 'nein' ? [192,57,43] : v === 'nicht_vorhanden' ? [212,132,10] : [160,160,160];

      // Box background
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(...COL_BORDER);
      doc.rect(LM, y, PW, 15, 'FD');

      // Pflicht header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
      doc.setTextColor(...COL_GREEN);
      doc.text('PFLICHT:', LM + 2, y + 4);

      // Pflicht items: 1.1 Ausbildungsplan, 1.4 Auszubildende, 1.5 Bescheinigungen ÜA
      const pflichtItems = [
        ['1.1', 'Ausbildungsplan', ke?.p_1_1_ausbildungsplan],
        ['1.4', 'Der/die Auszubildende', ke?.p_1_4_auszubildende],
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
        px += 58;
      });

      // Freiwillig header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
      doc.setTextColor(...COL_GRAY);
      doc.text('FREIWILLIG:', LM + 2, y + 11.5);

      const freiItems = [
        ['1.2', 'Vertragliche Regelungen', ke?.f_1_2_vertragliche_regelungen],
        ['1.6', 'Ausbildungsbetrieb / Skizze', ke?.f_1_6_ausbildungsbetrieb],
      ];
      px = LM + 24;
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
        px += 80;
      });

      y += 16;

      // ══════════════════════════════════════
      // 6) ERGEBNIS + BEMERKUNG BOX (dynamic height, proper overflow)
      // ══════════════════════════════════════
      // Page break if less than 50mm remaining
      if (y > 240) {
        doc.addPage(); y = 10;
        doc.setFillColor(...COL_GREEN); doc.rect(LM, y, PW, 6, 'F');
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
        doc.setFillColor(...COL_GREEN); doc.rect(LM, y, PW, 6, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text(`${s.nachname}, ${s.vorname} – Ergebnis`, LM+3, y+4);
        y += 8;
      }

      // Draw complete box (with bottom line!)
      doc.setDrawColor(...COL_GREEN);
      doc.setLineWidth(0.5);
      doc.rect(LM, y, PW, boxH); // complete box
      doc.setLineWidth(0.2);
      // Center divider
      doc.line(LM + PW * 0.5, y, LM + PW * 0.5, y + boxH);

      // ── Left half: Ergebnis ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...COL_GREEN);
      doc.text('ERGEBNIS', LM + 3, y + 4);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      const ergebnisCol = ke?.ergebnis === 'in_ordnung' ? COL_GREEN : (ke?.ergebnis ? COL_RED : COL_GRAY);
      doc.setTextColor(...ergebnisCol);
      doc.text(ergebnisSplit, LM + 3, y + 9);

      // Fehltage
      let curY = y + 9 + ergebnisSplit.length * 3.8 + 2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`Fehltage gesamt: ${ke?.fehltage_gesamt || 0}`, LM + 3, curY);

      // Wiedervorlage
      if (wv.length) {
        curY += 5;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.setTextColor(...COL_RED);
        doc.text(`Wiedervorlage bis ${formatDate(wv[0].frist_datum)}`, LM + 3, curY);
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
      doc.setTextColor(...COL_GREEN);
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
      const prName = (ke?.geaendert_von || termin.pruefer || 'Ausbildungsberater').trim();
      // Left: Name + Referat
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(prName, LM, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.setTextColor(...COL_GRAY);
      doc.text('Referat 31, RP Freiburg', LM, y + 4);
      // Right: Gez.
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(`Gez. ${prName}`, RM, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.setTextColor(...COL_GRAY);
      doc.text('Digitale Signatur', RM, y + 4, { align: 'right' });

      // Footer line
      doc.setDrawColor(...COL_GREEN);
      doc.setLineWidth(0.8);
      doc.line(LM, 290, RM, 290);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      doc.setTextColor(...COL_GRAY);
      doc.text('Regierungspräsidium Freiburg · Abt. 3 · Berichtsheftkontrolle Gärtner', LM, 293);
      doc.text(`Erstellt: ${new Date().toLocaleDateString('de-DE')}`, RM, 293, { align: 'right' });
      doc.setLineWidth(0.2);
    });

    const dateStr = termin.geplant_datum.replace(/-/g,'');
    const fname = schuelerList.length === 1
      ? `BH-Durchsicht_${schuelerList[0].nachname}_${schuelerList[0].vorname}_${termin.schule}_${termin.klassenbezeichnung}_${dateStr}.pdf`
      : `BH-Durchsicht_${termin.schule}_${termin.klassenbezeichnung}_${schuelerList.length}Schueler_${dateStr}.pdf`;
    doc.save(fname.replace(/[\/ \\\\:,;+]/g,'_'));
    App.toast(`PDF erstellt: ${schuelerList.length} Durchsichtsbög${schuelerList.length===1?'en':'en'}`, 'success');
  },

  // Single export for one Schüler
  generateSingle(terminId, schuelerId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    const klassen = App.getTerminKlassen(terminId);
    termin.klassenbezeichnung = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
    termin.schule = klassen.length ? klassen[0].schule : '?';
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return App.toast('Daten nicht gefunden', 'error');
    this.generateBatch(d=>d, termin, terminId, [s]);
  }
};
