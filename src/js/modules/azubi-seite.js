// ══════════════════════════════════════════════════════════════
//  AZUBI-SEITE: eine Seite je Azubi statt drei Dialoge
//  (Stammdaten bearbeiten, Ausbildungsverlauf, Akte). Die bisherigen
//  Editoren bleiben unverändert – sie zeichnen ihren Inhalt über
//  App.oeffneEditor() in einen Abschnitt dieser Seite, wenn sie offen ist,
//  sonst wie bisher in den Dialog. Dazu Kontrollen und Wiedervorlagen des
//  Azubis mit Absprung in die Durchsicht.
// ══════════════════════════════════════════════════════════════

const AzubiSeite = {
  _id: null,
  _springe: '',
  ABSCHNITTE: [
    ['stammdaten', 'Stammdaten'],
    ['phasen', 'Ausbildungsverlauf'],
    ['akte', 'Akte'],
    ['kontrollen', 'Kontrollen'],
    ['wiedervorlagen', 'Wiedervorlagen'],
  ],
  ERGEBNIS: { in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung', sachberichte_wetter_email: 'E-Mail (Wetter)', berichte_bis_termin_email: 'E-Mail (Berichte)', persoenliche_vorlage_rp: 'Vorlage RP', post_an_rp: 'Post RP' },

  oeffnen(id, abschnitt) {
    this._id = parseInt(id);
    this._springe = abschnitt || '';
    try { App.uSet('azubi_id', String(this._id)); } catch(e) {}
    App.navigate('azubi');
  },
  // Ist die Seite (für diesen Azubi) gerade zu sehen? Dann zeichnen die
  // Editoren in ihre Abschnitte statt in den Dialog.
  istOffen(id) {
    if (App.currentView !== 'azubi' || this._id == null) return false;
    if (id != null && Number(id) !== Number(this._id)) return false;
    return !!document.getElementById('azSeite');
  },
  zurueck() { App.navigate('stammdaten'); },
  springe(abschnitt) {
    const el = document.getElementById('azAbschnitt_' + abschnitt);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  render() {
    const c = document.getElementById('mainContent');
    if (!c) return;
    if (this._id == null) { try { this._id = parseInt(App.uGet('azubi_id', '')) || null; } catch(e) {} }
    const s = this._id != null ? App.query('SELECT * FROM schueler WHERE id=?', [this._id])[0] : null;
    if (!s) { this._id = null; App.navigate('stammdaten'); return; }
    const klasse = s.klasse_id ? (App.query('SELECT k.klassenbezeichnung, bs.name AS schule FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] || null) : null;
    const jg = s.jahrgang_id ? App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [s.jahrgang_id]) : '';
    const fr = s.fachrichtung_id ? App.scalar('SELECT bezeichnung FROM fachrichtungen WHERE id=?', [s.fachrichtung_id]) : '';
    const ampel = App.getSchuelerAmpel(s.id);
    const nKe = App.scalar("SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=? AND ergebnis != ''", [s.id]) || 0;
    const nWv = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]) || 0;
    const fehl = App.getFehltageGesamt(s.id).gesamt;
    const status = s.status || (s.aktiv ? 'aktiv' : 'inaktiv');
    const statusKlasse = status === 'aktiv' ? 'badge-ok' : 'badge-open';
    const meta = [s.ausbildungsstaette, klasse ? [klasse.klassenbezeichnung, klasse.schule].filter(Boolean).join(' · ') : '', jg ? 'Jahrgang ' + jg : '', fr].filter(Boolean);
    c.innerHTML = `
      <div class="page-header kompakt">
        <div class="page-header-left"><button class="btn btn-secondary btn-sm" onclick="AzubiSeite.zurueck()" title="Zurück zur Azubi-Liste">‹ Azubi-Liste</button></div>
      </div>
      <div id="azSeite" class="az-seite" data-id="${s.id}">
        <div class="card az-kopf">
          <div class="az-titel">
            <span class="az-ampel" title="${esc(ampel.label || '')}">${ampel.icon || ''}</span>
            <h1>${esc(s.nachname)}, ${esc(s.vorname)}</h1>
            <span class="badge-status ${statusKlasse}">${esc(status)}</span>
            ${s.ibykus_id ? `<span class="az-ident" title="IBYKUS-Ident">${esc(s.ibykus_id)}</span>` : ''}
          </div>
          ${meta.length ? `<div class="az-meta">${meta.map(esc).join(' <span class="az-punkt">·</span> ')}</div>` : ''}
          <div class="az-zahlen">
            <button class="az-zahl" onclick="AzubiSeite.springe('kontrollen')"><strong>${nKe}</strong> Kontrollen</button>
            <button class="az-zahl${nWv ? ' offen' : ''}" onclick="AzubiSeite.springe('wiedervorlagen')"><strong>${nWv}</strong> offene Wiedervorlage${nWv === 1 ? '' : 'n'}</button>
            <span class="az-zahl statisch"><strong>${fehl}</strong> Fehltage</span>
          </div>
          <nav class="az-nav" aria-label="Abschnitte">
            ${this.ABSCHNITTE.map(([k, t]) => `<button class="btn btn-sm btn-secondary" onclick="AzubiSeite.springe('${k}')">${t}</button>`).join('')}
          </nav>
        </div>
        ${this.ABSCHNITTE.map(([k, t]) => `<section class="card az-teil" id="azAbschnitt_${k}" aria-labelledby="azTitel_${k}"><h2 id="azTitel_${k}">${t}</h2><div id="azTeil_${k}"></div></section>`).join('')}
      </div>`;
    // Die bestehenden Editoren zeichnen in ihre Abschnitte (App.oeffneEditor)
    try { ImportHandler.editSchueler(s.id); } catch(e) { console.warn('Azubi-Seite: Stammdaten', e); }
    if (typeof Phasen !== 'undefined') { try { Phasen.openPhasenEditor(s.id); } catch(e) { console.warn('Azubi-Seite: Verlauf', e); } }
    if (typeof SchuelerAkte !== 'undefined') { try { SchuelerAkte.open(s.id); } catch(e) { console.warn('Azubi-Seite: Akte', e); } }
    this._kontrollen(s);
    this._wiedervorlagen(s);
    if (this._springe) { const ziel = this._springe; this._springe = ''; setTimeout(() => this.springe(ziel), 60); }
  },

  _kontrollen(s) {
    const el = document.getElementById('azTeil_kontrollen');
    if (!el) return;
    const rows = App.query(`SELECT ke.id, ke.kontrolltermin_id, ke.ergebnis, ke.anwesend, ke.geaendert_am, ke.zulassung_ap, ke.pruefungsausschuss,
        kt.geplant_datum, kt.durchgefuehrt_datum, kt.status AS kt_status, kt.bemerkung AS kt_bemerkung, bs.name AS schule
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id LEFT JOIN berufsschulen bs ON kt.berufsschule_id=bs.id
      WHERE ke.schueler_id=? ORDER BY kt.geplant_datum DESC, ke.id DESC`, [s.id]);
    if (!rows.length) { el.innerHTML = '<p class="az-leer">Noch keine Kontrolle zu diesem Azubi.</p>'; return; }
    el.innerHTML = `<table class="data-table az-tabelle"><thead><tr><th>Datum</th><th>Termin</th><th>Ergebnis</th><th>Vermerke</th><th></th></tr></thead><tbody>
      ${rows.map(r => {
        const erg = r.ergebnis ? `<span class="badge-status ${r.ergebnis === 'in_ordnung' ? 'badge-ok' : 'badge-open'}">${esc(this.ERGEBNIS[r.ergebnis] || r.ergebnis)}</span>` : (r.anwesend === 0 ? '<span class="az-leer">abwesend</span>' : '<span class="az-leer">offen</span>');
        const vermerke = [r.zulassung_ap === 1 ? 'AP-Zulassung' : '', r.pruefungsausschuss === 1 ? 'Prüfungsausschuss' : ''].filter(Boolean).join(', ');
        return `<tr><td>${esc(formatDate(r.durchgefuehrt_datum || r.geplant_datum))}</td><td>${esc([r.schule, r.kt_bemerkung].filter(Boolean).join(' · ') || ('Termin #' + r.kontrolltermin_id))}${r.kt_status === 'durchgefuehrt' ? ' <span class="az-leer">(abgeschlossen)</span>' : ''}</td><td>${erg}</td><td>${esc(vermerke) || '<span class="az-leer">–</span>'}</td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-secondary" onclick="AzubiSeite.kontrolleOeffnen(${r.kontrolltermin_id}, ${s.id})" title="Durchsicht dieses Termins öffnen">Öffnen</button></td></tr>`;
      }).join('')}
    </tbody></table>`;
  },
  _wiedervorlagen(s) {
    const el = document.getElementById('azTeil_wiedervorlagen');
    if (!el) return;
    const rows = App.query(`SELECT w.*, kt.geplant_datum FROM wiedervorlagen w LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id LEFT JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE w.schueler_id=? ORDER BY CASE w.status WHEN 'ueberfaellig' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, w.frist_datum DESC`, [s.id]);
    if (!rows.length) { el.innerHTML = '<p class="az-leer">Keine Wiedervorlagen zu diesem Azubi.</p>'; return; }
    const statusText = { offen: 'offen', ueberfaellig: 'überfällig', erledigt: 'erledigt' };
    el.innerHTML = `<table class="data-table az-tabelle"><thead><tr><th>Frist</th><th>Art</th><th>Status</th><th>Aus Kontrolle</th><th>Erledigt</th><th></th></tr></thead><tbody>
      ${rows.map(w => `<tr><td>${esc(formatDate(w.frist_datum))}</td><td>${esc(w.art || '–')}</td>
        <td><span class="badge-status ${w.status === 'erledigt' ? 'badge-ok' : 'badge-open'}">${esc(statusText[w.status] || w.status)}</span>${w.mahnstufe ? ` <span class="az-leer">Mahnstufe ${w.mahnstufe}</span>` : ''}</td>
        <td>${esc(formatDate(w.geplant_datum) || '–')}</td><td>${esc(formatDate(w.erledigt_datum) || '–')}</td>
        <td style="white-space:nowrap">${typeof WiedervorlagenHandler !== 'undefined' && WiedervorlagenHandler.details ? `<button class="btn btn-sm btn-secondary" onclick="WiedervorlagenHandler.details(${w.id})">Details</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  },
  // Durchsicht eines Termins mit diesem Azubi öffnen (wie der Absprung aus der Azubi-Liste)
  kontrolleOeffnen(terminId, schuelerId) {
    App.navigate('kontrolle');
    setTimeout(() => {
      const sel = document.getElementById('selKontrolltermin');
      if (sel) sel.value = terminId;
      KontrolleHandler.loadTermin(terminId);
      setTimeout(() => {
        const i = (KontrolleHandler.currentSchuelerList || []).findIndex(x => x.id === schuelerId);
        if (i >= 0) { KontrolleHandler.currentIndex = i; KontrolleHandler._viewMode = 'einzeln'; KontrolleHandler.enterSchüler(); }
      }, 200);
    }, 100);
  },
};
