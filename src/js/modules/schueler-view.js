// Ehemals zweite Azubi-Liste auf der Import-Seite. Die Liste gibt es nur noch
// unter Stammdaten; hier bleibt der Dialog „Jahrgang abschließen“ und ein
// render(), das die Stammdaten-Liste auffrischt (Aufrufer aus Import und Bulk).
const SchuelerView = {
  _initialized: true,
  filters: {},
  init() { this._initialized = true; },

  abschliessenJahrgang() {
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');
    App.openModal('⚑ Jahrgang abschließen', `
      <p style="font-size:13px;margin-bottom:12px">Alle Azubis eines Jahrgangs als <strong>"AP bestanden"</strong> markieren und <strong>inaktiv</strong> setzen. Die Daten bleiben für Statistiken erhalten.</p>
      <div class="form-group"><label>Jahrgang auswählen</label><select class="form-control" id="mAbschlJG">
        ${jahrgaenge.map(j => {
          const cnt = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=? AND aktiv=1', [j.id]) || 0;
          return `<option value="${j.id}">${esc(j.bezeichnung)} (${cnt} aktive Azubis)</option>`;
        }).join('')}
      </select></div>
      <div style="padding:8px;background:var(--clr-amber-light);border-radius:var(--radius);font-size:12px;margin-bottom:8px">
        ⚠︎ Azubi mit offenen Wiedervorlagen oder unvollständigen Pflichtteilen werden markiert aber trotzdem abgeschlossen. Prüfen Sie vorher die Übersicht.
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-success" onclick="SchuelerView.doAbschliessen()">⚑ Jahrgang abschließen</button>`);
  },

  doAbschliessen() {
    try {
    const jgId = document.getElementById('mAbschlJG').value;
    if (!jgId) return App.toast('Kein Jahrgang ausgewählt', 'error');
    const jgName = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jgId]);
    const count = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=? AND aktiv=1', [jgId]) || 0;
    if (!count) return App.toast('Keine aktiven Azubis in diesem Jahrgang', 'warning');

    // Nicht pauschal: der gemeinsame Dialog zeigt jeden Azubi mit Prüfungs-
    // erfolg und offenen Wiedervorlagen; "nicht bestanden" wird abgewählt
    // vorgeschlagen (Wiederholung/Verlängerung statt Abschluss).
    const ids = App.query('SELECT id FROM schueler WHERE jahrgang_id=? AND aktiv=1', [jgId]).map(r => r.id);
    App.closeModal();
    ImportHandler.ausbildungBeenden(ids, { nachher: () => this.render() });
    setTimeout(() => {
      document.querySelectorAll('.chk-beenden').forEach(c => {
        const pe = App.scalar('SELECT pruefungserfolg FROM schueler WHERE id=?', [parseInt(c.value)]);
        if (pe === 'nicht_bestanden') c.checked = false;
      });
      const g = document.getElementById('mBeGrund'); if (g && !g.value) g.value = `Jahrgang ${jgName} abgeschlossen`;
    }, 50);
    } catch(e) {
      console.error('doAbschliessen:', e);
      App.toast('Vorgang fehlgeschlagen: ' + (e.message || e), 'error');
    } finally {
      App.hideLoading();
    }
  },

  render() {
    const c = document.getElementById('stammdatenContent');
    if (c && typeof StammdatenTab !== 'undefined' && StammdatenTab._renderAzubiTable && c.querySelector('#azubiTableContainer')) {
      try { StammdatenTab._renderAzubiTable(c); } catch(e) {}
    }
  }
};
