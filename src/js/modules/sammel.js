// ══════════════════════════════════════════════════════════════
//  SAMMELAUSWERTUNG: mehrere Termine gemeinsam auswerten
//  Häkchen in der Termine-Liste, darunter eine Leiste mit Auswertungen
//  über die Auswahl: gemeinsame Übersicht (Druck), Zulassungsliste, Excel,
//  Bögen als PDF. Die Termine bleiben, wie sie sind – eine Liste über
//  mehrere Prüfungstage oder Einzelprüfungen braucht kein Verschmelzen.
//  Für echte Doppelanlagen gibt es daneben „Zu einem Termin zusammenführen“.
// ══════════════════════════════════════════════════════════════

const Sammel = {
  _ids: new Set(),
  ERGEBNIS: { in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung', sachberichte_wetter_email: 'E-Mail (Wetter)', berichte_bis_termin_email: 'E-Mail (Berichte)', persoenliche_vorlage_rp: 'Vorlage RP', post_an_rp: 'Post RP' },

  // ── Auswahl in der Termine-Liste ──
  hat(id) { return this._ids.has(Number(id)); },
  ids() { return [...this._ids]; },
  toggle(id, an) {
    if (an) this._ids.add(Number(id)); else this._ids.delete(Number(id));
    this._leiste();
  },
  // Alle sichtbaren Zeilen (nach Status-Filter) wählen oder abwählen
  alle(an) {
    document.querySelectorAll('#planTableBody tr').forEach(tr => {
      if (tr.style.display === 'none') return;
      const cb = tr.querySelector('.chk-termin');
      if (!cb) return;
      cb.checked = !!an;
      if (an) this._ids.add(Number(cb.value)); else this._ids.delete(Number(cb.value));
    });
    this._leiste();
  },
  leer() {
    this._ids.clear();
    document.querySelectorAll('.chk-termin').forEach(cb => { cb.checked = false; });
    const alle = document.getElementById('planAlle');
    if (alle) alle.checked = false;
    this._leiste();
  },
  _leiste() {
    const el = document.getElementById('sammelLeiste');
    if (!el) return;
    const n = this._ids.size;
    el.style.display = n ? '' : 'none';
    if (!n) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <span class="sl-text"><strong>${n}</strong> Termin${n === 1 ? '' : 'e'} gewählt</span>
      <button class="btn btn-sm btn-primary" onclick="Sammel.uebersicht()" title="Eine Übersicht über alle gewählten Termine (Ergebnis, Pflichtteile, Zulassung) – drucken">▤ Gemeinsame Übersicht</button>
      <button class="btn btn-sm btn-secondary" onclick="Sammel.zulassungsliste()" title="Nur Azubis im letzten Lehrjahr bzw. mit Zulassung/PA – Berichtsheft-Voraussetzung § 43 Abs. 1 Nr. 2 BBiG">✓ Zulassungsliste</button>
      <button class="btn btn-sm btn-secondary" onclick="Sammel.excel()" title="Ergebnisliste aller gewählten Termine als Excel">▤ Excel</button>
      <button class="btn btn-sm btn-secondary" onclick="Sammel.pdf()" title="Durchsichtsbögen aller gewählten Termine (ein PDF je Termin)">▤ Alle Bögen (PDF)</button>
      ${App.menue('⋯', [
        { label: '☑ Alle sichtbaren wählen', onclick: 'Sammel.alle(true)' },
        { trenner: true },
        { label: '⇥ Zu einem Termin zusammenführen …', onclick: 'Sammel.zusammenfuehrenDialog()', title: 'Nur für echte Doppelanlagen – für Listen über mehrere Termine die Auswertungen links nutzen' },
      ], 'Weitere Aktionen zur Auswahl', 'klein')}
      <button class="btn btn-sm btn-secondary sl-x" onclick="Sammel.leer()" aria-label="Auswahl aufheben" title="Auswahl aufheben">✕</button>`;
  },

  // ── Daten über mehrere Termine: eine Zeile je Azubi ──
  //  Steht ein Azubi in mehreren der gewählten Termine (Nachholtermin,
  //  Einzelprüfung nach dem Schultermin), zählt die jüngste Durchsicht mit
  //  Ergebnis; ein Termin ohne Ergebnis verdrängt kein Ergebnis.
  zeilen(ids) {
    const liste = (ids || []).map(Number).filter(Boolean);
    if (!liste.length) return { zeilen: [], termine: [] };
    const termine = App.query(`SELECT * FROM kontrolltermine WHERE id IN (${liste.map(() => '?').join(',')}) ORDER BY geplant_datum, id`, liste);
    const proAzubi = new Map();
    termine.forEach(t => {
      const ortBs = App.getTerminSchule(t.id);
      const klassen = App.getTerminKlassen(t.id);
      t._ort = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : (t.typ === 'einsendung' ? 'Einsendung' : '–'));
      const keMap = {};
      App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=?', [t.id]).forEach(ke => { keMap[ke.schueler_id] = ke; });
      App.getTerminSchueler(t.id).forEach(s => {
        const ke = keMap[s.id] || {};
        const z = { s, t, ke };
        const alt = proAzubi.get(s.id);
        if (!alt) { proAzubi.set(s.id, z); return; }
        const neuHatErgebnis = !!ke.ergebnis, altHatErgebnis = !!alt.ke.ergebnis;
        if ((neuHatErgebnis && !altHatErgebnis) || (neuHatErgebnis === altHatErgebnis && t.geplant_datum >= alt.t.geplant_datum)) proAzubi.set(s.id, z);
      });
    });
    const zeilen = [...proAzubi.values()].map(z => {
      const kl = z.s.klasse_id ? (App.query('SELECT k.klassenbezeichnung, bs.name AS schule FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [z.s.klasse_id])[0] || {}) : {};
      const jg = z.s.jahrgang_id ? (App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [z.s.jahrgang_id]) || '') : '';
      let befund = { ok: true, gruende: [], fz: { gesamt: 0, prozentBisher: 0 }, pflichtOK: true, imLetztenAJ: false, fehlWarn: false };
      try { befund = KontrolleHandler.zulassungsBefund(z.s, z.ke); } catch(e) {}
      const betrieb = z.s.betrieb_id ? (App.scalar('SELECT name FROM betriebe WHERE id=?', [z.s.betrieb_id]) || z.s.ausbildungsstaette || '') : (z.s.ausbildungsstaette || '');
      return { ...z, klasse: kl.klassenbezeichnung || '', schule: kl.schule || '', jg, betrieb, befund,
        isAnw: z.ke.anwesend !== 0, isDone: !!z.ke.ergebnis, isZul: z.ke.zulassung_ap === 1, isPA: z.ke.pruefungsausschuss === 1 };
    }).sort((a, b) => (a.s.nachname || '').localeCompare(b.s.nachname || '', 'de') || (a.s.vorname || '').localeCompare(b.s.vorname || '', 'de'));
    return { zeilen, termine };
  },
  // Zulassungsliste: nur, wo es um die Zulassung geht
  _zulassungsrelevant(z) { return z.befund.imLetztenAJ || z.isZul || z.isPA || z.s.vorzeitige_zulassung === 1; },

  uebersicht(ids, opt) {
    const d = this.zeilen(ids || this.ids());
    if (!d.termine.length) return App.toast('Zuerst Termine in der Liste anhaken', 'warning');
    let zeilen = d.zeilen;
    if (opt && opt.nurZulassung) zeilen = zeilen.filter(z => this._zulassungsrelevant(z));
    if (!zeilen.length) return App.toast(opt && opt.nurZulassung ? 'In den gewählten Terminen ist niemand zulassungsrelevant (letztes Lehrjahr, Zulassung oder PA)' : 'Keine Azubis in den gewählten Terminen', 'warning');
    this._drucken(this._druckHtml(zeilen, d.termine, opt || {}));
  },
  zulassungsliste(ids) { this.uebersicht(ids, { nurZulassung: true }); },
  excel(ids) {
    const liste = ids || this.ids();
    if (!liste.length) return App.toast('Zuerst Termine in der Liste anhaken', 'warning');
    BerichteHandler.exportTermineExcel(liste);
  },
  pdf(ids) {
    const liste = ids || this.ids();
    if (!liste.length) return App.toast('Zuerst Termine in der Liste anhaken', 'warning');
    liste.forEach((id, i) => setTimeout(() => PlanungHandler.exportTerminPDF(id), i * 500));
    App.toast(`${liste.length} PDF-Datei${liste.length === 1 ? '' : 'en'} (eine je Termin) werden erzeugt`, 'info');
  },

  _druckHtml(zeilen, termine, opt) {
    const nurZul = !!opt.nurZulassung;
    const titel = nurZul ? 'Zulassungsliste – Berichtsheft-Voraussetzung (§ 43 Abs. 1 Nr. 2 BBiG)' : 'Berichtsheftkontrolle – Gemeinsame Übersicht';
    const terminText = termine.map(t => `${formatDate(t.geplant_datum)} ${esc(t._ort)}${t.typ === 'einsendung' ? ' (Einsendung)' : ''}`).join(' · ');
    const mehrfach = new Set(); const gesehen = new Set();
    zeilen.forEach(z => { if (gesehen.has(z.s.id)) mehrfach.add(z.s.id); gesehen.add(z.s.id); });
    let anw = 0, ok = 0, mg = 0, pa = 0, zul = 0, offen = 0;
    const rows = zeilen.map((z, i) => {
      if (z.isAnw) anw++;
      if (z.ke.ergebnis === 'in_ordnung') ok++;
      if (z.isDone && z.ke.ergebnis !== 'in_ordnung') mg++;
      if (z.isPA) pa++;
      if (z.isZul) zul++;
      if (nurZul && !z.isZul) offen++;
      const trotz = z.isZul && !z.befund.ok;
      const bg = z.isPA ? '#fde0dc' : !z.isAnw ? '#f5f0eb' : z.isDone && z.ke.ergebnis !== 'in_ordnung' ? '#fde8e6' : z.isDone ? '#e8f5e9' : '#fff';
      const hinweis = nurZul ? (z.isZul ? (trotz ? 'Zulassung trotz Abweichung' : '') : (z.befund.gruende || []).join('; ')) : esc(z.ke.bemerkung || '');
      return `<tr style="background:${bg}">
        <td style="text-align:center">${i + 1}</td>
        <td><strong>${esc(z.s.nachname)}</strong>, ${esc(z.s.vorname)}${z.isPA ? ' <b style="color:#c0392b">PA</b>' : ''}</td>
        <td style="font-size:12px">${esc(z.betrieb || '–')}</td>
        <td style="font-size:12px">${esc(z.klasse)}${z.jg && !String(z.klasse).includes(z.jg) ? (z.klasse ? ' · ' : '') + esc(z.jg) : ''}</td>
        <td style="font-size:12px;white-space:nowrap">${formatDate(z.t.geplant_datum)}<br><span style="color:#666">${esc(z.t._ort)}</span></td>
        ${nurZul ? '' : `<td style="text-align:center">${z.isAnw ? '✓' : '–'}</td>`}
        <td>${z.isDone ? (this.ERGEBNIS[z.ke.ergebnis] || z.ke.ergebnis) : (z.isAnw ? '' : 'abwesend')}</td>
        <td style="text-align:center;${z.befund.fehlWarn ? 'color:red;font-weight:bold' : ''}">${z.befund.fz.gesamt} <span style="font-size:12px">(${Number(z.befund.fz.prozentBisher || 0).toFixed(0)}%)</span></td>
        <td style="text-align:center">${z.befund.pflichtOK ? '✓' : '–'}</td>
        <td style="text-align:center;color:${z.isZul ? (trotz ? '#b7791f' : '#27ae60') : '#999'};font-weight:${z.isZul ? '700' : '400'}">${z.isZul ? (trotz ? '✓ trotz Abw.' : '✓') : '–'}</td>
        <td style="text-align:center;color:${z.isPA ? '#c0392b' : '#999'};font-weight:${z.isPA ? '700' : '400'}">${z.isPA ? '⚠︎ PA' : '–'}</td>
        <td style="font-size:12px">${hinweis}</td>
      </tr>`;
    }).join('');
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size:12px; margin: 15mm; color: #333; }
      h1 { font-size: 16px; color: #2d5016; margin: 0 0 4px 0; }
      .sub { font-size:12px; color: #666; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #2d5016; color: white; padding: 5px 6px; font-size:12px; text-align: left; }
      td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .stats { display: flex; gap: 16px; margin: 8px 0 4px 0; font-size:12px; flex-wrap: wrap; }
      .stats span { padding: 3px 8px; border-radius: 4px; }
      @media print { body { margin: 10mm; } }
    </style></head><body>
    <h1>${esc(titel)}</h1>
    <div class="sub">${termine.length} Termin${termine.length === 1 ? '' : 'e'}: ${terminText}</div>
    <div class="stats">
      <span style="background:#f5f5f5"><strong>${zeilen.length}</strong> Azubis</span>
      ${nurZul ? `<span style="background:#e8f5e9;font-weight:bold">✓ ${zul} Voraussetzung erfüllt</span><span style="background:${offen ? '#fde8e6' : '#f5f5f5'}">${offen} offen</span>` : `<span style="background:#e8f5e9">✓ ${ok} i.O.</span><span style="background:${mg ? '#fde8e6' : '#f5f5f5'}">✗ ${mg} beanstandet</span><span style="background:#f5f5f5">${anw}/${zeilen.length} anwesend</span>${zul ? `<span style="background:#e8f5e9;font-weight:bold">${zul} Voraussetzung erfüllt</span>` : ''}`}
      ${pa ? `<span style="background:#fde8e6;color:#c0392b;font-weight:bold">⚠︎ ${pa} Prüfungsausschuss</span>` : ''}
    </div>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Betrieb</th><th>Klasse · Jahrgang</th><th>Durchsicht</th>${nurZul ? '' : '<th title="Anwesend bei Durchsicht">Anw.</th>'}<th>Ergebnis</th><th title="Fehltage gesamt (ohne Urlaub) und Anteil an der bisherigen Ausbildungszeit">Fehl.</th><th title="Pflichtteile 1.1 und 1.5 vollständig">Pfl.</th><th title="Berichtsheft-Voraussetzung für die Zulassung erfüllt (§ 43 Abs. 1 Nr. 2 BBiG)">Zul.</th><th title="Prüfungsausschuss (§ 46 BBiG)">PA</th><th>${nurZul ? 'Was fehlt' : 'Bemerkung'}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;font-size:12px;color:#999;border-top:1px solid #ddd;padding-top:4px">
      Regierungspräsidium Freiburg · Abt. 3 · Ref. 31 · Erstellt: ${new Date().toLocaleDateString('de-DE')}${mehrfach.size ? ' · Bei Azubis in mehreren Terminen zählt die jüngste Durchsicht mit Ergebnis' : ''}
    </div>
    </body></html>`;
  },
  _drucken(html) {
    const w = window.open('', '_blank');
    if (!w) return App.toast('Das Druckfenster wurde blockiert – Pop-ups für diese Seite erlauben', 'error');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  },

  // ── Zusammenführen: nur für echte Doppelanlagen ──
  //  Ein Termin bleibt (Datum, Ort, Prüfer, Status), die anderen geben Klassen,
  //  Einzelzuordnungen und Kontrollergebnisse samt Mängeln, Wiedervorlagen und
  //  Archiv-Bögen an ihn ab und werden gelöscht. Doppelte Azubis: das Ergebnis
  //  mit Inhalt bleibt, ein leerer Bogen fällt weg. Nicht rückgängig zu machen.
  _kandidaten(zielId) {
    const z = App.query('SELECT * FROM kontrolltermine WHERE id=?', [zielId])[0];
    if (!z) return [];
    const alle = App.query("SELECT * FROM kontrolltermine WHERE id != ? AND status != 'abgesagt' AND geplant_datum BETWEEN date(?, '-180 days') AND date(?, '+180 days') ORDER BY ABS(julianday(geplant_datum) - julianday(?)), id", [zielId, z.geplant_datum, z.geplant_datum, z.geplant_datum]);
    const ort = App.getTerminSchule(zielId);
    // Dieselbe Schule zuerst
    return alle.sort((a, b) => {
      const sa = ort && a.berufsschule_id === ort.id ? 0 : 1, sb = ort && b.berufsschule_id === ort.id ? 0 : 1;
      return sa - sb;
    }).slice(0, 40);
  },
  _terminLabel(t) {
    const bs = App.getTerminSchule(t.id);
    const n = App.getTerminSchuelerCount ? App.getTerminSchuelerCount(t.id) : App.getTerminSchueler(t.id).length;
    const ke = App.scalar("SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=? AND ergebnis != ''", [t.id]) || 0;
    return `${formatDate(t.geplant_datum)} · ${esc(bs ? bs.name : (t.typ === 'einsendung' ? 'Einsendung' : 'ohne Ort'))} · ${n} Azubis${ke ? ` · ${ke} Ergebnisse` : ''}${t.status === 'durchgefuehrt' ? ' · abgeschlossen' : ''}${t.bemerkung ? ` <span class="sm-bem">${esc(t.bemerkung)}</span>` : ''}`;
  },
  vorschau(ids, zielId) {
    const liste = ids.map(Number);
    const proAzubi = {};
    liste.forEach(id => {
      const keMap = {};
      App.query("SELECT schueler_id, ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=?", [id]).forEach(k => { keMap[k.schueler_id] = k; });
      App.getTerminSchueler(id).forEach(s => {
        if (!proAzubi[s.id]) proAzubi[s.id] = { termine: 0, mitErgebnis: 0 };
        proAzubi[s.id].termine++;
        if (keMap[s.id] && keMap[s.id].ergebnis) proAzubi[s.id].mitErgebnis++;
      });
    });
    const werte = Object.values(proAzubi);
    const termine = App.query(`SELECT status FROM kontrolltermine WHERE id IN (${liste.map(() => '?').join(',')})`, liste);
    return {
      azubis: werte.length,
      doppelt: werte.filter(w => w.termine > 1).length,
      verloren: werte.filter(w => w.mitErgebnis > 1).length,
      alleAbgeschlossen: termine.length > 0 && termine.every(t => t.status === 'durchgefuehrt'),
      teilsAbgeschlossen: termine.some(t => t.status === 'durchgefuehrt') && !termine.every(t => t.status === 'durchgefuehrt'),
    };
  },
  _vorschlagZiel(ids) {
    // Der Termin mit den meisten Ergebnissen bleibt, bei Gleichstand der früheste
    const liste = ids.map(Number);
    return App.query(`SELECT t.id, (SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=t.id AND ergebnis != '') AS n FROM kontrolltermine t WHERE t.id IN (${liste.map(() => '?').join(',')}) ORDER BY n DESC, t.geplant_datum, t.id`, liste)[0]?.id || liste[0];
  },
  zusammenfuehrenDialog(ids, zielId) {
    let liste = (ids || this.ids()).map(Number).filter(Boolean);
    // Von der Termin-Seite: ein Termin ist gesetzt, die anderen werden hier gewählt
    if (liste.length < 2 && zielId) {
      const kand = this._kandidaten(zielId);
      if (!kand.length) return App.toast('Kein anderer Termin im Umkreis von 180 Tagen', 'warning');
      App.openModal('Termine zusammenführen', `
        <p class="sm-hinweis">Welche Termine sollen in <strong>${this._terminLabel(App.query('SELECT * FROM kontrolltermine WHERE id=?', [zielId])[0])}</strong> aufgehen? Nur für echte Doppelanlagen – für eine Liste über mehrere Termine die Auswertungen in der Termine-Liste nutzen.</p>
        <div class="sm-liste">${kand.map(t => `<label class="sm-zeile"><input type="checkbox" class="chk-sm-kand" value="${t.id}"> <span>${this._terminLabel(t)}</span></label>`).join('')}</div>`,
        `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
         <button class="btn btn-primary" onclick="Sammel._kandidatenWeiter(${zielId})">Weiter ›</button>`);
      return;
    }
    if (liste.length < 2) return App.toast('Mindestens zwei Termine anhaken', 'warning');
    const termine = App.query(`SELECT * FROM kontrolltermine WHERE id IN (${liste.map(() => '?').join(',')}) ORDER BY geplant_datum, id`, liste);
    const ziel = Number(zielId) && liste.includes(Number(zielId)) ? Number(zielId) : this._vorschlagZiel(liste);
    App.openModal('Termine zusammenführen', `
      <p class="sm-hinweis">Ein Termin bleibt – mit seinem Datum, Ort, Prüfer und Status. Die anderen geben Klassen, Azubis und alle Ergebnisse an ihn ab und werden gelöscht. <strong>Das lässt sich nicht rückgängig machen.</strong></p>
      <div class="sm-liste" id="smListe">
        ${termine.map(t => `<label class="sm-zeile"><input type="radio" name="smZiel" value="${t.id}" ${t.id === ziel ? 'checked' : ''} onchange="Sammel._zielGeaendert()"> <span>${this._terminLabel(t)}</span><span class="sm-bleibt">${t.id === ziel ? 'bleibt' : ''}</span></label>`).join('')}
      </div>
      <div class="form-group" style="margin-top:12px"><label for="smTitel">Bezeichnung des Termins</label><input class="form-control" id="smTitel" value="${esc(this._titelVorschlag(ziel, liste))}" maxlength="120"></div>
      <div id="smVorschau" class="sm-vorschau">${this._vorschauHtml(liste, ziel)}</div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
       <button class="btn btn-primary btn-gefaehrlich" onclick="Sammel.zusammenfuehren([${liste.join(',')}], parseInt(document.querySelector('input[name=smZiel]:checked')?.value), document.getElementById('smTitel')?.value)">⇥ Zusammenführen</button>`);
    this._dialogIds = liste;
  },
  _kandidatenWeiter(zielId) {
    const gew = [...document.querySelectorAll('.chk-sm-kand:checked')].map(c => Number(c.value));
    if (!gew.length) return App.toast('Mindestens einen Termin anhaken', 'warning');
    this.zusammenfuehrenDialog([Number(zielId), ...gew], zielId);
  },
  _titelVorschlag(zielId, ids) {
    const z = App.query('SELECT bemerkung FROM kontrolltermine WHERE id=?', [zielId])[0];
    if (z && z.bemerkung) return z.bemerkung;
    try { return App.generateTerminTitel(zielId) || ''; } catch(e) { return ''; }
  },
  _vorschauHtml(ids, zielId) {
    const v = this.vorschau(ids, zielId);
    const teile = [`→ <strong>1 Termin</strong> mit <strong>${v.azubis}</strong> Azubis`];
    if (v.doppelt) teile.push(`${v.doppelt} Azubi${v.doppelt === 1 ? ' war' : 's waren'} in mehreren Terminen – das Ergebnis mit Inhalt bleibt`);
    if (v.verloren) teile.push(`<span class="sm-warn">⚠︎ ${v.verloren} Azubi${v.verloren === 1 ? ' hat' : 's haben'} in mehreren Terminen ein Ergebnis – nur das des bleibenden Termins wird behalten</span>`);
    if (v.teilsAbgeschlossen) teile.push('Der zusammengeführte Termin gilt als <strong>geplant</strong>, weil nicht alle abgeschlossen waren – danach wie gewohnt abschließen');
    else if (v.alleAbgeschlossen) teile.push('Der zusammengeführte Termin bleibt <strong>abgeschlossen</strong>');
    return teile.join('<br>');
  },
  _zielGeaendert() {
    const ziel = parseInt(document.querySelector('input[name=smZiel]:checked')?.value);
    if (!ziel) return;
    document.querySelectorAll('#smListe .sm-zeile').forEach(l => { const r = l.querySelector('input'); const b = l.querySelector('.sm-bleibt'); if (b) b.textContent = Number(r.value) === ziel ? 'bleibt' : ''; });
    const titel = document.getElementById('smTitel'); if (titel) titel.value = this._titelVorschlag(ziel, this._dialogIds || []);
    const v = document.getElementById('smVorschau'); if (v) v.innerHTML = this._vorschauHtml(this._dialogIds || [], ziel);
  },
  async zusammenfuehren(ids, zielId, titel, opts) {
    const liste = (ids || []).map(Number).filter(Boolean);
    zielId = Number(zielId);
    if (liste.length < 2 || !liste.includes(zielId)) return App.toast('Zieltermin wählen', 'error');
    const quellen = liste.filter(id => id !== zielId);
    const v = this.vorschau(liste, zielId);
    if (!(opts && opts.ohneRueckfrage)) {
      const ok = await App.confirm(`${quellen.length} Termin${quellen.length === 1 ? '' : 'e'} in einen zusammenführen?\n\n${v.azubis} Azubis${v.verloren ? `, ${v.verloren} doppelte Ergebnisse gehen verloren` : ''}. Die aufgegebenen Termine werden gelöscht. Das lässt sich nicht rückgängig machen.`, { titel: 'Termine zusammenführen', ok: 'Zusammenführen', gefaehrlich: true });
      if (!ok) return;
    }
    const ziel = App.query('SELECT * FROM kontrolltermine WHERE id=?', [zielId])[0];
    if (!ziel) return App.toast('Zieltermin nicht gefunden', 'error');
    const alleTermine = App.query(`SELECT * FROM kontrolltermine WHERE id IN (${liste.map(() => '?').join(',')})`, liste);
    const alleAbgeschlossen = alleTermine.every(t => t.status === 'durchgefuehrt');
    // Deps eines Kontrollergebnisses entfernen (leerer Bogen, der dem Ergebnis des anderen Termins weicht)
    const keEntfernen = (keId) => {
      App.run('DELETE FROM kw_maengel WHERE kontrollergebnis_id=?', [keId]);
      App.run('DELETE FROM durchsicht_snapshots WHERE kontrollergebnis_id=?', [keId]);
      App.run('DELETE FROM wiedervorlage_notizen WHERE wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE kontrollergebnis_id=?)', [keId]);
      App.run('DELETE FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId]);
      App.run('DELETE FROM kontrollergebnisse WHERE id=?', [keId]);
    };
    let bewegt = 0, verworfen = 0;
    quellen.forEach(qId => {
      App.query('SELECT klasse_id FROM kontrolltermin_klassen WHERE kontrolltermin_id=?', [qId]).forEach(r => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [zielId, r.klasse_id]);
      });
      App.query('SELECT schueler_id FROM kontrolltermin_schueler WHERE kontrolltermin_id=?', [qId]).forEach(r => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [zielId, r.schueler_id]);
      });
      // Azubis, die in der Quelle nur über eine Klasse hingen, die das Ziel nicht hat, sind über die
      // soeben übernommene Klasse weiter dabei; Einzelzuordnungen oben.
      App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=?', [qId]).forEach(ke => {
        const imZiel = App.query('SELECT id, ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [zielId, ke.schueler_id])[0];
        if (imZiel) {
          if (!imZiel.ergebnis && ke.ergebnis) { keEntfernen(imZiel.id); }
          else { keEntfernen(ke.id); verworfen++; return; }
        }
        // Natürlicher Schlüssel (Termin + Azubi) – so spielen es die Kollegen richtig nach
        App.run('UPDATE kontrollergebnisse SET kontrolltermin_id=? WHERE kontrolltermin_id=? AND schueler_id=?', [zielId, qId, ke.schueler_id]);
        bewegt++;
      });
    });
    const neuerTitel = String(titel == null ? (ziel.bemerkung || '') : titel).trim();
    const ersteKlasse = App.scalar('SELECT klasse_id FROM kontrolltermin_klassen WHERE kontrolltermin_id=? ORDER BY id LIMIT 1', [zielId]);
    App.run('UPDATE kontrolltermine SET bemerkung=?, status=?, klasse_id=COALESCE(klasse_id, ?) WHERE id=?',
      [neuerTitel, alleAbgeschlossen ? 'durchgefuehrt' : 'geplant', ersteKlasse || null, zielId]);
    if (!alleAbgeschlossen) App.run("UPDATE kontrolltermine SET nachbereitet_am='' WHERE id=?", [zielId]);
    quellen.forEach(qId => App.deleteTerminKaskade(qId, { ohnePapierkorb: true }));
    try { App.invalidateTerminCache(); } catch(e) {}
    this._ids.clear();
    try { App.closeModal(); } catch(e) {}
    App.toast(`${quellen.length + 1} Termine zusammengeführt – ${bewegt} Ergebnisse übernommen${verworfen ? `, ${verworfen} doppelte verworfen` : ''}`, 'success');
    if (App.currentView === 'termin' && typeof TerminSeite !== 'undefined') TerminSeite.oeffnen(zielId);
    else if (App.currentView === 'planung') Views.planung();
    return { zielId, bewegt, verworfen };
  },
};
