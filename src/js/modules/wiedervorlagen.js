const WiedervorlagenHandler = {
  filter(status) {
    const rows = document.querySelectorAll('#wvTableBody tr');
    rows.forEach(r => {
      if (status === 'all') r.style.display = '';
      else r.style.display = r.dataset.status === status ? '' : 'none';
    });
  },

  erledigen(id) {
    // Look up the WV to find the kontrollergebnis and navigate to the Durchsicht
    const w = App.query('SELECT w.*, ke.kontrolltermin_id, w.schueler_id FROM wiedervorlagen w LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id WHERE w.id=?', [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');

    if (w.kontrolltermin_id) {
      // Navigate to Kontrolle view and open this student's Durchsicht
      KontrolleHandler.goToKontrolle(w.kontrolltermin_id, w.schueler_id);
      App.toast('Bitte Ergebnis auf „In Ordnung" setzen – Wiedervorlage wird automatisch erledigt', 'info');
    } else {
      // Fallback: kein Kontrolltermin verknüpft → direkt erledigen
      App.openModal('Wiedervorlage als erledigt markieren', '<div class="form-group"><label>Erledigungsdatum</label><input type="date" class="form-control" id="mWvDatum" value="' + todayStr() + '"></div><div class="form-group"><label>Bemerkung</label><textarea class="form-control" id="mWvBem" rows="2"></textarea></div>',
        '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button> <button class="btn btn-success" onclick="WiedervorlagenHandler.doErledigen(' + id + ')">Als erledigt markieren</button>');
    }
  },
  doErledigen(id) {
    const datum = document.getElementById('mWvDatum').value;
    const bem = document.getElementById('mWvBem').value.trim();
    App.run(`UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung=?, geaendert_am=datetime('now','localtime') WHERE id=?`, [datum, bem, id]);
    App.closeModal();
    Views.wiedervorlagen();
    App.toast('Wiedervorlage erledigt', 'success');
  },

  details(id) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, s.klasse_id,
      ke.kontrolltermin_id, ke.ergebnis as ke_ergebnis, ke.bemerkung as ke_bemerkung,
      ke.fehltage_gesamt, ke.geaendert_am as ke_geaendert, ke.geaendert_von as ke_pruefer
      FROM wiedervorlagen w 
      JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id
      WHERE w.id=?`, [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');

    const notizen = App.query('SELECT * FROM wiedervorlage_notizen WHERE wiedervorlage_id=? ORDER BY erstellt_am DESC', [id]);
    const offeneMaengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [w.schueler_id]);

    // Get all kontrollergebnisse for this student (for history)
    const alleKE = App.query(`SELECT ke.*, kt.geplant_datum, kt.pruefer as termin_pruefer
      FROM kontrollergebnisse ke
      JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? ORDER BY ke.erstellt_am DESC`, [w.schueler_id]);

    // Get all snapshots for this student
    const snapshots = App.query(`SELECT ds.*, ke2.kontrolltermin_id
      FROM durchsicht_snapshots ds 
      JOIN kontrollergebnisse ke2 ON ds.kontrollergebnis_id=ke2.id 
      WHERE ds.schueler_id=? ORDER BY ds.snapshot_datum DESC`, [w.schueler_id]);

    // Find the termin info for the "jump to kontrolle" link
    const terminInfo = w.kontrolltermin_id ? App.query(`SELECT kt.*, k.klassenbezeichnung
      FROM kontrolltermine kt
      LEFT JOIN klassen k ON kt.klasse_id=k.id
      WHERE kt.id=?`, [w.kontrolltermin_id])[0] : null;
    const klassen = w.kontrolltermin_id ? App.getTerminKlassen(w.kontrolltermin_id) : [];
    const terminLabel = terminInfo ? `${formatDate(terminInfo.geplant_datum)} – ${klassen.map(k=>k.klassenbezeichnung).join(' + ')}` : '';

    App.openModal(`Wiedervorlage: ${w.nachname}, ${w.vorname}`, `
      <!-- ── Info-Grid ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px">
        <div><strong>Betrieb:</strong> ${esc(w.ausbildungsstaette)}</div>
        <div><strong>Art:</strong> ${wvArtLabel(w.art)}</div>
        <div><strong>Frist:</strong> ${formatDate(w.frist_datum)}</div>
        <div><strong>Status:</strong> ${wvStatusBadge(w.status)}</div>
        ${w.erledigt_datum ? `<div><strong>Erledigt am:</strong> ${formatDate(w.erledigt_datum)}</div>` : ''}
        ${w.erledigt_bemerkung ? `<div><strong>Bemerkung:</strong> ${esc(w.erledigt_bemerkung)}</div>` : ''}
      </div>

      <!-- ── Quick Actions: Zur Kontrolle + PDF ── -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px;background:var(--clr-leaf-light);border-radius:var(--radius);border:1px solid #c8deb8">
        ${w.kontrolltermin_id ? `<button class="btn btn-sm btn-primary" onclick="KontrolleHandler.goToKontrolle(${w.kontrolltermin_id},${w.schueler_id})" title="${esc(terminLabel)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Zur Kontrolle springen
        </button>` : ''}
        ${w.kontrolltermin_id ? `<button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(${w.kontrolltermin_id},${w.schueler_id})" title="Aktuellen Durchsichtsbogen als PDF">📄 PDF aktuell</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="Workflows.emailBetriebWV(${id})" title="E-Mail an Betrieb senden">📧 Betrieb kontaktieren</button>
      </div>

      <!-- ── Offene Mängel ── -->
      ${offeneMaengel.length ? `
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Offene Mängel (${offeneMaengel.length} KWs)</h4>
      <div style="max-height:160px;overflow-y:auto;margin-bottom:12px">
        <table class="data-table"><thead><tr><th>AJ</th><th>KW</th><th>Mängel</th><th>Fehltage</th><th>Aktion</th></tr></thead><tbody>
          ${offeneMaengel.map(m => {
            const codes = m.maengel_codes.split(',').filter(Boolean);
            return `<tr>
              <td>${m.ausbildungsjahr}</td><td>KW ${m.kalenderwoche}</td>
              <td style="color:var(--clr-red)">${codes.map(c => `<span style="cursor:pointer;text-decoration:underline" title="${KWNav.CODE_LABELS[c]||c} – klicken zum Beheben" onclick="WiedervorlagenHandler.markCodeBehoben(${m.id},'${c}',${id})">${c}</span>`).join(' ')}</td>
              <td>${m.fehltage||0}</td>
              <td><button class="btn btn-sm btn-success" onclick="WiedervorlagenHandler.markKWBehoben(${m.id},${id})" title="Alle Mängel dieser KW als behoben">✓ Behoben</button></td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
      <button class="btn btn-sm btn-success" style="margin-bottom:14px" onclick="WiedervorlagenHandler.markAllBehoben(${w.schueler_id},${id})">✓ Alle Mängel als behoben markieren</button>
      ` : w.status !== 'erledigt' ? '<p style="color:var(--clr-green);font-size:13px;margin-bottom:14px">✓ Keine offenen Mängel mehr vorhanden.</p>' : ''}

      <!-- ── Durchsichten-History ── -->
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Durchsichten-Verlauf</h4>
      <div style="max-height:180px;overflow-y:auto;margin-bottom:14px">
        ${alleKE.length ? `<table class="data-table"><thead><tr><th>#</th><th>Datum</th><th>Prüfer</th><th>Ergebnis</th><th>Fehltage</th><th>Aktionen</th></tr></thead><tbody>
          ${alleKE.map((ke, i) => {
            // Find matching snapshots for this KE
            const keSnaps = snapshots.filter(s => s.kontrollergebnis_id === ke.id);
            return `<tr style="${ke.id === w.kontrollergebnis_id ? 'background:var(--clr-amber-light);font-weight:600' : ''}">
              <td>${alleKE.length - i}${ke.id === w.kontrollergebnis_id ? ' ⬅' : ''}</td>
              <td>${formatDate(ke.geplant_datum)}</td>
              <td>${esc(ke.termin_pruefer || ke.geaendert_von || '–')}</td>
              <td>${ke.ergebnis ? `<span class="badge-status ${ke.ergebnis === 'in_ordnung' ? 'badge-ok' : 'badge-open'}">${ergebnisLabel(ke.ergebnis)}</span>` : '<span style="color:var(--clr-text-light)">–</span>'}</td>
              <td>${ke.fehltage_gesamt || 0}</td>
              <td class="btn-group">
                <button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(${ke.kontrolltermin_id},${w.schueler_id})" title="PDF dieses Kontrolltermins">📄</button>
                ${keSnaps.length ? keSnaps.map(snap => 
                  `<button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.viewSnapshot(${snap.id})" title="Snapshot vom ${formatDate(snap.snapshot_datum)} anzeigen">🔍</button>
                   <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.exportSnapshotPDF(${snap.id})" title="Archiv-PDF vom ${formatDate(snap.snapshot_datum)}">📋</button>`
                ).join('') : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody></table>` : '<p style="font-size:12px;color:var(--clr-text-light)">Noch keine Kontrollergebnisse vorhanden.</p>'}
      </div>

      <!-- ── Notizen ── -->
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Notizen</h4>
      ${notizen.map(n => `<div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:6px;font-size:12px">
        <div style="color:var(--clr-text-light)">${formatDateTime(n.erstellt_am)} – ${esc(n.erstellt_von)}</div>
        <div>${esc(n.notiz)}</div>
      </div>`).join('') || '<p style="font-size:12px;color:var(--clr-text-light)">Noch keine Notizen</p>'}

      <div class="form-group" style="margin-top:12px">
        <label>Neue Notiz hinzufügen</label>
        <textarea class="form-control" id="mWvNotiz" rows="2"></textarea>
      </div>
      <div class="form-group">
        <label>Erstellt von</label>
        <select class="form-control" id="mWvVon" style="width:auto">
          ${App.query('SELECT name FROM pruefer WHERE aktiv=1').map(p => `<option>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="WiedervorlagenHandler.addNotiz(${id})">Notiz speichern</button>`);
  },

  markCodeBehoben(kwStatusId, code, wvId) {
    const row = App.query('SELECT * FROM kw_status WHERE id=?', [kwStatusId])[0];
    if (!row) return;
    const codes = row.maengel_codes.split(',').filter(Boolean);
    const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
    const newCodes = codes.filter(c => c !== code);
    behoben.push(code);
    App.run('UPDATE kw_status SET maengel_codes=?, behobene_codes=? WHERE id=?',
      [newCodes.join(','), [...new Set(behoben)].join(','), kwStatusId]);
    App.toast(`Code ${code} als behoben markiert`, 'success');
    this.details(wvId); // Refresh
    this.checkAutoErledigt(wvId);
  },

  markKWBehoben(kwStatusId, wvId) {
    const row = App.query('SELECT * FROM kw_status WHERE id=?', [kwStatusId])[0];
    if (!row) return;
    const codes = row.maengel_codes.split(',').filter(Boolean);
    const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
    const merged = [...new Set([...behoben, ...codes])].join(',');
    App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [merged, kwStatusId]);
    App.toast(`KW ${row.kalenderwoche} komplett behoben`, 'success');
    this.details(wvId);
    this.checkAutoErledigt(wvId);
  },

  markAllBehoben(schuelerId, wvId) {
    const rows = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != ""', [schuelerId]);
    rows.forEach(row => {
      const codes = row.maengel_codes.split(',').filter(Boolean);
      const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
      const merged = [...new Set([...behoben, ...codes])].join(',');
      App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [merged, row.id]);
    });
    App.toast(`Alle ${rows.length} Mängel als behoben markiert`, 'success');
    this.details(wvId);
    this.checkAutoErledigt(wvId);
  },

  checkAutoErledigt(wvId) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [wvId])[0];
    if (!w || w.status === 'erledigt') return;
    const remaining = App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != ""', [w.schueler_id]);
    if (remaining === 0) {
      App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=datetime('now','localtime'), erledigt_bemerkung='Alle Mängel behoben' WHERE id=?", [wvId]);
      App.toast('Alle Mängel behoben → Wiedervorlage automatisch erledigt!', 'success');
    }
  },

  addNotiz(wvId) {
    const notiz = document.getElementById('mWvNotiz').value.trim();
    if (!notiz) return App.toast('Bitte Notiz eingeben', 'error');
    const von = document.getElementById('mWvVon').value;
    App.run('INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)', [wvId, notiz, von]);
    this.details(wvId); // Refresh modal
    App.toast('Notiz gespeichert', 'success');
  },

  exportICS() {
    const wvs = App.query(`SELECT w.*, s.nachname, s.vorname FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      WHERE w.status IN ('offen','ueberfaellig')`);
    if (!wvs.length) return App.toast('Keine offenen Wiedervorlagen', 'warning');
    App.exportICS(wvs.map(w => ({
      date: w.frist_datum,
      title: `Wiedervorlage: ${w.nachname}, ${w.vorname} – BH-Kontrolle`,
      description: wvArtLabel(w.art)
    })));
    App.toast('ICS-Datei exportiert', 'success');
  }
};
