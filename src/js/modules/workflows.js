// ═══════════════════════════════════════════════════════════════════
//  Schriftverkehr: E-Mails und Briefe an Schulen, Betriebe, fremde Ämter.
//  Alle Texte kommen aus App.VORLAGEN (in den Einstellungen anpassbar);
//  die Platzhalter werden aus einem gemeinsamen Termin-Kontext gefüllt.
// ═══════════════════════════════════════════════════════════════════
const Workflows = {
  // ── Gemeinsamer Kontext eines Termins für alle Vorlagen ──
  _ctxTermin(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return null;
    const klassen = App.getTerminKlassen(terminId);
    // ORT des Termins (explizit gesetzt, z.B. LFK-Standort) – nicht die
    // Stammschule der ersten Klasse: sonst nannten Betriebs-Anschreiben bei
    // Landesfachklassen-Terminen den falschen Kontrollort.
    const ortBs = App.getTerminSchule(terminId);
    const schule = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : '');
    const schuleOrt = ortBs ? (ortBs.ort || '') : (klassen.length ? (klassen[0].schule_ort || '') : '');
    const schuelerList = App.getTerminSchueler(terminId);
    const prueferList = (termin.pruefer || '').split(',').map(s => s.trim()).filter(Boolean);
    const pruefer = prueferList.join(', ') || 'Ausbildungsberater';
    const datum = formatDate(termin.geplant_datum);
    const wochentag = new Date(termin.geplant_datum + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' });
    const anzPruefer = Math.max(prueferList.length, 1);
    const dauerStd = Math.ceil(schuelerList.length * 10 / 60 / anzPruefer);
    const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    return {
      termin, klassen, schuleObj: ortBs, schuelerList, prueferList,
      ctx: {
        ...App.absenderCtx(pruefer),
        pruefer, datum, wochentag,
        schule: schule || '?',
        schule_ort: schuleOrt ? ' in ' + schuleOrt : '',
        schule_ort_roh: schuleOrt,
        klassen: klassenStr || '–',
        fachrichtung: frStr || 'Gärtner/in',
        anzahl: String(schuelerList.length),
        anzahl_pruefer: String(anzPruefer),
        dauer: `${dauerStd} Stunde${dauerStd > 1 ? 'n' : ''}`,
        raumhinweis: anzPruefer > 1 ? `einen Raum mit ${anzPruefer} Arbeitsplätzen für die parallele Durchsicht` : 'einen Raum, in dem wir die Berichtshefte einsehen können',
      },
    };
  },
  _anrede(ap) { return ap ? `\nsehr geehrte/r ${ap},` : ''; },
  _eLbl: { in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung bei nächster Durchsicht', sachberichte_wetter_email: 'Sachberichte/Wetter per E-Mail nachreichen', berichte_bis_termin_email: 'Berichte per E-Mail nachreichen', persoenliche_vorlage_rp: 'Persönliche Vorlage im RP', post_an_rp: 'Vorlage per Post im RP' },
  _codeLabels: { A: 'Unterschrift Azubi fehlt', B: 'Unterschrift Ausbilder fehlt', C: 'Berufsschulthemen fehlen', D: 'Wetteraufzeichnungen fehlen', E: 'Inhaltlich lückenhaft', F: 'Berichte fehlen komplett', G: 'Datum/KW falsch', H: 'Fehltage nicht eingetragen', I: 'Sonstiges' },

  // Gruppen (Fachrichtung + AJ) und Namensliste je Klasse für die Schul-Mails
  _gruppenUndListe(t) {
    const frAjGroups = {};
    t.klassen.forEach(k => {
      const aj = App.getAJFromJahrgang(k.jahrgang_id, t.termin.geplant_datum);
      const fr = k.fachrichtung || 'Gartenbau';
      const key = `${fr}|${aj}`;
      if (!frAjGroups[key]) frAjGroups[key] = { fr, aj, jgBez: k.jg_bez || '', count: 0 };
    });
    t.schuelerList.forEach(s => {
      const k = t.klassen.find(x => x.id === s.klasse_id);
      if (k) { const key = `${k.fachrichtung || 'Gartenbau'}|${App.getAJFromJahrgang(k.jahrgang_id, t.termin.geplant_datum)}`; if (frAjGroups[key]) frAjGroups[key].count++; }
    });
    const list = Object.values(frAjGroups).sort((a, b) => a.fr.localeCompare(b.fr) || a.aj - b.aj);
    const gruppen = list.length
      ? list.map(g => `  - ${g.fr} ${g.aj}. AJ (Abschluss ${g.jgBez})${g.count ? ': ' + g.count + ' Auszubildende' : ''}`).join('\n')
      : `  - ${t.schuelerList.length} Auszubildende (Einzelzuordnung)`;
    const gruppenKurz = list.length ? list.map(g => `${g.fr} ${g.aj}. AJ`).join(', ') : t.ctx.klassen;
    // Namensliste, gruppiert nach (tatsächlicher) Klasse
    const byKl = {};
    t.schuelerList.forEach(s => {
      const k = t.klassen.find(x => x.id === s.klasse_id) || App.query('SELECT k.klassenbezeichnung FROM klassen k WHERE k.id=?', [s.klasse_id])[0];
      const key = k ? k.klassenbezeichnung : 'ohne Klasse';
      (byKl[key] = byKl[key] || []).push(`${s.nachname}, ${s.vorname}`);
    });
    const azubiListe = Object.keys(byKl).sort().map(kl => `${kl}:\n  - ${byKl[kl].sort().join('\n  - ')}`).join('\n');
    return { gruppen, gruppenKurz, azubiListe };
  },

  // ── A) E-Mail an Schule (Terminanfrage / Ergebnis-Mitteilung) ──
  emailSchule(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return App.toast('Termin nicht gefunden', 'error');
    const schule = t.schuleObj;
    if (!schule) {
      return App.toast(t.termin.typ === 'einsendung'
        ? 'Diesem Termin ist keine Schule zugeordnet (Ort im Termin-Dialog wählbar)'
        : 'Keine Schule zugeordnet – Ort im Termin-Dialog wählen', 'warning');
    }
    const isDone = t.termin.status === 'durchgefuehrt';
    const { gruppen, gruppenKurz, azubiListe } = this._gruppenUndListe(t);
    const ctx = { ...t.ctx, gruppen, gruppen_kurz: gruppenKurz, azubi_liste: azubiListe };
    if (isDone) {
      const results = {};
      t.schuelerList.forEach(s => {
        const ke = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
        const e = ke?.ergebnis || 'nicht kontrolliert';
        (results[e] = results[e] || []).push(`${s.nachname}, ${s.vorname}`);
      });
      ctx.ergebnisse = Object.entries(results).map(([e, names]) => `\n${this._eLbl[e] || e} (${names.length}):\n  - ${names.join('\n  - ')}\n`).join('');
    }
    const { betreff, body } = App.renderVorlage(isDone ? 'schule_ergebnis' : 'schule_anfrage', ctx);
    const to = (schule.email || '').trim();
    const cc = (schule.email_cc || '').trim();
    const emailType = isDone ? 'Ergebnis-Mitteilung' : 'Terminanfrage';
    window._pendingEmail = { to, subject: betreff, body, cc };

    if (!to) {
      App.openModal(`✉︎ ${emailType} an Schule`, `
        <div style="padding:8px 12px;background:var(--clr-amber-light);border-radius:var(--radius);margin-bottom:12px;font-size:13px">
          ⚠︎ Keine E-Mail-Adresse für "${esc(schule.name)}" hinterlegt. Sie können sie hier eintragen – sie wird in den Stammdaten gespeichert.
        </div>
        <div class="form-group"><label>E-Mail-Adresse(n)</label><input class="form-control" id="mSchEmail2" placeholder="email@schule.de"></div>
        <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;max-height:200px;overflow-y:auto"><pre style="white-space:pre-wrap;font-family:inherit">${esc(body)}</pre></div>
      `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
          <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+document.getElementById('mSchEmail2').value+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
          <button class="btn btn-primary" onclick="Workflows._schulEmailMerkenUndOeffnen(${schule.id})">✉︎ E-Mail öffnen</button>`);
      return;
    }
    App.openModal(`✉︎ ${emailType} an ${esc(schule.name)}`, `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${esc(to)}</div>
        ${cc ? `<div><strong>CC:</strong> ${esc(cc)}</div>` : ''}
        <div><strong>Betreff:</strong> ${esc(betreff)}</div>
        <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">${isDone ? 'Ergebnis-Mitteilung nach Kontrolle' : 'Terminanfrage – bitte Datum bestätigen lassen'} · Text anpassbar unter Einstellungen → Vorlagen</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:300px;overflow-y:auto">${esc(body)}</pre>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+window._pendingEmail.to+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        <button class="btn btn-primary" onclick="Workflows.openMailto(window._pendingEmail.to, window._pendingEmail.subject, window._pendingEmail.body, window._pendingEmail.cc);App.closeModal()">✉︎ In Outlook öffnen</button>`);
  },
  _schulEmailMerkenUndOeffnen(schuleId) {
    const adr = (document.getElementById('mSchEmail2')?.value || '').trim();
    if (!adr) return App.toast('Bitte E-Mail-Adresse eingeben', 'warning');
    // In den Stammdaten merken – sonst beim nächsten Mal wieder Handarbeit
    App.run('UPDATE berufsschulen SET email=? WHERE id=? AND (email IS NULL OR email=\'\')', [adr, schuleId]);
    this.openMailto(adr, window._pendingEmail.subject, window._pendingEmail.body, window._pendingEmail.cc);
    App.closeModal();
  },

  // ── Betriebs-Gruppierung eines Termins ──
  _betriebeDesTermins(terminId, mitErgebnis) {
    const schueler = App.getTerminSchueler(terminId).map(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      const ke = mitErgebnis ? App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0] : null;
      const maengel = mitErgebnis ? App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [s.id]) : [];
      return { ...s, b, ke, maengel,
        b_name: b?.name || s.ausbildungsstaette || '', b_vorname: b?.vorname || '', b_zusatz: b?.zusatzbezeichnung || '',
        b_firma: b?.zusatzbezeichnung || b?.firma || '', b_ap: b?.ansprechpartner || '',
        b_strasse: b?.strasse || '', b_plz: b?.plz || '', b_ort: b?.ort || '', b_email: b?.email || '', b_tel: b?.telefon || '' };
    });
    const grouped = {};
    schueler.forEach(s => {
      const key = s.betrieb_id || s.ausbildungsstaette || '?';
      if (!grouped[key]) grouped[key] = { key, betrieb: s, betriebId: s.betrieb_id || null, name: s.b_name, email: s.b_email, ap: s.b_ap, azubis: [] };
      grouped[key].azubis.push(s);
    });
    return { schueler, betriebe: Object.values(grouped) };
  },
  _azubiBlock(azubis, mitErgebnis) {
    return azubis.map(a => {
      let line = '  - ' + a.nachname + ', ' + a.vorname;
      if (mitErgebnis && a.ke?.ergebnis) line += ': ' + (this._eLbl[a.ke.ergebnis] || a.ke.ergebnis);
      if (mitErgebnis && a.maengel?.length) {
        a.maengel.forEach(m => {
          line += '\n    → AJ ' + m.ausbildungsjahr + ', KW ' + m.kalenderwoche + ': ' + m.maengel_codes.split(',').map(c => this._codeLabels[c.trim()] || c).join(', ');
        });
      }
      return line;
    }).join('\n');
  },

  // ── B) Seriendruck-Hub: Betriebe anschreiben ──
  seriendruckBetriebe(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return App.toast('Termin nicht gefunden', 'error');
    const { schueler, betriebe } = this._betriebeDesTermins(terminId, false);
    App.openModal('▤ Betriebe anschreiben – Seriendruck', `
      <p style="font-size:13px;margin-bottom:12px">
        <strong>${betriebe.length} Betriebe</strong> mit insgesamt ${schueler.length} Azubis für den Termin am <strong>${t.ctx.datum}</strong>
        an der ${esc(t.ctx.schule)}${esc(t.ctx.schule_ort)}${t.klassen.length ? ', Klasse(n) ' + esc(t.ctx.klassen) : ''}.
      </p>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">
        <table class="data-table"><thead><tr><th>Betrieb</th><th>Ort</th><th>E-Mail</th><th>Azubis</th></tr></thead><tbody>
          ${betriebe.map(g => `<tr>
            <td><strong>${esc(g.name)}</strong></td>
            <td>${esc(g.betrieb.b_ort || '')}</td>
            <td>${g.email ? esc(g.email) : '<span style="color:var(--clr-red)">– (Brief)</span>'}</td>
            <td>${g.azubis.map(a => esc(a.nachname)).join(', ')}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
      <p style="font-size:12px;color:var(--clr-text-light)">E-Mail für Betriebe mit Adresse, Brief (PDF/Word) für alle – Texte anpassbar unter Einstellungen → Vorlagen.</p>
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>' +
        '<button class="btn btn-success" onclick="Workflows.emailBetriebIndividuell(' + terminId + ')" title="Individuelle E-Mails an jeden Betrieb mit Azubi-Details">✉︎ Individuelle E-Mails</button>' +
        '<button class="btn btn-secondary" onclick="Workflows.emailBetriebeBCC(' + terminId + ')" title="E-Mail mit allen Betrieben im BCC">✉︎ BCC</button>' +
        '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckCSV(' + terminId + ')">CSV</button>' +
        (App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template'") ? '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckWord(' + terminId + ')">✎ Word</button>' : '') +
        '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckPDF(' + terminId + ')">▤ PDF-Briefe</button>');
  },

  // ── BCC Serien-E-Mail an alle Betriebe ──
  emailBetriebeBCC(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const { betriebe } = this._betriebeDesTermins(terminId, false);
    const emails = [...new Set(betriebe.map(g => g.email).filter(Boolean))];
    const ohne = betriebe.filter(g => !g.email);
    const { betreff, body } = App.renderVorlage('betrieb_bcc', t.ctx);
    App.closeModal();
    App.openModal(`✉︎ Serien-E-Mail an ${emails.length} Betriebe (BCC)`, `
      <div style="margin-bottom:8px;font-size:12px">
        <strong>${emails.length}</strong> Betriebe mit E-Mail${ohne.length ? ` · <span style="color:var(--clr-red)">${ohne.length} ohne E-Mail (Brief nötig): ${esc(ohne.map(g => g.name).join(', '))}</span>` : ''}
      </div>
      <div style="max-height:80px;overflow-y:auto;margin-bottom:8px;font-size:11px;padding:6px;background:var(--clr-warm);border-radius:var(--radius)">
        ${emails.map(e => `<span style="display:inline-block;padding:1px 6px;margin:1px;background:var(--clr-white);border-radius:4px">${esc(e)}</span>`).join('')}
      </div>
      <div class="form-group"><label>Betreff</label><input class="form-control" id="bccSubject" value="${esc(betreff)}"></div>
      <div class="form-group"><label>Text (kann vor dem Senden im E-Mail-Programm bearbeitet werden)</label>
        <textarea class="form-control" id="bccBody" rows="10" style="font-size:12px;font-family:monospace">${esc(body)}</textarea>
      </div>
      <div style="font-size:11px;color:var(--clr-text-light);margin-top:8px">
        Alle Empfänger stehen im <strong>BCC</strong> – die Betriebe sehen sich gegenseitig nicht.
        ${t.ctx.rp_email ? `Absender/An: ${esc(t.ctx.rp_email)}` : '<span style="color:var(--clr-amber)">Tipp: Unter Einstellungen → Kontaktdaten eine RP-E-Mail hinterlegen, dann steht sie im An-Feld.</span>'}
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('bccBody').value);App.toast('Text kopiert','success')">▤ Text kopieren</button>
        <button class="btn btn-sm btn-secondary" onclick="Workflows._kopiereBccAdressen()">▤ Adressen kopieren</button>
        ${ohne.length ? `<button class="btn btn-sm btn-secondary" onclick="Workflows.exportSeriendruckPDF(${terminId}, true)" title="PDF-Briefe nur für Betriebe ohne E-Mail">▤ Briefe für ${ohne.length} ohne E-Mail</button>` : ''}
        <button class="btn btn-primary" onclick="Workflows._openBCCMail()">✉︎ E-Mail öffnen</button>`);
    this._bccEmails = emails;
  },
  _kopiereBccAdressen() {
    navigator.clipboard.writeText((this._bccEmails || []).join('; ')).then(() => App.toast('Adressen kopiert (durch ; getrennt)', 'success'));
  },
  _openBCCMail() {
    const subject = document.getElementById('bccSubject').value;
    const body = document.getElementById('bccBody').value;
    const bcc = (this._bccEmails || []).join(',');
    const rpEmail = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_email'") || '';
    this.openMailto(rpEmail, subject, body, '', bcc);
    App.closeModal();
  },

  // ── Individuelle E-Mails pro Betrieb (Ankündigung / Mängel / ohne Beanstandung) ──
  emailBetriebIndividuell(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const { betriebe } = this._betriebeDesTermins(terminId, true);
    const isDone = t.termin.status === 'durchgefuehrt';
    App.closeModal();
    let listHtml = '';
    betriebe.forEach((g, idx) => {
      const details = g.azubis.map(a => {
        let d = '<strong>' + esc(a.nachname) + ', ' + esc(a.vorname) + '</strong>';
        if (a.ke?.ergebnis) d += ' → ' + esc(this._eLbl[a.ke.ergebnis] || a.ke.ergebnis);
        if (a.maengel.length) d += '<br><span style="color:var(--clr-red);font-size:10px">' + a.maengel.map(m => 'AJ' + m.ausbildungsjahr + '/KW' + m.kalenderwoche + ': ' + esc(m.maengel_codes)).join(', ') + '</span>';
        return d;
      }).join('<br>');
      const art = !isDone ? 'Ankündigung' : (g.azubis.some(a => a.ke?.ergebnis && a.ke.ergebnis !== 'in_ordnung') ? 'Mängelmitteilung' : 'ohne Beanstandung');
      listHtml += `<div style="padding:8px 10px;margin-bottom:6px;background:${g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <strong>${esc(g.name)}</strong> <span style="font-size:10px;color:var(--clr-text-light)">${art}</span>
          <span style="display:flex;gap:4px">
            ${g.email
              ? `<button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:var(--clr-forest);color:var(--clr-white);border:none" onclick="Workflows._openIndividualEmail(${terminId},${idx})">✉︎ Senden</button>`
              : `<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px" onclick="Workflows.exportSeriendruckPDF(${terminId}, false, '${esc(String(g.key))}')" title="Brief nur für diesen Betrieb">▤ Brief</button>
                 ${g.betriebId ? `<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px" onclick="Workflows._betriebEmailNachtragen(${g.betriebId}, ${terminId})" title="E-Mail-Adresse in den Stammdaten nachtragen">✎ E-Mail nachtragen</button>` : ''}`}
          </span>
        </div>
        <div style="font-size:11px">${g.email ? '✉︎ ' + esc(g.email) : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt</span>'}${g.ap ? ' · ' + esc(g.ap) : ''}</div>
        <div style="margin-top:4px">${details}</div>
      </div>`;
    });
    this._individualData = { terminId, betriebe, t, isDone };
    const withEmail = betriebe.filter(g => g.email).length;
    App.openModal('✉︎ Individuelle E-Mails an ' + betriebe.length + ' Betriebe', `
      <div style="margin-bottom:8px;font-size:13px"><strong>${withEmail}</strong> Betriebe mit E-Mail${betriebe.length - withEmail ? ` · <span style="color:var(--clr-red)">${betriebe.length - withEmail} ohne E-Mail → Brief</span>` : ''}</div>
      <div style="max-height:400px;overflow-y:auto">${listHtml}</div>
      <div style="margin-top:8px;font-size:11px;color:var(--clr-text-light)">Je Betrieb wird automatisch die passende Vorlage gewählt: Terminankündigung, Mängelmitteilung oder Bestätigung „ohne Beanstandung".</div>`,
      '<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>' +
      (withEmail > 1 ? '<button class="btn btn-success" onclick="Workflows._openAllIndividualEmails()">✉︎ Alle ' + withEmail + ' nacheinander öffnen</button>' : ''));
  },
  _betriebEmailNachtragen(betriebId, terminId) {
    const adr = prompt('E-Mail-Adresse des Betriebs (wird in den Stammdaten gespeichert):');
    if (!adr) return;
    App.run('UPDATE betriebe SET email=? WHERE id=?', [adr.trim(), betriebId]);
    App.toast('E-Mail-Adresse gespeichert', 'success');
    this.emailBetriebIndividuell(terminId);
  },
  _openIndividualEmail(terminId, betriebIdx) {
    const d = this._individualData;
    if (!d) return;
    const g = d.betriebe[betriebIdx];
    if (!g || !g.email) return App.toast('Keine E-Mail-Adresse', 'warning');
    const hasMaengel = g.azubis.some(a => a.ke?.ergebnis && a.ke.ergebnis !== 'in_ordnung');
    // Nach der Kontrolle: Mängelmitteilung ODER Bestätigung ohne Beanstandung –
    // früher bekam ein Betrieb ohne Beanstandung eine Terminankündigung im
    // Futur für einen längst vergangenen Termin.
    const typ = !d.isDone ? 'betrieb_ankuendigung' : (hasMaengel ? 'betrieb_maengel' : 'betrieb_ok');
    const ctx = { ...d.t.ctx, anrede: this._anrede(g.ap),
      azubi_block: this._azubiBlock(g.azubis, d.isDone),
      azubi_namen: g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / ') };
    const { betreff, body } = App.renderVorlage(typ, ctx);
    this.openMailto(g.email, betreff, body);
    App.toast('E-Mail an ' + g.name + ' geöffnet', 'success');
  },
  _openAllIndividualEmails() {
    const d = this._individualData;
    if (!d) return;
    const mit = d.betriebe.map((g, idx) => ({ g, idx })).filter(x => x.g.email);
    // Popup-Blocker lassen nur die erste automatisch geöffnete Mail zu –
    // deshalb nacheinander per Klick, nicht per Timer
    let i = 0;
    const naechste = () => {
      if (i >= mit.length) { App.closeModal(); return App.toast('Alle E-Mails geöffnet', 'success'); }
      const { g, idx } = mit[i++];
      App.openModal(`✉︎ E-Mail ${i} von ${mit.length}`, `<div style="font-size:13px">Als nächstes: <strong>${esc(g.name)}</strong> (${esc(g.email)})</div>`,
        `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
         <button class="btn btn-primary" id="btnNaechsteMail">✉︎ Öffnen &amp; weiter</button>`);
      setTimeout(() => { const b = document.getElementById('btnNaechsteMail'); if (b) b.onclick = () => { this._openIndividualEmail(d.terminId, idx); naechste(); }; }, 20);
    };
    naechste();
  },

  exportSeriendruckCSV(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const { betriebe } = this._betriebeDesTermins(terminId, false);
    let csv = 'Betriebsname;Firma;Ansprechpartner;Straße;PLZ;Ort;E-Mail;Anzahl_Azubis;Azubi_Namen;Schule;Klasse;Kontrolldatum\n';
    betriebe.forEach(g => {
      const b = g.betrieb;
      csv += [g.name, b.b_firma || '', b.b_ap || '', b.b_strasse || '', b.b_plz || '', b.b_ort || '', b.b_email || '',
        g.azubis.length, g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join(' / '), t.ctx.schule, t.ctx.klassen, t.termin.geplant_datum]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';') + '\n';
    });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = App.safeFilename(['Seriendruck_Betriebe', t.ctx.schule, t.termin.geplant_datum], 'csv');
    a.click();
    App.closeModal();
    App.toast(`CSV mit ${betriebe.length} Betrieben exportiert`, 'success');
  },

  // ── B2) Word-Serienbriefe aus Vorlage ──
  exportSeriendruckWord(terminId) {
    const templateB64 = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template'");
    if (!templateB64) return App.toast('Keine Word-Vorlage hinterlegt – bitte in Einstellungen hochladen', 'error');
    App.showLoading('Erstelle Word-Serienbriefe…');
    try {
      const t = this._ctxTermin(terminId);
      const { betriebe } = this._betriebeDesTermins(terminId, true);
      const binaryString = atob(templateB64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      let ok = 0;
      betriebe.forEach(g => {
        const b = g.betrieb;
        let maengelListe = '', ergebnisDetails = '';
        g.azubis.forEach(a => {
          ergebnisDetails += `${a.nachname}, ${a.vorname}: ${a.ke?.ergebnis ? (this._eLbl[a.ke.ergebnis] || a.ke.ergebnis) : 'nicht kontrolliert'}\n`;
          if (a.maengel.length) {
            maengelListe += `${a.nachname}, ${a.vorname}:\n`;
            a.maengel.forEach(m => { maengelListe += `  AJ ${m.ausbildungsjahr}, KW ${m.kalenderwoche}: ${m.maengel_codes.split(',').map(c => this._codeLabels[c] || c).join(', ')}\n`; });
          }
        });
        const wvFrist = App.query(`SELECT w.frist_datum FROM wiedervorlagen w WHERE w.schueler_id IN (${g.azubis.map(a => a.id).join(',')}) AND w.status='offen' ORDER BY w.frist_datum LIMIT 1`);
        try {
          const zip = new PizZip(bytes.buffer);
          const DocxTemplater = window.docxtemplater || window.Docxtemplater;
          const doc = new DocxTemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' } });
          doc.render({
            betrieb_name: g.name, betrieb_vorname: b.b_vorname || '', betrieb_zusatzbezeichnung: b.b_zusatz || '',
            betrieb_firma: b.b_zusatz || g.name, betrieb_ansprechpartner: b.b_ap || b.b_vorname || '',
            betrieb_strasse: b.b_strasse || '', betrieb_plz: b.b_plz || '', betrieb_ort: b.b_ort || '',
            azubi_namen: g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join('\n'), azubi_anzahl: String(g.azubis.length),
            kontrolldatum: t.ctx.datum, schule: t.ctx.schule + t.ctx.schule_ort, klassen: t.ctx.klassen, fachrichtung: t.ctx.fachrichtung,
            pruefer: t.ctx.pruefer, rp_adresse: t.ctx.rp_adresse, datum_heute: t.ctx.datum_heute,
            maengel_liste: maengelListe || '(keine Mängel)', ergebnis_details: ergebnisDetails || '(keine Ergebnisse)',
            betrieb_email: b.b_email || '', frist_datum: wvFrist.length ? formatDate(wvFrist[0].frist_datum) : '–',
          });
          const out = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          saveAs(out, App.safeFilename(['Anschreiben', g.name, t.termin.geplant_datum], 'docx'));
          ok++;
        } catch(e) { console.error('Word-Template Fehler:', e); }
      });
      App.hideLoading(); App.closeModal();
      App.toast(ok === betriebe.length ? `${ok} Word-Serienbriefe erstellt` : `${ok} von ${betriebe.length} Briefen erstellt – Vorlage/Platzhalter prüfen`, ok === betriebe.length ? 'success' : 'warning');
    } catch(e) {
      App.hideLoading(); console.error('Seriendruck Word:', e); App.toast('Fehler beim Seriendruck', 'error');
    }
  },

  // ── B3) PDF-Anschreiben (ein Brief je Betrieb, eine Datei) ──
  // nurOhneEmail: nur Betriebe ohne E-Mail-Adresse; nurKey: genau ein Betrieb
  exportSeriendruckPDF(terminId, nurOhneEmail, nurKey) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    let { betriebe } = this._betriebeDesTermins(terminId, false);
    if (nurOhneEmail) betriebe = betriebe.filter(g => !g.email);
    if (nurKey) betriebe = betriebe.filter(g => String(g.key) === String(nurKey));
    if (!betriebe.length) return App.toast('Keine passenden Betriebe', 'warning');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    betriebe.forEach((g, idx) => {
      if (idx > 0) doc.addPage();
      const b = g.betrieb;
      let y = 40;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120);
      doc.text(String(t.ctx.rp_adresse).substring(0, 90), 25, 30);
      doc.setFontSize(11); doc.setTextColor(0);
      [b.b_firma || g.name, b.b_firma && b.b_name && b.b_firma !== b.b_name ? b.b_name : '', b.b_strasse, `${b.b_plz} ${b.b_ort}`.trim()].filter(Boolean)
        .forEach(line => { doc.text(line, 25, y); y += 5; });
      doc.setFontSize(10); doc.text(`Freiburg, ${t.ctx.datum_heute}`, 140, 75);
      const { betreff, body } = App.renderVorlage('brief_betrieb', { ...t.ctx, azubi_liste: '  - ' + g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join('\n  - ') });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(betreff, 25, 90);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text(doc.splitTextToSize(body, 160), 25, 98);
      PDFExport.footer && PDFExport.footer(doc, idx + 1, betriebe.length);
    });
    doc.save(App.safeFilename(['Anschreiben_Betriebe', t.ctx.schule, t.termin.geplant_datum], 'pdf'));
    App.closeModal();
    App.toast(`PDF mit ${betriebe.length} Anschreiben erstellt`, 'success');
  },

  // ── C) E-Mail an Betrieb bei Wiedervorlage (Mängelmitteilung / Erinnerung) ──
  emailBetriebWV(wvId) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, s.betrieb_id,
      b.name as b_name, b.email as b_email, b.ansprechpartner as b_ap,
      ke.geaendert_von as ke_pruefer, kt.pruefer as kt_pruefer
      FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id
      LEFT JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE w.id=?`, [wvId])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    // Prüfer DER DURCHSICHT – nicht "irgendein aktiver Prüfer"
    const prueferName = w.ke_pruefer || (w.kt_pruefer || '').split(',')[0].trim() || KontrolleHandler?.activePruefer || App.query('SELECT name FROM pruefer WHERE aktiv=1 LIMIT 1')[0]?.name || 'Ausbildungsberater';
    const maengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [w.schueler_id]);
    const maengelText = maengel.length
      ? maengel.map(m => `  - AJ ${m.ausbildungsjahr}, KW ${m.kalenderwoche}: ${m.maengel_codes.split(',').map(c => KWNav.CODE_LABELS[c] || c).join(', ')}${m.fehltage ? ' (' + m.fehltage + ' Fehltage)' : ''}`).join('\n')
      : '  (keine offenen Mängel)';
    const heute = todayStr();
    const ueberfaellig = w.status === 'ueberfaellig' || (w.status === 'offen' && w.frist_datum && w.frist_datum < heute);
    const fristNeu = addDaysStr(14);
    const azubi = `${w.vorname} ${w.nachname}`;
    const ctx = { ...App.absenderCtx(prueferName), anrede: this._anrede(w.b_ap), azubi, maengel: maengelText,
      frist: formatDate(w.frist_datum), frist_alt: formatDate(w.frist_datum), frist_neu: formatDate(fristNeu) };
    const typ = ueberfaellig ? 'wv_erinnerung' : 'wv_mahnung';
    const { betreff, body } = App.renderVorlage(typ, ctx);
    const to = w.b_email || '';
    window._pendingEmail = { to, subject: betreff, body, wvId, fristNeu: ueberfaellig ? fristNeu : null };
    App.openModal(`✉︎ ${ueberfaellig ? 'Erinnerung' : 'Mängelmitteilung'} an Betrieb (Wiedervorlage)`, `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${to ? esc(to) : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt!</span>'}</div>
        <div><strong>Betrieb:</strong> ${esc(w.b_name || w.ausbildungsstaette)} · <strong>Azubi:</strong> ${esc(w.nachname)}, ${esc(w.vorname)}</div>
        ${ueberfaellig ? `<div style="margin-top:6px;padding:6px 10px;background:var(--clr-amber-light);border-radius:var(--radius)">Frist ${formatDate(w.frist_datum)} ist überschritten → Erinnerung mit neuer Frist:
          <input type="date" class="form-control" id="wvFristNeu" value="${fristNeu}" style="display:inline-block;width:150px;padding:2px 6px;margin-left:6px" onchange="Workflows._wvFristNeuGeaendert(this.value)"> (wird in der Wiedervorlage gespeichert)</div>` : ''}
        <div style="margin-top:4px"><strong>Betreff:</strong> <span id="wvMailBetreff">${esc(betreff)}</span></div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre id="wvMailBody" style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:220px;overflow-y:auto">${esc(body)}</pre>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px">
        <strong>Anlage:</strong> Durchsichtsbogen als PDF erzeugen und der E-Mail anhängen.
        <button class="btn btn-sm btn-secondary" style="margin-left:8px" onclick="Workflows.generateWVPDF(${wvId})">▤ PDF jetzt erstellen</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+(window._pendingEmail?.to||'')+'\\nBetreff: '+(window._pendingEmail?.subject||'')+'\\n\\n'+(window._pendingEmail?.body||''));App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        ${!to && w.betrieb_id ? `<button class="btn btn-secondary" onclick="Workflows._betriebEmailNachtragenWV(${w.betrieb_id}, ${wvId})">✎ E-Mail nachtragen</button>` : ''}
        <button class="btn btn-primary" onclick="Workflows._wvMailOeffnen()">✉︎ In Outlook öffnen</button>`);
    this._wvMailCtx = { typ, ctx, wvId };
  },
  _wvFristNeuGeaendert(datum) {
    const m = this._wvMailCtx; if (!m || !datum) return;
    m.ctx.frist_neu = formatDate(datum);
    const { betreff, body } = App.renderVorlage(m.typ, m.ctx);
    window._pendingEmail.subject = betreff; window._pendingEmail.body = body; window._pendingEmail.fristNeu = datum;
    const b = document.getElementById('wvMailBody'); if (b) b.textContent = body;
    const s = document.getElementById('wvMailBetreff'); if (s) s.textContent = betreff;
  },
  _wvMailOeffnen() {
    const p = window._pendingEmail || {};
    if (!p.to) return App.toast('Keine E-Mail-Adresse – bitte nachtragen oder Text kopieren', 'warning');
    if (p.fristNeu && p.wvId) {
      App.run("UPDATE wiedervorlagen SET frist_datum=?, status='offen', geaendert_am=datetime('now','localtime') WHERE id=?", [p.fristNeu, p.wvId]);
      App.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)", [p.wvId, 'Erinnerung versendet, neue Frist ' + formatDate(p.fristNeu), KontrolleHandler?.activePruefer || '']);
    }
    this.openMailto(p.to, p.subject, p.body);
    App.closeModal();
    if (p.fristNeu) { App.toast('Neue Frist gespeichert', 'success'); try { Views.wiedervorlagen(); } catch(e) {} }
  },
  _betriebEmailNachtragenWV(betriebId, wvId) {
    const adr = prompt('E-Mail-Adresse des Betriebs (wird in den Stammdaten gespeichert):');
    if (!adr) return;
    App.run('UPDATE betriebe SET email=? WHERE id=?', [adr.trim(), betriebId]);
    this.emailBetriebWV(wvId);
  },
  generateWVPDF(wvId) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [wvId])[0];
    if (!w) return;
    const ke = App.query('SELECT ke.*, kt.id as tid FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? ORDER BY kt.geplant_datum DESC LIMIT 1', [w.schueler_id])[0];
    if (ke) PDFExport.generateSingle(ke.tid, w.schueler_id);
    else App.toast('Kein Kontrollergebnis für PDF gefunden', 'warning');
  },

  // ── D) Nachhol-Aufforderung an Betriebe (am Kontrolltag abwesende Azubis) ──
  emailNachholung(terminId, schuelerIds, frist) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const ids = new Set(schuelerIds || []);
    const { betriebe } = this._betriebeDesTermins(terminId, false);
    const betroffen = betriebe.map(g => ({ ...g, azubis: g.azubis.filter(a => ids.has(a.id)) })).filter(g => g.azubis.length);
    if (!betroffen.length) return App.toast('Keine abwesenden Azubis', 'info');
    const fristTxt = formatDate(frist || addDaysStr(21));
    this._individualData = null;
    let listHtml = '';
    betroffen.forEach((g, idx) => {
      listHtml += `<div style="padding:8px 10px;margin-bottom:6px;background:${g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div><strong>${esc(g.name)}</strong> · ${g.azubis.map(a => esc(a.nachname + ', ' + a.vorname)).join(' / ')}<div style="font-size:11px">${g.email ? '✉︎ ' + esc(g.email) : '<span style="color:var(--clr-red)">Keine E-Mail – Brief drucken</span>'}</div></div>
        ${g.email ? `<button class="btn btn-sm" style="background:var(--clr-forest);color:var(--clr-white);border:none;font-size:11px" onclick="Workflows._nachholungMail(${idx})">✉︎ Senden</button>` : `<button class="btn btn-sm btn-secondary" style="font-size:11px" onclick="Workflows.exportSeriendruckPDF(${terminId}, false, '${esc(String(g.key))}')">▤ Brief</button>`}
      </div>`;
    });
    this._nachholung = { t, betroffen, fristTxt };
    App.openModal(`Nachhol-Aufforderung – ${betroffen.length} Betrieb(e)`, `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Abwesende Azubis vom ${t.ctx.datum}: Betriebe werden gebeten, das Berichtsheft bis <strong>${esc(fristTxt)}</strong> vorzulegen (Vorlage „Nachhol-Aufforderung").</div>
      ${listHtml}`, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>`);
  },
  _nachholungMail(idx) {
    const n = this._nachholung; if (!n) return;
    const g = n.betroffen[idx];
    const ctx = { ...n.t.ctx, anrede: this._anrede(g.ap), azubi_block: this._azubiBlock(g.azubis, false),
      azubi_namen: g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / '), frist: n.fristTxt };
    const { betreff, body } = App.renderVorlage('nachholung', ctx);
    this.openMailto(g.email, betreff, body);
  },

  // ── E) Übergabeschreiben an ein fremdes Amt ──
  emailAmtUebergabe(terminId, amt) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const liste = t.schuelerList.filter(s => s.zustaendiges_amt === amt);
    if (!liste.length) return App.toast('Keine Azubis dieses Amts im Termin', 'warning');
    const to = (App.aemterEmails()[amt] || '').trim();
    const ctx = { ...t.ctx, amt, amt_name: App.AEMTER[amt] || amt, anzahl: String(liste.length),
      azubi_liste: '  - ' + liste.map(s => `${s.nachname}, ${s.vorname}`).join('\n  - '),
      anlagen: `Durchsichtsbögen (${liste.length}), Übergabeliste (Excel)` };
    const { betreff, body } = App.renderVorlage('amt_uebergabe', ctx);
    window._pendingEmail = { to, subject: betreff, body };
    App.openModal(`✉︎ Übergabeschreiben an ${esc(App.amtLabel(amt))}`, `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${to ? esc(to) : '<span style="color:var(--clr-red)">Keine E-Mail für dieses Amt hinterlegt</span>'}
          ${!to ? `<input class="form-control" id="mAmtEmail" placeholder="E-Mail des zuständigen Beraters" style="display:inline-block;width:280px;padding:3px 6px;margin-left:6px"> <span style="font-size:11px;color:var(--clr-text-light)">(wird für dieses Amt gespeichert)</span>` : ''}
        </div>
        <div><strong>Betreff:</strong> ${esc(betreff)}</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:260px;overflow-y:auto">${esc(body)}</pre>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px">
        <strong>Anlagen erzeugen:</strong>
        <button class="btn btn-sm btn-secondary" style="margin-left:6px" onclick="PlanungHandler.exportAmtPDF(${terminId},'${esc(amt)}')">▤ Bögen (PDF)</button>
        <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.exportAmtExcel(${terminId},'${esc(amt)}')">Liste (Excel)</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+(window._pendingEmail.to||'')+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        <button class="btn btn-primary" onclick="Workflows._amtMailOeffnen('${esc(amt)}')">✉︎ In Outlook öffnen</button>`);
  },
  _amtMailOeffnen(amt) {
    let to = window._pendingEmail.to;
    const inp = document.getElementById('mAmtEmail');
    if (!to && inp && inp.value.trim()) {
      to = inp.value.trim();
      const map = App.aemterEmails(); map[amt] = to;
      App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('aemter_email',?)", [JSON.stringify(map)]);
    }
    if (!to) return App.toast('Bitte E-Mail-Adresse eingeben oder Text kopieren', 'warning');
    this.openMailto(to, window._pendingEmail.subject, window._pendingEmail.body);
    App.closeModal();
  },

  // ── Helper: mailto öffnen – ohne stilles Abschneiden ──
  // Lange Texte (Windows-mailto-Grenze ~2000 Zeichen): Text in die
  // Zwischenablage, Mail nur mit Betreff öffnen, deutlicher Hinweis.
  openMailto(to, subject, body, cc, bcc) {
    const params = [];
    if (cc) params.push('cc=' + encodeURIComponent(cc));
    if (bcc) params.push('bcc=' + encodeURIComponent(bcc));
    const base = `mailto:${to || ''}?subject=${encodeURIComponent(subject || '')}`;
    const full = base + '&body=' + encodeURIComponent(body || '') + (params.length ? '&' + params.join('&') : '');
    let url = full, hinweis = '';
    if (full.length > 1900) {
      url = base + (params.length ? '&' + params.join('&') : '');
      try { navigator.clipboard.writeText(body || ''); } catch(e) {}
      hinweis = 'Der Text ist zu lang für den E-Mail-Link – er wurde in die Zwischenablage kopiert: bitte in der geöffneten E-Mail mit Strg+V einfügen.';
      if (url.length > 1900 && bcc) {
        url = base;
        try { navigator.clipboard.writeText(`BCC: ${bcc}\n\n${body || ''}`); } catch(e) {}
        hinweis = 'Empfängerliste und Text wurden in die Zwischenablage kopiert (zu lang für den Link) – bitte in der E-Mail einfügen.';
      }
    }
    const w = window.open(url, '_self');
    if (hinweis) App.toast(hinweis, 'warning');
    if (!w) {
      navigator.clipboard.writeText(`An: ${to}${cc ? '\nCC: ' + cc : ''}${bcc ? '\nBCC: ' + bcc : ''}\nBetreff: ${subject}\n\n${body}`).then(() => {
        App.toast('E-Mail konnte nicht geöffnet werden – Text in Zwischenablage kopiert', 'warning');
      }).catch(() => App.toast('E-Mail-Client konnte nicht geöffnet werden. Bitte manuell senden.', 'error'));
    }
  }
};
