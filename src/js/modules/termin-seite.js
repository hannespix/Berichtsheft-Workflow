// ══════════════════════════════════════════════════════════════
//  TERMIN-SEITE: ein Ort je Termin statt vier (UI-Vereinfachung Paket 7)
//  Analog zur Azubi-Seite: Kopf mit den Eckdaten, darunter die vier Phasen
//  Vorbereitung → Durchsicht → Nachbereitung → Bögen & Export als Abschnitte.
//  Die Phase, die dran ist, ist aufgeklappt, die anderen zeigen nur ihren
//  Stand. Alle Aktionen sind die bisherigen Dialoge und Exporte – sie werden
//  nur von einer Stelle aus geöffnet. Die Durchsicht selbst (Übersicht und
//  Einzelansicht) bleibt die Ansicht „kontrolle“.
// ══════════════════════════════════════════════════════════════

const TerminSeite = {
  _id: null,
  _springe: '',
  _offen: {},            // je Termin: von Hand auf-/zugeklappte Phasen
  PHASEN: [
    ['vorbereitung', 'Vorbereitung'],
    ['durchsicht', 'Durchsicht'],
    ['nachbereitung', 'Nachbereitung'],
    ['export', 'Bögen & Export'],
  ],
  WOCHENTAGE: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],

  oeffnen(id, phase) {
    this._id = parseInt(id);
    this._springe = phase || '';
    try { App.uSet('termin_id', String(this._id)); } catch(e) {}
    App.navigate('termin');
  },
  istOffen(id) {
    if (App.currentView !== 'termin' || this._id == null) return false;
    if (id != null && Number(id) !== Number(this._id)) return false;
    return !!document.getElementById('tsSeite');
  },
  zurueck() { App.navigate('planung'); },
  springe(phase) {
    const el = document.getElementById('tsPhase_' + phase);
    if (!el) return;
    if ('open' in el) el.open = true;
    if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  // Durchsicht dieses Termins öffnen (Übersicht am Kontrolltag)
  durchsichtOeffnen() {
    const id = this._id;
    App.navigate('kontrolle');
    setTimeout(() => KontrolleHandler.startKontrolle(id), 100);
  },
  nachbereitetVermerken() {
    App.terminSchritt(this._id, 'nachbereitet');
    App.toast('Nachbereitung als abgeschlossen vermerkt', 'success');
    this.render();
  },
  async loeschen() {
    const id = this._id;
    await PlanungHandler.deleteTermin(id);
    if (!App.query('SELECT id FROM kontrolltermine WHERE id=?', [id]).length) App.navigate('planung');
  },
  // Auf-/Zuklappen von Hand merken, damit ein Neuzeichnen (nach einer Aktion)
  // die Entscheidung nicht überschreibt
  _toggle(phase, el) {
    if (!this._offen[this._id]) this._offen[this._id] = {};
    this._offen[this._id][phase] = !!el.open;
  },

  // ── Stand des Termins: Zahlen und die Phase, die dran ist ──
  stand(t) {
    const id = t.id;
    const heute = App._heuteIso();
    const abg = t.status === 'durchgefuehrt';
    const schueler = App.getTerminSchueler(id);
    const n = schueler.length;
    const fremde = schueler.filter(s => App.istFremdesAmt(s)).length;
    const ke = App.query('SELECT schueler_id, anwesend, ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=?', [id]);
    const ids = new Set(schueler.map(s => s.id));
    const keDa = ke.filter(k => ids.has(k.schueler_id));
    const bewertet = keDa.filter(k => k.ergebnis).length;
    const ok = keDa.filter(k => k.ergebnis === 'in_ordnung').length;
    const abwesend = keDa.filter(k => k.anwesend === 0 && !k.ergebnis).length;
    const offen = Math.max(0, n - bewertet - abwesend);
    let betriebe = [], mitMail = 0;
    try { betriebe = Workflows._betriebeDesTermins(id, false).betriebe; mitMail = betriebe.filter(b => b.email).length; } catch(e) {}
    const wv = App.query(`SELECT w.*, s.nachname, s.vorname FROM wiedervorlagen w
      JOIN kontrollergebnisse k ON w.kontrollergebnis_id=k.id JOIN schueler s ON w.schueler_id=s.id
      WHERE k.kontrolltermin_id=? ORDER BY CASE w.status WHEN 'ueberfaellig' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, w.frist_datum, s.nachname`, [id]);
    const wvOffen = wv.filter(w => w.status === 'offen' || w.status === 'ueberfaellig').length;
    const kette = App.terminKette(t);
    const phase = t.nachbereitet_am ? 'export' : abg ? 'nachbereitung' : (bewertet > 0 || t.geplant_datum <= heute) ? 'durchsicht' : 'vorbereitung';
    return { heute, abg, schueler, n, fremde, bewertet, ok, maengel: bewertet - ok, abwesend, offen, betriebe, mitMail, wv, wvOffen, kette, phase };
  },

  render() {
    const c = document.getElementById('mainContent');
    if (!c) return;
    if (this._id == null) { try { this._id = parseInt(App.uGet('termin_id', '')) || null; } catch(e) {} }
    const t = this._id != null ? App.query('SELECT * FROM kontrolltermine WHERE id=?', [this._id])[0] : null;
    if (!t) { this._id = null; App.navigate('planung'); return; }
    const st = this.stand(t);
    const klassen = App.getTerminKlassen(t.id);
    const ortBs = App.getTerminSchule(t.id);
    const ortName = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : '');
    const ortOrt = ortBs ? (ortBs.ort || '') : '';
    const wt = this.WOCHENTAGE[new Date(t.geplant_datum + 'T00:00:00').getDay()] || '';
    const frAj = App.formatTerminFrAj ? App.formatTerminFrAj(t.id) : '';
    const meta = [
      t.typ === 'einsendung' ? '✉︎ Einsendung' : 'Schultermin',
      klassen.length ? klassen.map(k => k.klassenbezeichnung).join(' + ') : '',
      frAj,
      `${st.n} Azubi${st.n === 1 ? '' : 's'}${st.fremde ? ` (${st.fremde} fremde Ämter)` : ''}`,
      t.pruefer ? 'Prüfer: ' + t.pruefer : '',
    ].filter(Boolean);
    const phasenIdx = this.PHASEN.findIndex(([k]) => k === st.phase);
    const merk = this._offen[t.id] || {};
    const offenIst = (k, i) => (k in merk) ? merk[k] : i === phasenIdx;
    c.innerHTML = `
      <div class="page-header kompakt">
        <div class="page-header-left"><button class="btn btn-secondary btn-sm" onclick="TerminSeite.zurueck()">‹ Termine</button></div>
      </div>
      <div id="tsSeite" class="ts-seite" data-id="${t.id}">
        <div class="card ts-kopf">
          <div class="ts-titel">
            <h1>${wt} ${formatDate(t.geplant_datum)} <span class="ts-kw">(KW ${getKW(t.geplant_datum)})</span>${ortName ? ` <span class="ts-punkt">·</span> ${esc(ortName)}` : ''}${ortOrt ? ` <span class="ts-ort">${esc(ortOrt)}</span>` : ''}</h1>
            ${statusBadge(t.status)}
            ${st.kette.label ? `<span class="ts-kette" style="color:${st.kette.farbe}">${esc(st.kette.label)}</span>` : ''}
            <span class="ts-kopf-aktionen">
              ${st.abg ? '' : `<button class="btn btn-sm btn-success" onclick="TerminSeite.durchsichtOeffnen()" title="Übersicht der Durchsicht öffnen">▸ Durchsicht öffnen</button>`}
              <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.editTermin(${t.id})" title="Datum, Ort, Prüfer, Klassen, Azubis, Bemerkung">✎ Bearbeiten</button>
              ${App.menue('⋯', [
                { label: '▸ Durchsicht öffnen', onclick: 'TerminSeite.durchsichtOeffnen()' },
                st.abg ? { label: '↻ Nachholtermin anlegen', onclick: `PlanungHandler.nachholterminAnlegen(${t.id})`, title: 'Für die am Kontrolltag abwesenden Azubis' } : null,
                { trenner: true },
                { label: '✕ Termin löschen', onclick: 'TerminSeite.loeschen()' },
              ].filter(Boolean), 'Weitere Aktionen zu diesem Termin', 'klein')}
            </span>
          </div>
          <div class="ts-meta">${meta.map(esc).join(' <span class="ts-punkt">·</span> ')}</div>
          ${t.bemerkung ? `<div class="ts-bemerkung">${esc(t.bemerkung)}</div>` : ''}
          <ol class="ts-phasen" aria-label="Phasen">
            ${this.PHASEN.map(([k, titel], i) => `<li class="ts-phase-schritt ${i < phasenIdx ? 'erledigt' : i === phasenIdx ? 'aktiv' : ''}"><button type="button" onclick="TerminSeite.springe('${k}')" ${i === phasenIdx ? 'aria-current="step"' : ''}><span class="ts-nr">${i < phasenIdx ? '✓' : i + 1}</span> ${titel}</button></li>`).join('')}
          </ol>
        </div>
        ${this.PHASEN.map(([k, titel], i) => `
          <details class="card ts-phase ${i === phasenIdx ? 'aktiv' : ''}" id="tsPhase_${k}" ${offenIst(k, i) ? 'open' : ''} ontoggle="TerminSeite._toggle('${k}', this)">
            <summary><span class="ts-nr">${i < phasenIdx ? '✓' : i + 1}</span><h2>${titel}</h2><span class="ts-stand">${this._standText(k, t, st)}</span></summary>
            <div class="ts-inhalt">${this['_' + k](t, st, klassen, ortBs)}</div>
          </details>`).join('')}
      </div>`;
    if (this._springe) { const ziel = this._springe; this._springe = ''; setTimeout(() => this.springe(ziel), 60); }
  },

  // Eine Zeile Stand je Phase (auch im zugeklappten Zustand sichtbar)
  _standText(k, t, st) {
    if (k === 'vorbereitung') return st.kette.schritt === 'bestaetigt' || st.kette.schritt === 'angefragt' ? st.kette.label : (st.abg ? 'erledigt' : 'noch nicht angefragt');
    if (k === 'durchsicht') return st.abg ? `abgeschlossen${t.durchgefuehrt_datum ? ' am ' + formatDate(t.durchgefuehrt_datum) : ''} · ${st.bewertet} von ${st.n} bewertet` : (st.bewertet ? `${st.bewertet} von ${st.n} bewertet · ${st.offen} offen` : `${st.n} Azubis · noch nicht begonnen`);
    if (k === 'nachbereitung') return t.nachbereitet_am ? `nachbereitet ${formatDate(t.nachbereitet_am)}` : st.abg ? `offen · ${st.wvOffen} offene Wiedervorlage${st.wvOffen === 1 ? '' : 'n'}` : 'nach dem Abschluss der Durchsicht';
    return st.abg ? 'Bögen, Übersicht, Excel, Gesamtpaket' : 'nach der Durchsicht';
  },

  _zeile(label, wert, aktionen) {
    return `<div class="ts-zeile"><span class="ts-label">${label}</span><span class="ts-wert">${wert}</span><span class="ts-aktion">${aktionen || ''}</span></div>`;
  },

  _vorbereitung(t, st, klassen, ortBs) {
    const id = t.id;
    const k = st.kette;
    const anfrage = k.schritt === 'bestaetigt' ? `✓ ${esc(k.label)}` : k.schritt === 'angefragt' ? esc(k.label) : (ortBs && ortBs.frei ? 'freier Ort – keine Schulanfrage nötig' : 'noch nicht angefragt');
    const anfrageAktionen = st.abg ? '' : [
      `<button class="btn btn-sm ${k.schritt ? 'btn-secondary' : 'btn-primary'}" onclick="Workflows.emailSchule(${id})">✉︎ Termin bei der Schule anfragen</button>`,
      k.schritt === 'angefragt' ? `<button class="btn btn-sm btn-secondary" onclick="PlanungHandler.terminBestaetigen(${id})" title="Zusage der Schule vermerken">✓ Zusage vermerken</button>` : '',
      k.schritt === 'angefragt' || k.schritt === 'bestaetigt' ? `<button class="btn btn-sm btn-secondary" onclick="PlanungHandler.terminAnfrageZuruecksetzen(${id})" title="Anfrage-Vermerk zurücksetzen">↺</button>` : '',
    ].join(' ');
    const betriebe = `${st.betriebe.length} Betrieb${st.betriebe.length === 1 ? '' : 'e'}${st.betriebe.length ? ` · ${st.mitMail} mit E-Mail` : ''}`;
    const teilnehmer = [
      `${st.n} Azubi${st.n === 1 ? '' : 's'}`,
      klassen.length ? klassen.map(kl => `${esc(kl.klassenbezeichnung)} (${esc(kl.schule)})`).join(', ') : (t.typ === 'einsendung' ? 'einzeln zugeordnet' : 'ohne Klasse'),
      st.fremde ? `${st.fremde} aus fremden Ämtern` : '',
    ].filter(Boolean).join(' · ');
    return `
      ${this._zeile('Anfrage an die Schule', anfrage, anfrageAktionen)}
      ${this._zeile('Betriebe ankündigen', betriebe, st.abg ? '' : `<button class="btn btn-sm btn-secondary" onclick="Workflows.seriendruckBetriebe(${id})" title="Ankündigung je Betrieb: E-Mail, Brief oder CSV">▤ Betriebe anschreiben</button>`)}
      ${this._zeile('Teilnehmer', teilnehmer, `<button class="btn btn-sm btn-secondary" onclick="PlanungHandler.editTermin(${id})">✎ Termin bearbeiten</button>`)}
      ${this._zeile('Ort und Zeit', `${formatDate(t.geplant_datum)} (KW ${getKW(t.geplant_datum)})${ortBs ? ' · ' + esc(ortBs.name) + (ortBs.ort ? ', ' + esc(ortBs.ort) : '') : ' · <em>ohne Ort</em>'}${t.pruefer ? ' · ' + esc(t.pruefer) : ''}`, '')}`;
  },

  _durchsicht(t, st) {
    const id = t.id;
    const pct = st.n ? Math.round(st.bewertet / st.n * 100) : 0;
    return `
      <div class="fortschritt ts-fortschritt">
        <div class="fs-kopf"><span class="fs-text"><strong>${st.bewertet} von ${st.n}</strong> bewertet · <span class="fs-ok">${st.ok} in Ordnung</span> · <span class="fs-mangel">${st.maengel} beanstandet</span> · ${st.offen} offen${st.abwesend ? ` · ${st.abwesend} abwesend` : ''}</span></div>
        <div class="fs-balken" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Fortschritt der Durchsicht"><div style="width:${pct}%"></div></div>
      </div>
      <div class="ts-knoepfe">
        <button class="btn ${st.abg ? 'btn-secondary' : 'btn-primary'}" onclick="TerminSeite.durchsichtOeffnen()">▸ Durchsicht öffnen</button>
        <button class="btn btn-secondary" onclick="KontrolleHandler.printUebersicht(${id})">⎙ Übersichtstabelle drucken</button>
      </div>
      ${st.abg
        ? `<p class="ts-hinweis">✓ Abgeschlossen${t.durchgefuehrt_datum ? ' am ' + formatDate(t.durchgefuehrt_datum) : ''}. Zum Korrigieren die Durchsicht öffnen und im Menü „Termin ▾“ „Termin wieder öffnen“ wählen.</p>`
        : `<p class="ts-hinweis">Am Kontrolltag: Durchsicht öffnen, Hefte durchsehen, am Ende „Termin abschließen“ – der Abschluss-Assistent legt Archiv-Bögen und Wiedervorlagen an und wechselt zur Nachbereitung.</p>`}`;
  },

  _nachbereitung(t, st) {
    const id = t.id;
    if (!st.abg) return `<p class="ts-hinweis">Die Nachbereitung beginnt nach dem Abschluss der Durchsicht: Ergebnisse an die Schule, Mitteilungen an die Betriebe, Weitergabe an fremde Ämter, Wiedervorlagen.</p>`;
    const wvHtml = st.wv.length ? `<table class="data-table ts-tabelle"><thead><tr><th>Azubi</th><th>Art</th><th>Frist</th><th>Status</th><th></th></tr></thead><tbody>
      ${st.wv.slice(0, 60).map(w => `<tr>
        <td>${esc(w.nachname)}, ${esc(w.vorname)}</td>
        <td><small>${esc(typeof wvArtLabel === 'function' ? wvArtLabel(w.art) : w.art)}</small></td>
        <td>${w.frist_datum ? formatDate(w.frist_datum) : 'nächste Durchsicht'}</td>
        <td><span class="badge-status ${w.status === 'erledigt' ? 'badge-done' : w.status === 'ueberfaellig' ? 'badge-overdue' : 'badge-open'}">${esc(w.status)}</span></td>
        <td>${typeof WiedervorlagenHandler !== 'undefined' && WiedervorlagenHandler.details ? `<button class="btn btn-sm btn-secondary" onclick="WiedervorlagenHandler.details(${w.id})">Details</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>${st.wv.length > 60 ? `<p class="ts-hinweis">… ${st.wv.length - 60} weitere unter Wiedervorlagen</p>` : ''}` : '<p class="ts-hinweis">Keine Wiedervorlagen zu diesem Termin.</p>';
    return `
      ${this._zeile('Ergebnisse an die Schule', 'Zahlen je Ergebnis, Abwesende', `<button class="btn btn-sm btn-primary" onclick="Workflows.emailSchule(${id})">✉︎ Ergebnisse an die Schule</button>`)}
      ${this._zeile('Betriebe', `${st.betriebe.length} Betrieb${st.betriebe.length === 1 ? '' : 'e'} · ${st.mitMail} mit E-Mail`, `<button class="btn btn-sm btn-primary" onclick="Workflows.emailBetriebIndividuell(${id})" title="Arbeitsliste: je Betrieb eine E-Mail, Outlook-Entwürfe als ZIP">✉︎ E-Mails an die Betriebe</button> <button class="btn btn-sm btn-secondary" onclick="Workflows.briefeBearbeiten(${id})" title="Briefe im Brief-Editor (PDF, Word, E-Mail-Entwurf)">✎ Briefe</button>`)}
      ${st.fremde ? this._zeile('Fremde Ämter', `${st.fremde} Azubi${st.fremde === 1 ? '' : 's'} anderer Ämter`, `<button class="btn btn-sm btn-secondary" onclick="PlanungHandler.fremdeAemter(${id})">§ Fremde Ämter</button>`) : ''}
      ${this._zeile('Nachholtermin', st.abwesend ? `${st.abwesend} abwesend` : 'niemand abwesend', `<button class="btn btn-sm btn-secondary" onclick="PlanungHandler.nachholterminAnlegen(${id})" title="Für die am Kontrolltag abwesenden Azubis">↻ Nachholtermin anlegen</button>`)}
      ${this._zeile('Stand', t.nachbereitet_am ? `✓ nachbereitet am ${formatDate(t.nachbereitet_am)}` : 'Nachbereitung offen', t.nachbereitet_am ? '' : `<button class="btn btn-sm btn-success" onclick="TerminSeite.nachbereitetVermerken()" title="Wenn Schule und Betriebe informiert sind">✓ Nachbereitung abgeschlossen</button>`)}
      <h3 class="ts-h3">Wiedervorlagen dieses Termins <span class="ts-zahl">${st.wvOffen} offen</span></h3>
      ${wvHtml}`;
  },

  _export(t, st) {
    const id = t.id;
    return `
      <div class="ts-knoepfe">
        <button class="btn btn-primary" onclick="PlanungHandler.exportTerminPDF(${id})">▤ Alle Durchsichtsbögen als PDF</button>
        <button class="btn btn-secondary" onclick="KontrolleHandler.printUebersicht(${id})">⎙ Übersichtstabelle drucken</button>
        ${typeof BerichteHandler !== 'undefined' && BerichteHandler.exportTerminExcel ? `<button class="btn btn-secondary" onclick="BerichteHandler.exportTerminExcel(${id})" title="Ergebnisliste aller Azubis dieses Termins">▤ Ergebnisliste (Excel)</button>` : ''}
        ${typeof BerichteHandler !== 'undefined' && BerichteHandler.gesamtpaket ? `<button class="btn btn-secondary" onclick="BerichteHandler.gesamtpaket(${id})" title="PDFs + Seriendruck + E-Mail in einem Schritt">Gesamtpaket</button>` : ''}
        <button class="btn btn-secondary" onclick="Workflows.exportSeriendruckCSV(${id})" title="Datenquelle für den Word-Seriendruck">▤ Seriendruck (CSV)</button>
        <button class="btn btn-secondary" onclick="Workflows.exportSeriendruckWord(${id})">▤ Seriendruck (Word)</button>
      </div>
      <p class="ts-hinweis">${st.abg ? `${st.bewertet} bewertete Azubis.` : 'Bögen lassen sich schon vor dem Abschluss erzeugen (Stand jetzt).'} Weitere Berichte (Klassenübersicht, Statistik) unter Berichte & Export.</p>`;
  },
};
