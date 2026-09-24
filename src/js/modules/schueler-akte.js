// ══════════════════════════════════════════════════════════════
//  SCHÜLER-AKTE: Bemerkungen je Azubi (Freitext mit Zeitstempel und Prüfer)
//  und Aktenvermerk als PDF. Der Datei-Upload wurde entfernt – Dateien
//  gehören nicht in die Berichtsheftkontrolle; alte Dateien unter
//  _bhk/dateien/ bleiben unangetastet liegen.
// ══════════════════════════════════════════════════════════════

const SchuelerAkte = {
  open(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return;
    const bemerkungen = App.query('SELECT * FROM schueler_bemerkungen WHERE schueler_id=? ORDER BY erstellt_am DESC', [schuelerId]);
    App.openModal(`Akte: ${s.nachname}, ${s.vorname}`, `
      <div class="form-group">
        <label>Neue Bemerkung</label>
        <textarea class="form-control" id="mAkteNeueNotiz" rows="3" maxlength="5000" placeholder="Bemerkung eingeben..." style="resize:vertical"></textarea>
      </div>
      <button class="btn btn-primary btn-sm" onclick="SchuelerAkte.addBemerkung(${schuelerId})" style="margin-bottom:12px">Bemerkung speichern</button>
      <div id="mAkteBemerkungen" style="max-height:300px;overflow-y:auto">
        ${bemerkungen.length ? bemerkungen.map(b => `
          <div style="border:1px solid var(--clr-sand);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;background:var(--clr-warm)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:12px;color:var(--clr-text-light)">${b.erstellt_von ? esc(b.erstellt_von) + ' · ' : ''}${SchuelerAkte._formatDate(b.erstellt_am)}</span>
              <button class="btn btn-sm" style="color:var(--clr-red);padding:1px 5px;font-size:12px" onclick="SchuelerAkte.deleteBemerkung(${b.id},${schuelerId})">Löschen</button>
            </div>
            <div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${esc(b.text)}</div>
          </div>
        `).join('') : '<p style="color:var(--clr-text-light);font-size:13px">Noch keine Bemerkungen.</p>'}
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="SchuelerAkte.exportAktenvermerk(${schuelerId})">Aktenvermerk exportieren</button>`);
    _makeModalWide();
  },

  addBemerkung(schuelerId) {
    const text = document.getElementById('mAkteNeueNotiz')?.value?.trim();
    if (!text) return App.toast('Bitte Bemerkung eingeben', 'warning');
    const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '';
    App.run('INSERT INTO schueler_bemerkungen (schueler_id, text, erstellt_von) VALUES (?,?,?)', [schuelerId, text, pruefer]);
    App.toast('Bemerkung gespeichert', 'success');
    this.open(schuelerId);
  },

  async deleteBemerkung(id, schuelerId) {
    if (!(await App.confirm('Bemerkung löschen?', { titel: 'Bemerkung löschen', ok: 'Löschen', gefaehrlich: true }))) return;
    App.run('DELETE FROM schueler_bemerkungen WHERE id=?', [id]);
    this.open(schuelerId);
  },

  // ── Aktenvermerk als PDF exportieren ──
  async exportAktenvermerk(schuelerId) {
    try { return await this._exportAktenvermerk(schuelerId); }
    catch (e) {
      console.error('Aktenvermerk-Export:', e);
      App.toast('Aktenvermerk konnte nicht erstellt werden: ' + (e.message || e), 'error');
    }
  },
  async _exportAktenvermerk(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return;
    const betrieb = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
    const klasse = s.klasse_id ? App.query('SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] : null;
    const jahrgang = s.jahrgang_id ? App.query('SELECT * FROM abschlussjahrgaenge WHERE id=?', [s.jahrgang_id])[0] : null;
    const fr = s.fachrichtung_id ? App.query('SELECT * FROM fachrichtungen WHERE id=?', [s.fachrichtung_id])[0] : null;
    const bemerkungen = App.query('SELECT * FROM schueler_bemerkungen WHERE schueler_id=? ORDER BY erstellt_am ASC', [schuelerId]);
    // kontrolltermine hat keine Spalte "name" – die Abfrage warf deshalb
    // "no such column" und der Export-Knopf tat kommentarlos nichts.
    const kontrollen = App.query(`SELECT ke.*, kt.geplant_datum, kt.bemerkung as termin_name
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum ASC`, [schuelerId]);
    const wiedervorlagen = App.query(`SELECT w.*, wn.notiz as wv_notiz, wn.erstellt_am as wv_notiz_am
      FROM wiedervorlagen w LEFT JOIN wiedervorlage_notizen wn ON w.id=wn.wiedervorlage_id
      WHERE w.schueler_id=? ORDER BY w.erstellt_am ASC`, [schuelerId]);

    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
      return App.toast('jsPDF nicht geladen', 'error');
    }
    const { jsPDF } = window.jspdf || jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const LM = 15, RM = 195;
    let y = 15;

    const checkPage = (needed) => {
      if (y + needed > 275) { doc.addPage(); y = 15; }
    };

    // ── Header ──
    doc.setFillColor(45, 80, 22);
    doc.rect(0, 0, 210, 12, 'F');
    doc.setTextColor(255);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('AKTENVERMERK', LM, 8);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Erstellt: ${new Date().toLocaleDateString('de-DE')}`, RM, 8, { align: 'right' });
    doc.setTextColor(0);
    y = 18;

    // ── Stammdaten ──
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`${s.nachname}, ${s.vorname}`, LM, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');

    const info = [];
    if (betrieb) info.push(`Betrieb: ${(betrieb.vorname ? betrieb.vorname + ' ' : '') + betrieb.name}${betrieb.ort ? ' (' + betrieb.ort + ')' : ''}`);
    if (fr) info.push(`Fachrichtung: ${fr.bezeichnung}`);
    if (klasse) info.push(`Schule: ${klasse.schule} (${klasse.klassenbezeichnung})`);
    if (jahrgang) info.push(`Jahrgang: ${jahrgang.bezeichnung}`);
    if (s.ausbildungsbeginn) info.push(`Ausbildung: ${s.ausbildungsbeginn} bis ${s.ausbildungsende || '–'}`);
    if (s.ibykus_id) info.push(`BAV-Ident: ${s.ibykus_id}`);

    info.forEach(line => {
      doc.text(line, LM, y);
      y += 4.5;
    });
    y += 3;

    // ── Kontrollhistorie ──
    if (kontrollen.length) {
      checkPage(15);
      doc.setFillColor(240, 237, 230);
      doc.rect(LM - 2, y - 4, RM - LM + 4, 7, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text('Kontrollhistorie', LM, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);

      const eLbl = { in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung', sachberichte_wetter_email: 'E-Mail (Wetter)', berichte_bis_termin_email: 'E-Mail (Berichte)', persoenliche_vorlage_rp: 'Vorlage RP', post_an_rp: 'Post RP' };

      kontrollen.forEach(ke => {
        checkPage(10);
        const datum = ke.geplant_datum ? new Date(ke.geplant_datum).toLocaleDateString('de-DE') : '–';
        doc.setFont(undefined, 'bold');
        doc.text(`${datum}  –  ${eLbl[ke.ergebnis] || ke.ergebnis}`, LM + 2, y);
        doc.setFont(undefined, 'normal');
        y += 4;
        if (ke.bemerkung) {
          const lines = doc.splitTextToSize(ke.bemerkung, RM - LM - 4);
          lines.forEach(line => {
            checkPage(4);
            doc.text(line, LM + 4, y);
            y += 3.5;
          });
        }
        y += 2;
      });
      y += 3;
    }

    // ── Bemerkungen ──
    if (bemerkungen.length) {
      checkPage(15);
      doc.setFillColor(240, 237, 230);
      doc.rect(LM - 2, y - 4, RM - LM + 4, 7, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text(`Bemerkungen (${bemerkungen.length})`, LM, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);

      bemerkungen.forEach(b => {
        checkPage(10);
        doc.setTextColor(100);
        doc.text(`${SchuelerAkte._formatDate(b.erstellt_am)}${b.erstellt_von ? ' – ' + b.erstellt_von : ''}`, LM + 2, y);
        doc.setTextColor(0);
        y += 4;
        const lines = doc.splitTextToSize(b.text, RM - LM - 4);
        lines.forEach(line => {
          checkPage(4);
          doc.text(line, LM + 4, y);
          y += 3.5;
        });
        y += 3;
      });
      y += 2;
    }

    // ── Wiedervorlagen ──
    const wvGrouped = {};
    wiedervorlagen.forEach(w => {
      if (!wvGrouped[w.id]) wvGrouped[w.id] = { ...w, notizen: [] };
      if (w.wv_notiz) wvGrouped[w.id].notizen.push({ text: w.wv_notiz, datum: w.wv_notiz_am });
    });
    const wvList = Object.values(wvGrouped);
    if (wvList.length) {
      checkPage(15);
      doc.setFillColor(240, 237, 230);
      doc.rect(LM - 2, y - 4, RM - LM + 4, 7, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text(`Wiedervorlagen (${wvList.length})`, LM, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);

      wvList.forEach(w => {
        checkPage(8);
        const statusLbl = { offen: 'Offen', erledigt: 'Erledigt', ueberfaellig: 'Überfällig' };
        doc.setFont(undefined, 'bold');
        doc.text(`${w.typ || '–'} – ${statusLbl[w.status] || w.status} (Frist: ${w.frist ? new Date(w.frist).toLocaleDateString('de-DE') : '–'})`, LM + 2, y);
        doc.setFont(undefined, 'normal');
        y += 4;
        if (w.versand_datum) {
          checkPage(4);
          doc.setTextColor(100);
          doc.text(`   Anschreiben: ${w.mahnstufe || 1}× (zuletzt ${SchuelerAkte._formatDate(w.versand_datum)} per ${w.versand_art === 'email' ? 'E-Mail' : (w.versand_art || 'Brief')})`, LM + 2, y);
          doc.setTextColor(0);
          y += 4;
        }
        if (w.beschreibung) {
          const lines = doc.splitTextToSize(w.beschreibung, RM - LM - 4);
          lines.forEach(line => { checkPage(4); doc.text(line, LM + 4, y); y += 3.5; });
        }
        w.notizen.forEach(n => {
          checkPage(6);
          doc.setTextColor(100);
          doc.text(`  Notiz (${SchuelerAkte._formatDate(n.datum)}): ${n.text}`, LM + 4, y);
          doc.setTextColor(0);
          y += 3.5;
        });
        y += 3;
      });
    }

    // Save
    const fileName = `Aktenvermerk_${s.nachname}_${s.vorname}_${todayStr()}.pdf`;
    doc.save(fileName);
    App.toast(`Aktenvermerk exportiert: ${fileName}`, 'success');
  },

  // ── Hilfsfunktionen ──
  _formatDate(dateStr) {
    if (!dateStr) return '–';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return dateStr; }
  },

  // ── Zähler für Badge ──
  getCount(schuelerId) {
    return App.scalar('SELECT COUNT(*) FROM schueler_bemerkungen WHERE schueler_id=?', [schuelerId]) || 0;
  }
};
