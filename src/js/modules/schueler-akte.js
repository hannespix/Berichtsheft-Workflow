// ══════════════════════════════════════════════════════════════
//  SCHÜLER-AKTE: Bemerkungen, Dateien & Aktenvermerk-Export
// ══════════════════════════════════════════════════════════════

const SchuelerAkte = {

  // ── Dateien-Verzeichnis für einen Schüler holen/erstellen ──
  async _getDateienDir(schuelerId) {
    if (!App.bhkDirHandle) return null;
    try {
      const dateienDir = await App.bhkDirHandle.getDirectoryHandle('dateien', { create: true });
      return await dateienDir.getDirectoryHandle(String(schuelerId), { create: true });
    } catch (e) {
      console.warn('Dateien-Verzeichnis:', e);
      return null;
    }
  },

  // ── Modal: Bemerkungen & Dateien ──
  open(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return;

    const bemerkungen = App.query('SELECT * FROM schueler_bemerkungen WHERE schueler_id=? ORDER BY erstellt_am DESC', [schuelerId]);
    const dateien = App.query('SELECT * FROM schueler_dateien WHERE schueler_id=? ORDER BY erstellt_am DESC', [schuelerId]);
    const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '';

    App.openModal(`Akte: ${s.nachname}, ${s.vorname}`, `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mAkteTab1',this)">Bemerkungen <span style="font-size:10px;color:var(--clr-text-light)">(${bemerkungen.length})</span></button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mAkteTab2',this)">Dateien <span style="font-size:10px;color:var(--clr-text-light)">(${dateien.length})</span></button>
      </div>

      <!-- Tab 1: Bemerkungen -->
      <div id="mAkteTab1" class="modal-tab-content active">
        <div class="form-group">
          <label>Neue Bemerkung</label>
          <textarea class="form-control" id="mAkteNeueNotiz" rows="3" maxlength="5000" placeholder="Bemerkung eingeben..." style="resize:vertical"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" onclick="SchuelerAkte.addBemerkung(${schuelerId})" style="margin-bottom:12px">Bemerkung speichern</button>

        <div id="mAkteBemerkungen" style="max-height:300px;overflow-y:auto">
          ${bemerkungen.length ? bemerkungen.map(b => `
            <div style="border:1px solid var(--clr-sand);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;background:var(--clr-warm)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:11px;color:var(--clr-text-light)">${b.erstellt_von ? esc(b.erstellt_von) + ' · ' : ''}${SchuelerAkte._formatDate(b.erstellt_am)}</span>
                <button class="btn btn-sm" style="color:var(--clr-red);padding:1px 5px;font-size:10px" onclick="SchuelerAkte.deleteBemerkung(${b.id},${schuelerId})" title="Löschen">&#10005;</button>
              </div>
              <div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${esc(b.text)}</div>
            </div>
          `).join('') : '<p style="color:var(--clr-text-light);font-size:13px">Noch keine Bemerkungen.</p>'}
        </div>
      </div>

      <!-- Tab 2: Dateien -->
      <div id="mAkteTab2" class="modal-tab-content">
        <div class="drop-zone" id="akteDropZone" style="min-height:80px;margin-bottom:12px;padding:16px"
             onclick="document.getElementById('akteDateiInput').click()"
             ondragover="event.preventDefault();this.classList.add('dragover')"
             ondragleave="this.classList.remove('dragover')"
             ondrop="event.preventDefault();this.classList.remove('dragover');SchuelerAkte.handleFileDrop(event,${schuelerId})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p style="margin:4px 0 0;font-size:12px">Dateien hierher ziehen oder klicken<br><span style="font-size:11px;color:var(--clr-text-light)">E-Mails (.msg, .eml), PDFs, Bilder, Dokumente...</span></p>
          <input type="file" id="akteDateiInput" multiple style="display:none" onchange="SchuelerAkte.handleFileSelect(this.files,${schuelerId})">
        </div>

        ${!App.bhkDirHandle ? '<div style="padding:8px 12px;background:var(--clr-amber-light);border-radius:var(--radius);font-size:12px;margin-bottom:8px;color:var(--clr-amber)">Dateien können erst nach dem Öffnen einer Datenbank gespeichert werden.</div>' : ''}

        <div id="mAkteDateien">
          ${dateien.length ? `<table class="data-table"><thead><tr><th>Datei</th><th>Beschreibung</th><th>Datum</th><th style="width:80px"></th></tr></thead><tbody>
            ${dateien.map(d => `<tr>
              <td>
                <div style="font-size:12px;font-weight:600">${SchuelerAkte._fileIcon(d.dateityp)} ${esc(d.original_name)}</div>
                <div style="font-size:10px;color:var(--clr-text-light)">${SchuelerAkte._formatSize(d.groesse)}</div>
              </td>
              <td><input class="form-control" value="${esc(d.beschreibung)}" style="font-size:11px;padding:3px 6px" onchange="SchuelerAkte.updateDateiBeschreibung(${d.id},this.value)"></td>
              <td style="font-size:11px;white-space:nowrap">${SchuelerAkte._formatDate(d.erstellt_am)}</td>
              <td class="btn-group" style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="SchuelerAkte.downloadDatei(${d.id},${schuelerId})" title="Herunterladen">&#8595;</button>
                <button class="btn btn-sm" style="color:var(--clr-red);padding:2px 6px;font-size:10px" onclick="SchuelerAkte.deleteDatei(${d.id},${schuelerId})" title="Löschen">&#10005;</button>
              </td>
            </tr>`).join('')}
          </tbody></table>` : '<p style="color:var(--clr-text-light);font-size:13px">Noch keine Dateien.</p>'}
        </div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="SchuelerAkte.exportAktenvermerk(${schuelerId})">Aktenvermerk exportieren</button>`);
    _makeModalWide();
  },

  // ── Bemerkung hinzufügen ──
  addBemerkung(schuelerId) {
    const text = document.getElementById('mAkteNeueNotiz')?.value?.trim();
    if (!text) return App.toast('Bitte Bemerkung eingeben', 'warning');
    const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '';
    App.run('INSERT INTO schueler_bemerkungen (schueler_id, text, erstellt_von) VALUES (?,?,?)', [schuelerId, text, pruefer]);
    App.toast('Bemerkung gespeichert', 'success');
    this.open(schuelerId); // Refresh
  },

  deleteBemerkung(id, schuelerId) {
    if (!confirm('Bemerkung löschen?')) return;
    App.run('DELETE FROM schueler_bemerkungen WHERE id=?', [id]);
    this.open(schuelerId);
  },

  // ── Dateien hochladen ──
  handleFileDrop(event, schuelerId) {
    const files = event.dataTransfer?.files;
    if (files?.length) this.handleFileSelect(files, schuelerId);
  },

  async handleFileSelect(files, schuelerId) {
    if (!files?.length) return;
    if (!App.bhkDirHandle) return App.toast('Bitte zuerst eine Datenbank öffnen', 'error');

    const maxSize = 100 * 1024 * 1024; // 100 MB
    for (const file of files) {
      if (file.size > maxSize) {
        App.toast(`Datei "${file.name}" zu groß (max 100 MB)`, 'error');
        return;
      }
    }

    const dir = await this._getDateienDir(schuelerId);
    if (!dir) return App.toast('Dateien-Verzeichnis konnte nicht erstellt werden', 'error');

    const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '';
    let count = 0;

    for (const file of files) {
      try {
        // Unique filename: timestamp + original name
        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const safeName = file.name.replace(/[<>:"/\\|?*]/g, '_');
        const dateiname = `${ts}_${safeName}`;

        // Write file to disk
        const fileHandle = await dir.getFileHandle(dateiname, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        // Track in DB
        const ext = file.name.split('.').pop().toLowerCase();
        App.run('INSERT INTO schueler_dateien (schueler_id, dateiname, original_name, dateityp, groesse, erstellt_von) VALUES (?,?,?,?,?,?)',
          [schuelerId, dateiname, file.name, ext, file.size, pruefer]);
        count++;
      } catch (e) {
        console.warn('Datei-Upload fehlgeschlagen:', file.name, e);
        console.warn('Datei-Upload:', file.name, e); App.toast('Fehler beim Speichern der Datei', 'error');
      }
    }

    if (count > 0) {
      App.toast(`${count} Datei(en) gespeichert`, 'success');
      this.open(schuelerId); // Refresh
    }
  },

  async downloadDatei(dateiId, schuelerId) {
    const d = App.query('SELECT * FROM schueler_dateien WHERE id=?', [dateiId])[0];
    if (!d) return;

    try {
      const dir = await this._getDateienDir(schuelerId);
      if (!dir) throw new Error('Verzeichnis nicht gefunden');

      const fileHandle = await dir.getFileHandle(d.dateiname);
      const file = await fileHandle.getFile();

      // Trigger download via FileSaver or blob URL
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.original_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Download:', e); App.toast('Datei nicht gefunden', 'error');
    }
  },

  async deleteDatei(dateiId, schuelerId) {
    if (!confirm('Datei löschen?')) return;
    const d = App.query('SELECT * FROM schueler_dateien WHERE id=?', [dateiId])[0];
    if (!d) return;

    // Try to delete from disk
    try {
      const dir = await this._getDateienDir(schuelerId);
      if (dir) await dir.removeEntry(d.dateiname);
    } catch (e) {
      console.warn('Datei auf Disk nicht löschbar:', e);
    }

    App.run('DELETE FROM schueler_dateien WHERE id=?', [dateiId]);
    App.toast('Datei gelöscht', 'success');
    this.open(schuelerId);
  },

  updateDateiBeschreibung(dateiId, beschreibung) {
    App.run('UPDATE schueler_dateien SET beschreibung=? WHERE id=?', [beschreibung.trim(), dateiId]);
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
    const dateien = App.query('SELECT * FROM schueler_dateien WHERE schueler_id=? ORDER BY erstellt_am ASC', [schuelerId]);
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

    // ── Dateien-Verzeichnis ──
    if (dateien.length) {
      checkPage(15);
      doc.setFillColor(240, 237, 230);
      doc.rect(LM - 2, y - 4, RM - LM + 4, 7, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text(`Anlagen / Dateien (${dateien.length})`, LM, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);

      dateien.forEach((d, i) => {
        checkPage(8);
        doc.text(`${i + 1}. ${d.original_name}${d.beschreibung ? ' – ' + d.beschreibung : ''}`, LM + 2, y);
        y += 3.5;
        doc.setTextColor(100);
        doc.text(`   ${SchuelerAkte._formatSize(d.groesse)} · ${SchuelerAkte._formatDate(d.erstellt_am)}`, LM + 2, y);
        doc.setTextColor(0);
        y += 4;
      });
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

  _formatSize(bytes) {
    if (!bytes) return '–';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  _fileIcon(ext) {
    const icons = {
      pdf: svgIcon('datei', 13), doc: svgIcon('datei', 13), docx: svgIcon('datei', 13), odt: svgIcon('datei', 13),
      msg: '✉︎', eml: '✉︎',
      jpg: svgIcon('bild', 13), jpeg: svgIcon('bild', 13), png: svgIcon('bild', 13), gif: svgIcon('bild', 13), bmp: svgIcon('bild', 13),
      xlsx: svgIcon('tabelle', 13), xls: svgIcon('tabelle', 13), csv: svgIcon('tabelle', 13),
      zip: svgIcon('archiv', 13), rar: svgIcon('archiv', 13), '7z': svgIcon('archiv', 13)
    };
    return icons[ext] || svgIcon('datei', 13);
  },

  // ── Zähler für Badge ──
  getCount(schuelerId) {
    const b = App.scalar('SELECT COUNT(*) FROM schueler_bemerkungen WHERE schueler_id=?', [schuelerId]) || 0;
    const d = App.scalar('SELECT COUNT(*) FROM schueler_dateien WHERE schueler_id=?', [schuelerId]) || 0;
    return b + d;
  }
};
