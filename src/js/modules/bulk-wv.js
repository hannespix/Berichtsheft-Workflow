const BulkWV = {
  getSelected() { return [...document.querySelectorAll('.chk-wv:checked')].map(c => parseInt(c.value)); },
  toggleAll(checked) { document.querySelectorAll('.chk-wv').forEach(c => { if (c.closest('tr').style.display !== 'none') c.checked = checked; }); this.updateBar(); },
  deselectAll() { document.querySelectorAll('.chk-wv').forEach(c => c.checked = false); document.getElementById('chkAllWV').checked = false; this.updateBar(); },
  updateBar() {
    const ids = this.getSelected();
    const bar = document.getElementById('bulkBarWV');
    document.getElementById('bulkCountWV').textContent = ids.length;
    bar.style.display = ids.length > 0 ? 'flex' : 'none';
  },
  erledigtSelected() {
    const ids = this.getSelected();
    if (!ids.length) return;
    App.openModal(`${ids.length} Wiedervorlagen als erledigt markieren`, `
      <div class="form-group"><label>Erledigungsdatum</label><input type="date" class="form-control" id="mBulkWVDatum" value="${todayStr()}"></div>
      <div class="form-group"><label>Bemerkung (optional)</label><textarea class="form-control" id="mBulkWVBem" rows="2"></textarea></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-success" onclick="BulkWV.doErledigt()">Erledigt (${ids.length})</button>`);
  },
  doErledigt() {
    const ids = this.getSelected();
    const datum = document.getElementById('mBulkWVDatum').value;
    const bem = document.getElementById('mBulkWVBem').value.trim();
    ids.forEach(id => App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung=?, geaendert_am=datetime('now','localtime') WHERE id=?", [datum, bem, id]));
    App.closeModal();
    App.toast(`${ids.length} Wiedervorlagen erledigt`, 'success');
    Views.wiedervorlagen();
  },
  extendFrist() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const in2w = addDaysStr(14);
    App.openModal(`${ids.length} Wiedervorlagen – Frist verlängern`, `
      <div class="form-group"><label>Neue Frist</label><input type="date" class="form-control" id="mBulkWVFrist" value="${in2w}"></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="BulkWV.doExtendFrist()">Frist setzen (${ids.length})</button>`);
  },
  doExtendFrist() {
    const ids = this.getSelected();
    const frist = document.getElementById('mBulkWVFrist').value;
    ids.forEach(id => App.run("UPDATE wiedervorlagen SET frist_datum=?, status='offen', geaendert_am=datetime('now','localtime') WHERE id=?", [frist, id]));
    App.closeModal();
    App.toast(`Frist für ${ids.length} Wiedervorlagen gesetzt`, 'success');
    Views.wiedervorlagen();
  },
  deleteSelected() {
    const ids = this.getSelected();
    if (!ids.length) return;
    if (!confirm(`Wirklich ${ids.length} Wiedervorlagen löschen?`)) return;
    ids.forEach(id => App.run('DELETE FROM wiedervorlagen WHERE id=?', [id]));
    App.toast(`${ids.length} Wiedervorlagen gelöscht`, 'success');
    Views.wiedervorlagen();
  },
};
