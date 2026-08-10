const BulkSchueler = {
  // Löschen aus der Bulk-Leiste der Schülerliste. Der Knopf rief bisher eine
  // Funktion auf, die es nicht gab – ein Klick blieb ohne jede Reaktion.
  deleteSelected() {
    const ids = this.getSelected();
    if (!ids.length) return App.toast('Keine Azubis ausgewählt', 'warning');
    if (!confirm(`${ids.length} Azubi(s) wirklich löschen?\n\nAlle zugehörigen Kontrollergebnisse, Kalenderwochen, Wiedervorlagen, Phasen, Bemerkungen und Dateien werden mit gelöscht.`)) return;
    ids.forEach(id => App.deleteSchuelerKaskade(id));
    App.toast(`${ids.length} Azubi(s) und alle verknüpften Daten gelöscht`, 'success');
    this.deselectAll();
    this._refresh();
  },
  // Ansicht aktualisieren – je nachdem, aus welcher Liste die Aktion kam
  _refresh() {
    const c = document.getElementById('stammdatenContent');
    if (c && typeof StammdatenTab !== 'undefined' && StammdatenTab._renderAzubiTable) {
      try { StammdatenTab._renderAzubiTable(c); return; } catch(e) {}
    }
    if (typeof SchuelerView !== 'undefined') { try { SchuelerView.render(); return; } catch(e) {} }
    try { App.renderCurrentView(); } catch(e) {}
  },
  getSelected() { return [...document.querySelectorAll('.chk-s:checked, .chk-azubi:checked')].map(c => parseInt(c.value)); },
  toggleAll(checked) { document.querySelectorAll('.chk-s').forEach(c => c.checked = checked); this.updateBar(); },
  deselectAll() { document.querySelectorAll('.chk-s, .chk-azubi').forEach(c => c.checked = false); const a = document.getElementById('chkAllS'); if (a) a.checked = false; this.updateBar(); },
  updateBar() {
    const ids = this.getSelected();
    const bar = document.getElementById('bulkBarSchueler');
    document.getElementById('bulkCountS').textContent = ids.length;
    bar.style.display = ids.length > 0 ? 'flex' : 'none';
  },
  assignKlasse() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const klassen = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name, k.klassenbezeichnung`);
    App.openModal(`${ids.length} Schüler → Klasse zuordnen`, `
      <div class="form-group"><label>Klasse</label><select class="form-control" id="mBulkKlasse">
        <option value="">– Keine Klasse –</option>
        ${klassen.map(k => `<option value="${k.id}">${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BulkSchueler.doAssignKlasse()">Zuordnen (${ids.length})</button>`);
  },
  doAssignKlasse() {
    const ids = this.getSelected();
    const klId = document.getElementById('mBulkKlasse').value || null;
    ids.forEach(id => App.run('UPDATE schueler SET klasse_id=? WHERE id=?', [klId, id]));
    App.closeModal();
    App.toast(`${ids.length} Schüler zugeordnet`, 'success');
    StammdatenTab._bulkDeselectAll();
    StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'));
  },
  assignJahrgang() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const jgs = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    App.openModal(`${ids.length} Schüler → Jahrgang ändern`, `
      <div class="form-group"><label>Abschlussjahrgang</label><select class="form-control" id="mBulkJG">
        ${jgs.map(j => `<option value="${j.id}" ${j.aktiv?'selected':''}>${esc(j.bezeichnung)}${j.typ ? ' ('+j.typ+' '+j.jahr+')' : ''}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BulkSchueler.doAssignJahrgang()">Ändern (${ids.length})</button>`);
  },
  doAssignJahrgang() {
    const ids = this.getSelected();
    const jgId = document.getElementById('mBulkJG').value;
    ids.forEach(id => App.run('UPDATE schueler SET jahrgang_id=? WHERE id=?', [jgId, id]));
    App.closeModal();
    App.toast(`${ids.length} Schüler verschoben`, 'success');
    StammdatenTab._bulkDeselectAll();
    StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'));
  },
  assignFachrichtung() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const frs = App.query('SELECT * FROM fachrichtungen ORDER BY typ, bezeichnung');
    App.openModal(`${ids.length} Schüler → Fachrichtung ändern`, `
      <div class="form-group"><label>Fachrichtung</label><select class="form-control" id="mBulkFR">
        <option value="">– Keine –</option>
        ${frs.map(f => `<option value="${f.id}">${esc(f.typ)}: ${esc(f.bezeichnung)} (${f.code})</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BulkSchueler.doAssignFR()">Ändern (${ids.length})</button>`);
  },
  doAssignFR() {
    const ids = this.getSelected();
    const frId = document.getElementById('mBulkFR').value || null;
    ids.forEach(id => App.run('UPDATE schueler SET fachrichtung_id=? WHERE id=?', [frId, id]));
    App.closeModal();
    App.toast(`${ids.length} Schüler aktualisiert`, 'success');
    StammdatenTab._bulkDeselectAll();
    StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'));
  },
};
