const Workflows = {
  // ── A) E-Mail an Schule (Termineinladung) ──
  emailSchule(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    if (termin.typ === 'einsendung') return App.toast('Einsendungen haben keine zugeordnete Schule – E-Mail nicht möglich', 'warning');
    const klassen = App.getTerminKlassen(terminId);
    if (!klassen.length) return App.toast('Keine Klassen zugeordnet', 'error');
    const schule = App.query('SELECT * FROM berufsschulen WHERE id=?', [klassen[0].berufsschule_id])[0] || {};
    const schuelerList = App.getTerminSchueler(terminId);
    const count = schuelerList.length;
    const rpAdresse = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_persoenlich'") || 'Regierungspräsidium Freiburg, Abt. 3 / Ref. 31';
    const prueferList = (termin.pruefer || '').split(',').map(s => s.trim()).filter(Boolean);
    const pruefer = prueferList.join(', ') || 'Ausbildungsberater';
    const isDone = termin.status === 'durchgefuehrt';

    const emails = [schule.email].filter(Boolean);
    const to = emails.join(',') || '';
    const cc = (schule.email_cc || '').trim();
    const datum = formatDate(termin.geplant_datum);
    const wochentag = new Date(termin.geplant_datum).toLocaleDateString('de-DE', { weekday: 'long' });
    const anzPruefer = Math.max(prueferList.length, 1);
    const dauer = Math.ceil(count * 10 / 60 / anzPruefer);

    // Group by Fachrichtung + AJ (school perspective)
    const frAjGroups = {};
    klassen.forEach(k => {
      const aj = App.getAJFromJahrgang(k.jahrgang_id, termin.geplant_datum);
      const fr = k.fachrichtung || 'Gartenbau';
      const key = `${fr}|${aj}`;
      if (!frAjGroups[key]) frAjGroups[key] = { fr, aj, jgBez: '', count: 0 };
      const jg = App.query('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [k.jahrgang_id])[0];
      frAjGroups[key].jgBez = jg?.bezeichnung || '';
    });
    // Count students per FR+AJ group (use klasse_id to match)
    schuelerList.forEach(s => {
      const sKlasse = klassen.find(k => k.id === s.klasse_id);
      if (sKlasse) {
        const aj = App.getAJFromJahrgang(sKlasse.jahrgang_id, termin.geplant_datum);
        const fr = sKlasse.fachrichtung || 'Gartenbau';
        const key = `${fr}|${aj}`;
        if (frAjGroups[key]) frAjGroups[key].count++;
      }
    });

    const frAjList = Object.values(frAjGroups).sort((a,b) => a.fr.localeCompare(b.fr) || a.aj - b.aj);
    const frAjStr = frAjList.map(g => `${g.fr} ${g.aj}. AJ (${g.jgBez})`).join(', ');
    const frAjDetail = frAjList.map(g => `  - ${g.fr} ${g.aj}. AJ (Abschluss ${g.jgBez})${g.count ? ': ' + g.count + ' Auszubildende' : ''}`).join('\n');

    let subject, body;

    if (!isDone) {
      // ── TERMINANFRAGE (vor der Kontrolle) ──
      subject = `Terminanfrage Berichtsheftkontrolle – ${frAjStr} – ${schule.name || '?'} – ${datum}`;
      body = `Sehr geehrte Damen und Herren,

im Rahmen der Überwachung der Berufsausbildung im Gartenbau möchte das Regierungspräsidium Freiburg die Berichtsheftführung der Auszubildenden kontrollieren.

Wir würden gerne am ${wochentag}, den ${datum}, an der ${schule.name || '?'}${schule.ort ? ' in ' + schule.ort : ''} die Berichtsheftkontrolle durchführen.

Betroffene Fachrichtungen und Ausbildungsjahre:
${frAjDetail}

Anzahl Auszubildende gesamt: ${count}
Voraussichtliche Dauer: ca. ${dauer} Stunde${dauer > 1 ? 'n' : ''}${anzPruefer > 1 ? ` (${count} Berichtshefte × ca. 10 Min., ${anzPruefer} Prüfer parallel)` : ` (ca. 10 Min. pro Berichtsheft)`}
Prüfer: ${pruefer}

Könnten Sie uns bitte mitteilen, ob dieser Termin für Sie möglich ist? Wir benötigen ${anzPruefer > 1 ? `einen Raum mit ${anzPruefer} Arbeitsplätzen für die parallele Durchsicht` : 'einen Raum, in dem wir die Berichtshefte einsehen können'}.

Die Auszubildenden werden gebeten, ihre vollständigen und unterschriebenen Berichtshefte einschließlich aller Ausbildungsnachweise am Kontrolltag bereitzuhalten. Die Berichtshefte sollen geordnet nach Kalenderwochen vorliegen.

Falls der vorgeschlagene Termin nicht möglich ist, schlagen Sie uns bitte Alternativtermine in der gleichen oder folgenden Woche vor.

Vielen Dank für Ihre Unterstützung.

Mit freundlichen Grüßen
${pruefer}
${rpAdresse}`;
    } else {
      // ── ERGEBNIS-MITTEILUNG (nach der Kontrolle) ──
      const results = {};
      schuelerList.forEach(s => {
        const ke = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
        const e = ke?.ergebnis || 'nicht kontrolliert';
        if (!results[e]) results[e] = [];
        results[e].push(`${s.nachname}, ${s.vorname}`);
      });
      const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bei nächster Durchsicht',sachberichte_wetter_email:'Sachberichte/Wetter per E-Mail nachreichen',berichte_bis_termin_email:'Berichte per E-Mail nachreichen',persoenliche_vorlage_rp:'Persönliche Vorlage im RP',post_an_rp:'Vorlage per Post im RP'};
      let ergebnisText = '';
      Object.entries(results).forEach(([e, names]) => {
        ergebnisText += `\n${eLbl[e] || e} (${names.length}):\n  - ${names.join('\n  - ')}\n`;
      });

      subject = `Ergebnisse Berichtsheftkontrolle – ${frAjStr} – ${schule.name || '?'} – ${datum}`;
      body = `Sehr geehrte Damen und Herren,

am ${datum} wurde an der ${schule.name || '?'}${schule.ort ? ' in ' + schule.ort : ''} die Berichtsheftkontrolle durchgeführt.

Kontrollierte Fachrichtungen/Ausbildungsjahre:
${frAjDetail}

Ergebnisse (${count} Auszubildende):
${ergebnisText}
Bei Auszubildenden mit Beanstandungen wurden die Ausbildungsbetriebe gesondert angeschrieben.

Vielen Dank für die Bereitstellung der Räumlichkeiten und die gute Zusammenarbeit.

Mit freundlichen Grüßen
${pruefer}
${rpAdresse}`;
    }

    const emailType = isDone ? 'Ergebnis-Mitteilung' : 'Terminanfrage';

    // Store email data for modal buttons (avoids inline escaping issues)
    window._pendingEmail = { to, subject, body, cc };

    if (!to) {
      App.openModal(`✉︎ ${emailType} an Schule`, `
        <div style="padding:8px 12px;background:var(--clr-amber-light);border-radius:var(--radius);margin-bottom:12px;font-size:13px">
          ⚠︎ Keine E-Mail-Adresse für "${schule.name || '?'}" hinterlegt. Bitte unter Stammdaten → Berufsschulen ergänzen.
        </div>
        <div class="form-group"><label>E-Mail-Adresse(n)</label><input class="form-control" id="mSchEmail2" placeholder="email@schule.de"></div>
        <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;max-height:200px;overflow-y:auto"><pre style="white-space:pre-wrap;font-family:inherit">${esc(body)}</pre></div>
      `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
          <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+document.getElementById('mSchEmail2').value+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
          <button class="btn btn-primary" onclick="Workflows.openMailto(document.getElementById('mSchEmail2').value, window._pendingEmail.subject, window._pendingEmail.body);App.closeModal()">✉︎ E-Mail öffnen</button>`);
      return;
    }

    // Show preview + open
    App.openModal(`✉︎ ${emailType} an ${schule.name || 'Schule'}`, `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${esc(to)}</div>
        ${cc ? `<div><strong>CC:</strong> ${esc(cc)}</div>` : ''}
        <div><strong>Betreff:</strong> ${esc(subject)}</div>
        <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">${isDone ? 'Ergebnis-Mitteilung nach Kontrolle' : 'Terminanfrage – bitte Datum bestätigen lassen'}</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:300px;overflow-y:auto">${esc(body)}</pre>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+window._pendingEmail.to+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        <button class="btn btn-primary" onclick="Workflows.openMailto(window._pendingEmail.to, window._pendingEmail.subject, window._pendingEmail.body, window._pendingEmail.cc);App.closeModal()">✉︎ In Outlook öffnen</button>`);
  },

  // ── B) Seriendruck: Betriebe anschreiben (4 Wochen vor Termin) ──
  seriendruckBetriebe(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const schule_ort = klassen.length ? klassen[0].schule_ort : '';
    const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');

    // Get students with Betrieb data from ALL classes
    const schueler = App.getTerminSchueler(terminId).map(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      return {...s, b_name: b?.name||'', b_firma: b?.firma||'', b_ap: b?.ansprechpartner||'',
        b_strasse: b?.strasse||'', b_plz: b?.plz||'', b_ort: b?.ort||'', b_email: b?.email||'', b_tel: b?.telefon||''};
    });

    // Group by Betrieb
    const grouped = {};
    schueler.forEach(s => {
      const key = s.betrieb_id || s.ausbildungsstaette || '?';
      if (!grouped[key]) grouped[key] = { betrieb: s, azubis: [] };
      grouped[key].azubis.push(s);
    });
    const betriebList = Object.values(grouped);

    App.openModal('▤ Betriebe anschreiben – Seriendruck', `
      <p style="font-size:13px;margin-bottom:12px">
        <strong>${betriebList.length} Betriebe</strong> mit insgesamt ${schueler.length} Azubis für den Termin am <strong>${formatDate(termin.geplant_datum)}</strong>
        an der ${esc(schule)}, Klasse(n) ${esc(klassenStr)}.
      </p>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">
        <table class="data-table"><thead><tr><th>Betrieb</th><th>Ort</th><th>E-Mail</th><th>Azubis</th></tr></thead><tbody>
          ${betriebList.map(g => `<tr>
            <td><strong>${esc(g.betrieb.b_name || g.betrieb.ausbildungsstaette)}</strong></td>
            <td>${esc(g.betrieb.b_ort || '')}</td>
            <td>${esc(g.betrieb.b_email || '–')}</td>
            <td>${g.azubis.map(a => esc(a.nachname)).join(', ')}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
      <p style="font-size:12px;color:var(--clr-text-light)">Wählen Sie das gewünschte Export-Format:</p>
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>' +
        '<button class="btn btn-success" onclick="Workflows.emailBetriebIndividuell(' + terminId + ')" title="Individuelle E-Mails an jeden Betrieb mit Azubi-Details">✉︎ Individuelle E-Mails</button>' +
        '<button class="btn btn-secondary" onclick="Workflows.emailBetriebeBCC(' + terminId + ')" title="E-Mail mit allen Betrieben im BCC">✉︎ BCC</button>' +
        '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckCSV(' + terminId + ')">CSV</button>' +
        (App.scalar("SELECT wert FROM einstellungen WHERE schluessel=\'word_template\'") ? '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckWord(' + terminId + ')">✎ Word</button>' : '') +
        '<button class="btn btn-primary" onclick="Workflows.exportSeriendruckPDF(' + terminId + ')">▤ PDF</button>');
  },

  // ── BCC Serien-E-Mail an alle Betriebe ──
  emailBetriebeBCC(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return;
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');

    // Collect unique Betrieb emails
    const schueler = App.getTerminSchueler(terminId);
    const emailSet = new Set();
    const noEmail = [];
    schueler.forEach(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      if (b?.email) emailSet.add(b.email);
      else noEmail.push(s.nachname + ', ' + s.vorname);
    });
    const emails = [...emailSet];

    // RP sender info
    const rpName = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_name'") || 'Regierungspräsidium Freiburg';
    const rpEmail = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_email'") || '';
    const pruefer = termin.pruefer || '';

    const datum = formatDate(termin.geplant_datum);
    const subject = `Berichtsheftdurchsicht ${klassenStr} am ${datum} – ${schule}`;
    const body = `Sehr geehrte Ausbilderinnen und Ausbilder,

im Rahmen der Berufsausbildung zum/zur ${frStr || 'Gärtner/in'} findet am ${datum} an der ${schule} eine Durchsicht der Berichtshefte (Ausbildungsnachweise) statt.

Bitte stellen Sie sicher, dass Ihr Auszubildender/Ihre Auszubildende das Berichtsheft vollständig und ordnungsgemäß geführt zur Durchsicht mitbringt.

Folgende Unterlagen werden geprüft:
- Individueller Ausbildungsplan (ausgefüllt und unterschrieben)
- Sachberichte / Wochenberichte (lückenlos geführt)
- Bescheinigungen über überbetriebliche Ausbildung
- Unterschriften des Ausbilders/der Ausbilderin

Bei Rückfragen stehe ich Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
${pruefer}
${rpName}
Abt. 3 – Landwirtschaft, Ländlicher Raum, Veterinär- und Lebensmittelwesen`;

    if (noEmail.length) {
      App.toast(`${noEmail.length} Betriebe ohne E-Mail: ${noEmail.slice(0,3).join(', ')}${noEmail.length>3?'…':''}`, 'warning');
    }

    App.closeModal();

    // Show confirmation with editable text
    App.openModal(`✉︎ Serien-E-Mail an ${emails.length} Betriebe (BCC)`, `
      <div style="margin-bottom:8px;font-size:12px">
        <strong>${emails.length}</strong> Betriebe mit E-Mail${noEmail.length ? ` · <span style="color:var(--clr-red)">${noEmail.length} ohne E-Mail</span>` : ''}
      </div>
      <div style="max-height:80px;overflow-y:auto;margin-bottom:8px;font-size:11px;padding:6px;background:var(--clr-warm);border-radius:var(--radius)">
        ${emails.map(e => `<span style="display:inline-block;padding:1px 6px;margin:1px;background:white;border-radius:4px">${esc(e)}</span>`).join('')}
      </div>
      <div class="form-group"><label>Betreff</label><input class="form-control" id="bccSubject" value="${esc(subject)}"></div>
      <div class="form-group"><label>Text (kann vor dem Senden im E-Mail-Programm bearbeitet werden)</label>
        <textarea class="form-control" id="bccBody" rows="10" style="font-size:12px;font-family:monospace">${esc(body)}</textarea>
      </div>
      <div style="font-size:11px;color:var(--clr-text-light);margin-top:8px">
        Alle Empfänger stehen im <strong>BCC</strong> – die Betriebe sehen sich gegenseitig nicht.<br>
        Bei >50 Empfängern ggf. in 2 Chargen versenden (Outlook: max 500, Gmail: max 500/Tag).
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('bccBody').value);App.toast('Text kopiert','success')">▤ Text kopieren</button>
        <button class="btn btn-sm btn-secondary" onclick="Workflows._kopiereBccAdressen()">▤ Adressen kopieren</button>
        <button class="btn btn-primary" onclick="Workflows._openBCCMail()">✉︎ E-Mail öffnen</button>`);
    
    // Store for the mail opener
    this._bccEmails = emails;
  },

  _openBCCMail() {
    const subject = encodeURIComponent(document.getElementById('bccSubject').value);
    const body = encodeURIComponent(document.getElementById('bccBody').value);
    const bcc = this._bccEmails.join(',');
    
    // mailto: with BCC (works in Outlook, Thunderbird, Apple Mail)
    const rpEmail = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_email'") || '';
    const mailto = `mailto:${rpEmail}?bcc=${encodeURIComponent(bcc)}&subject=${subject}&body=${body}`;
    
    // Check URL length – if too long, open without body
    if (mailto.length > 2000) {
      // Copy body to clipboard and open shorter mailto
      navigator.clipboard.writeText(document.getElementById('bccBody').value);
      const shortMailto = `mailto:${rpEmail}?bcc=${encodeURIComponent(bcc)}&subject=${subject}`;
      if (shortMailto.length > 2000) {
        // Even BCC list too long → copy everything
        navigator.clipboard.writeText(this._bccEmails.join('; '));
        App.toast('E-Mail-Adressen in Zwischenablage kopiert – bitte manuell ins BCC-Feld einfügen', 'warning');
        window.open(`mailto:${rpEmail}?subject=${subject}`, '_blank');
      } else {
        App.toast('E-Mail-Text in Zwischenablage kopiert (zu lang für mailto:) – bitte einfügen', 'info');
        window.open(shortMailto, '_blank');
      }
    } else {
      window.open(mailto, '_blank');
    }
    App.closeModal();
  },

  // ── Individuelle E-Mails pro Betrieb (mit Azubi-Details & Mängeln) ──
  emailBetriebIndividuell(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return;
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const schule_ort = klassen.length ? klassen[0].schule_ort : '';
    const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');
    const isDone = termin.status === 'durchgefuehrt';
    const rpAdresse = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_persoenlich'") || 'Regierungspräsidium Freiburg';
    const pruefer = termin.pruefer || 'Ausbildungsberater';
    const datum = formatDate(termin.geplant_datum);
    const codeLabels = {A:'Unterschrift Azubi fehlt',B:'Unterschrift Ausbilder fehlt',C:'Berufsschulthemen fehlen',D:'Wetteraufzeichnungen fehlen',E:'Inhaltlich lückenhaft',F:'Berichte fehlen komplett',G:'Datum/KW falsch',H:'Fehltage nicht eingetragen',I:'Sonstiges'};

    // Group students by betrieb
    const schueler = App.getTerminSchueler(terminId).map(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
      const maengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [s.id]);
      return {...s, b, ke, maengel};
    });
    const grouped = {};
    schueler.forEach(s => {
      const key = s.betrieb_id || s.ausbildungsstaette || '?';
      if (!grouped[key]) grouped[key] = { b: s.b, name: s.b?.name || s.ausbildungsstaette, email: s.b?.email || '', ap: s.b?.ansprechpartner || '', azubis: [] };
      grouped[key].azubis.push(s);
    });
    const betriebe = Object.values(grouped);
    const withEmail = betriebe.filter(g => g.email);
    const noEmail = betriebe.filter(g => !g.email);

    App.closeModal();

    // Generate email list with preview
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bei nächster Durchsicht',sachberichte_wetter_email:'Sachberichte/Wetter nachreichen',berichte_bis_termin_email:'Berichte nachreichen',persoenliche_vorlage_rp:'Vorlage im RP',post_an_rp:'Post ans RP'};
    let listHtml = '';
    betriebe.forEach((g, idx) => {
      const azubiDetails = g.azubis.map(a => {
        let detail = '<strong>' + esc(a.nachname) + ', ' + esc(a.vorname) + '</strong>';
        if (a.ke?.ergebnis) detail += ' → ' + (eLbl[a.ke.ergebnis] || a.ke.ergebnis);
        if (a.maengel.length) {
          detail += '<br><span style="color:var(--clr-red);font-size:10px">';
          detail += a.maengel.map(m => 'AJ' + m.ausbildungsjahr + '/KW' + m.kalenderwoche + ': ' + m.maengel_codes).join(', ');
          detail += '</span>';
        }
        return detail;
      }).join('<br>');

      listHtml += '<div style="padding:8px 10px;margin-bottom:6px;background:' + (g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)') + ';border-radius:var(--radius);font-size:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">' +
          '<strong>' + esc(g.name) + '</strong>' +
          (g.email ? '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:var(--clr-forest);color:white;border:none" ' +
            'onclick="Workflows._openIndividualEmail(' + terminId + ',' + idx + ')">✉︎ Senden</button>' :
            '<span style="color:var(--clr-red);font-size:10px">Keine E-Mail</span>') +
        '</div>' +
        '<div style="font-size:11px">' + (g.email ? '✉︎ ' + esc(g.email) : '') + (g.ap ? ' · ' + esc(g.ap) : '') + '</div>' +
        '<div style="margin-top:4px">' + azubiDetails + '</div>' +
      '</div>';
    });

    // Store data for email opening
    this._individualData = { terminId, betriebe, termin, schule, schule_ort, klassenStr, frStr, pruefer, rpAdresse, datum, isDone, codeLabels, eLbl };

    App.openModal('✉︎ Individuelle E-Mails an ' + betriebe.length + ' Betriebe', '<div style="margin-bottom:8px;font-size:13px">' +
      '<strong>' + withEmail.length + '</strong> Betriebe mit E-Mail' +
      (noEmail.length ? ' · <span style="color:var(--clr-red)">' + noEmail.length + ' ohne E-Mail</span>' : '') +
      '</div>' +
      '<div style="max-height:400px;overflow-y:auto">' + listHtml + '</div>' +
      '<div style="margin-top:8px;font-size:11px;color:var(--clr-text-light)">Klicken Sie bei jedem Betrieb auf "✉︎ Senden" um die E-Mail mit individuellen Azubi-Details zu öffnen.</div>',
      '<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>' +
      (withEmail.length > 1 ? '<button class="btn btn-success" onclick="Workflows._openAllIndividualEmails()">✉︎ Alle ' + withEmail.length + ' nacheinander öffnen</button>' : ''));
  },

  _openIndividualEmail(terminId, betriebIdx) {
    const d = this._individualData;
    if (!d) return;
    const g = d.betriebe[betriebIdx];
    if (!g || !g.email) return App.toast('Keine E-Mail-Adresse', 'warning');

    const azubiBlock = g.azubis.map(a => {
      let line = '  - ' + a.nachname + ', ' + a.vorname;
      if (a.ke?.ergebnis) line += ': ' + (d.eLbl[a.ke.ergebnis] || a.ke.ergebnis);
      if (a.maengel.length) {
        a.maengel.forEach(m => {
          line += '\n    → AJ ' + m.ausbildungsjahr + ', KW ' + m.kalenderwoche + ': ' + 
            m.maengel_codes.split(',').map(c => d.codeLabels[c.trim()] || c).join(', ');
        });
      }
      return line;
    }).join('\n');

    const hasMaengel = g.azubis.some(a => a.ke?.ergebnis && a.ke.ergebnis !== 'in_ordnung');
    let subject, body;

    if (d.isDone && hasMaengel) {
      // Nach Kontrolle: Mängelmitteilung
      subject = 'Berichtsheftkontrolle – Ergebnis für ' + g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / ');
      body = 'Sehr geehrte Damen und Herren,' +
        (g.ap ? '\nsehr geehrte/r ' + g.ap + ',' : '') +
        '\n\nam ' + d.datum + ' wurde an der ' + d.schule + (d.schule_ort ? ' in ' + d.schule_ort : '') + ' die Berichtsheftkontrolle durchgeführt.' +
        '\n\nFür folgende Ihrer Auszubildenden ergab sich Handlungsbedarf:' +
        '\n\n' + azubiBlock +
        '\n\nWir bitten Sie, dafür Sorge zu tragen, dass die genannten Mängel zeitnah behoben werden.' +
        '\n\nBitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).' +
        '\n\nMit freundlichen Grüßen' +
        '\n' + d.pruefer + '\n' + d.rpAdresse;
    } else {
      // Vor Kontrolle: Terminankündigung
      subject = 'Berichtsheftkontrolle am ' + d.datum + ' – ' + g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / ');
      body = 'Sehr geehrte Damen und Herren,' +
        (g.ap ? '\nsehr geehrte/r ' + g.ap + ',' : '') +
        '\n\nam ' + d.datum + ' findet an der ' + d.schule + (d.schule_ort ? ' in ' + d.schule_ort : '') + ' die Berichtsheftkontrolle für ' + d.frStr + ' (' + d.klassenStr + ') statt.' +
        '\n\nFolgende Ihrer Auszubildenden sind betroffen:' +
        '\n' + azubiBlock +
        '\n\nBitte stellen Sie sicher, dass die Berichtshefte vollständig geführt, mit allen erforderlichen Unterschriften versehen und am Kontrolltag in der Berufsschule vorliegen.' +
        '\n\nGeprüft werden: Individueller Ausbildungsplan, Sachberichte/Wochenberichte (lückenlos), ÜBA-Bescheinigungen, Unterschriften.' +
        '\n\nMit freundlichen Grüßen' +
        '\n' + d.pruefer + '\n' + d.rpAdresse;
    }

    this.openMailto(g.email, subject, body);
    App.toast('E-Mail an ' + g.name + ' geöffnet', 'success');
  },

  _openAllIndividualEmails() {
    const d = this._individualData;
    if (!d) return;
    let opened = 0;
    d.betriebe.forEach((g, idx) => {
      if (g.email) {
        setTimeout(() => this._openIndividualEmail(d.terminId, idx), opened * 800);
        opened++;
      }
    });
    App.toast(opened + ' E-Mails werden geöffnet…', 'info');
  },

  exportSeriendruckCSV(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const schueler = App.getTerminSchueler(terminId).map(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      return {...s, b_name: b?.name||'', b_firma: b?.firma||'', b_ap: b?.ansprechpartner||'',
        b_strasse: b?.strasse||'', b_plz: b?.plz||'', b_ort: b?.ort||'', b_email: b?.email||''};
    });

    // Group by Betrieb
    const grouped = {};
    schueler.forEach(s => {
      const key = s.betrieb_id || s.ausbildungsstaette;
      if (!grouped[key]) grouped[key] = { betrieb: s, azubis: [] };
      grouped[key].azubis.push(`${s.nachname}, ${s.vorname}`);
    });

    // CSV header
    let csv = 'Betriebsname;Firma;Ansprechpartner;Straße;PLZ;Ort;E-Mail;Anzahl_Azubis;Azubi_Namen;Schule;Klasse;Kontrolldatum\n';
    Object.values(grouped).forEach(g => {
      const b = g.betrieb;
      csv += [b.b_name||b.ausbildungsstaette, b.b_firma||'', b.b_ap||'', b.b_strasse||'', b.b_plz||'', b.b_ort||'', b.b_email||'',
        g.azubis.length, g.azubis.join(' / '), schule, klassenStr, termin.geplant_datum].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';') + '\n';
    });

    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Seriendruck_Betriebe_${schule}_${klassenStr}_${termin.geplant_datum}.csv`.replace(/[\/ :,;]/g,'_');
    a.click();
    App.closeModal();
    App.toast(`CSV mit ${Object.keys(grouped).length} Betrieben exportiert`, 'success');
  },

  // ── B2) Word-Serienbriefe aus Vorlage ──
  exportSeriendruckWord(terminId) {
    const templateB64 = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template'");
    if (!templateB64) return App.toast('Keine Word-Vorlage hinterlegt – bitte in Einstellungen hochladen', 'error');

    App.showLoading('Erstelle Word-Serienbriefe…');
    try {
      const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
      const klassen = App.getTerminKlassen(terminId);
      const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
      const schule = klassen.length ? klassen[0].schule : '?';
      const schule_ort = klassen.length ? klassen[0].schule_ort : '';
      const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');
      const rpAdresse = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_post'") || '';
      const pruefer = termin.pruefer || 'Ausbildungsberater';

      // Get students grouped by Betrieb
      const schueler = App.getTerminSchueler(terminId).map(s => {
        const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
        return {...s, b_name: b?.name||s.ausbildungsstaette||'', b_vorname: b?.vorname||'', b_zusatz: b?.zusatzbezeichnung||'',
          b_firma: b?.zusatzbezeichnung||b?.firma||'', b_ap: b?.ansprechpartner||b?.vorname||'',
          b_strasse: b?.strasse||'', b_plz: b?.plz||'', b_ort: b?.ort||'', b_email: b?.email||''};
      });
      const grouped = {};
      schueler.forEach(s => {
        const key = s.betrieb_id || s.ausbildungsstaette || '?';
        if (!grouped[key]) grouped[key] = { betrieb: s, azubis: [] };
        grouped[key].azubis.push(s);
      });
      const betriebList = Object.values(grouped);

      // Decode template
      const binaryString = atob(templateB64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

      // Gather WV / Mängel info for each betrieb
      const datum4w = formatDate(termin.geplant_datum);

      // Generate one document per Betrieb
      betriebList.forEach((g, idx) => {
        const b = g.betrieb;
        const azubiNames = g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join('\n');

        // Collect mängel + ergebnisse for this betrieb's azubis
        const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bei nächster Durchsicht',sachberichte_wetter_email:'Sachberichte/Wetter per E-Mail nachreichen',berichte_bis_termin_email:'Berichte per E-Mail nachreichen',persoenliche_vorlage_rp:'Persönliche Vorlage im RP',post_an_rp:'Vorlage per Post im RP'};
        let maengelListe = '';
        let ergebnisDetails = '';
        g.azubis.forEach(a => {
          const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, a.id])[0];
          const ergebnis = ke?.ergebnis ? (eLbl[ke.ergebnis] || ke.ergebnis) : 'nicht kontrolliert';
          ergebnisDetails += `${a.nachname}, ${a.vorname}: ${ergebnis}\n`;
          const maengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [a.id]);
          if (maengel.length) {
            maengelListe += `${a.nachname}, ${a.vorname}:\n`;
            maengel.forEach(m => {
              const codeLabels = {A:'Unterschrift Azubi',B:'Unterschrift Ausbilder',C:'Berufsschulthemen',D:'Wetter',E:'Inhaltlich lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'};
              maengelListe += `  AJ ${m.ausbildungsjahr}, KW ${m.kalenderwoche}: ${m.maengel_codes.split(',').map(c => codeLabels[c]||c).join(', ')}\n`;
            });
          }
        });

        // Get WV frist
        const wvFrist = App.query(`SELECT w.frist_datum FROM wiedervorlagen w WHERE w.schueler_id IN (${g.azubis.map(a=>a.id).join(',')}) AND w.status='offen' ORDER BY w.frist_datum LIMIT 1`);
        const fristDatum = wvFrist.length ? formatDate(wvFrist[0].frist_datum) : '';

        try {
          const zip = new PizZip(bytes.buffer);
          const DocxTemplater = window.docxtemplater || window.Docxtemplater;
          const doc = new DocxTemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            delimiters: { start: '{', end: '}' }
          });
          doc.render({
            betrieb_name: b.b_name || b.ausbildungsstaette || '',
            betrieb_vorname: b.b_vorname || '',
            betrieb_zusatzbezeichnung: b.b_zusatz || '',
            betrieb_firma: b.b_zusatz || b.b_name || b.ausbildungsstaette || '',
            betrieb_ansprechpartner: b.b_ap || b.b_vorname || '',
            betrieb_strasse: b.b_strasse || '',
            betrieb_plz: b.b_plz || '',
            betrieb_ort: b.b_ort || '',
            azubi_namen: azubiNames,
            azubi_anzahl: String(g.azubis.length),
            kontrolldatum: datum4w,
            schule: schule + (schule_ort ? ' in ' + schule_ort : ''),
            klassen: klassenStr,
            fachrichtung: frStr,
            pruefer: pruefer,
            rp_adresse: rpAdresse,
            datum_heute: new Date().toLocaleDateString('de-DE'),
            maengel_liste: maengelListe || '(keine Mängel)',
            ergebnis_details: ergebnisDetails || '(keine Ergebnisse)',
            betrieb_email: b.b_email || '',
            frist_datum: fristDatum || '–',
          });
          const out = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          const safeName = (b.b_name || b.ausbildungsstaette || 'Betrieb').replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '_');
          saveAs(out, `Anschreiben_${safeName}_${termin.geplant_datum}.docx`);
        } catch(e) {
          console.error('Word-Template Fehler:', e);
          App.toast('Fehler bei Dokumenterstellung. Bitte Vorlage und Platzhalter prüfen.', 'error');
        }
      });

      App.hideLoading();
      App.closeModal();
      App.toast(`${betriebList.length} Word-Serienbriefe erstellt`, 'success');
    } catch(e) {
      App.hideLoading();
      console.error('Seriendruck Word:', e);
      App.toast('Fehler beim Seriendruck', 'error');
    }
  },

  exportSeriendruckPDF(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schule = klassen.length ? klassen[0].schule : '?';
    const schule_ort = klassen.length ? klassen[0].schule_ort : '';
    const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');
    const rpAdresse = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_post'") || '';
    const pruefer = termin.pruefer || 'Ausbildungsberater';
    const schueler = App.getTerminSchueler(terminId).map(s => {
      const b = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
      return {...s, b_name: b?.name||'', b_firma: b?.firma||'', b_ap: b?.ansprechpartner||'',
        b_strasse: b?.strasse||'', b_plz: b?.plz||'', b_ort: b?.ort||''};
    });

    const grouped = {};
    schueler.forEach(s => {
      const key = s.betrieb_id || s.ausbildungsstaette;
      if (!grouped[key]) grouped[key] = { betrieb: s, azubis: [] };
      grouped[key].azubis.push(s);
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const datum4w = formatDate(termin.geplant_datum);

    Object.values(grouped).forEach((g, idx) => {
      if (idx > 0) doc.addPage();
      const b = g.betrieb;
      let y = 40;
      // Absender
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(120);
      doc.text(rpAdresse.substring(0, 90), 25, 30);
      // Empfänger
      doc.setFontSize(11); doc.setTextColor(0);
      const empf = [b.b_firma || b.b_name || b.ausbildungsstaette, b.b_name && b.b_firma ? b.b_name : '', b.b_strasse, `${b.b_plz} ${b.b_ort}`].filter(Boolean);
      empf.forEach(line => { doc.text(line || '', 25, y); y += 5; });
      // Datum
      y = 75;
      doc.setFontSize(10);
      doc.text(`Freiburg, ${new Date().toLocaleDateString('de-DE')}`, 140, y);
      y = 90;
      // Betreff
      doc.setFont('helvetica','bold'); doc.setFontSize(11);
      doc.text(`Berichtsheftkontrolle am ${datum4w}`, 25, y); y += 8;
      // Text
      doc.setFont('helvetica','normal'); doc.setFontSize(10);
      const azubiNames = g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join('\n  - ');
      const text = `Sehr geehrte Damen und Herren,

am ${datum4w} findet an der ${schule}${schule_ort ? ' in '+schule_ort : ''} die Berichtsheftkontrolle für die Klasse(n) ${klassenStr} (${frStr}) statt.

Folgende Ihrer Auszubildenden sind betroffen:
  - ${azubiNames}

Bitte stellen Sie sicher, dass die Berichtshefte Ihrer Auszubildenden vollständig geführt, mit allen erforderlichen Unterschriften versehen und am Kontrolltag in der Berufsschule vorliegen.

Fehlende oder mangelhafte Berichtshefte können die Zulassung zur Abschlussprüfung gefährden.

Mit freundlichen Grüßen

${pruefer}
Regierungspräsidium Freiburg`;
      const lines = doc.splitTextToSize(text, 160);
      doc.text(lines, 25, y);
    });

    const fname = `Anschreiben_Betriebe_${schule}_${klassenStr}_${termin.geplant_datum}.pdf`.replace(/[\/ :,;+]/g,'_');
    doc.save(fname);
    App.closeModal();
    App.toast(`PDF mit ${Object.keys(grouped).length} Anschreiben erstellt`, 'success');
  },

  // ── C) E-Mail an Betrieb bei Wiedervorlage ──
  emailBetriebWV(wvId) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, s.betrieb_id,
      b.name as b_name, b.email as b_email, b.ansprechpartner as b_ap
      FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE w.id=?`, [wvId])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    const rpAdresse = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_post'") || '';
    const pruefer = App.query('SELECT name FROM pruefer WHERE aktiv=1 LIMIT 1')[0]?.name || 'Ausbildungsberater';

    // Gather open Mängel
    const maengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [w.schueler_id]);
    const maengelText = maengel.length
      ? maengel.map(m => `  - AJ ${m.ausbildungsjahr}, KW ${m.kalenderwoche}: ${m.maengel_codes.split(',').map(c => KWNav.CODE_LABELS[c]||c).join(', ')}${m.fehltage ? ' ('+m.fehltage+' Fehltage)' : ''}`).join('\n')
      : '  (keine offenen Mängel)';

    const to = w.b_email || '';
    const frist = formatDate(w.frist_datum);
    const subject = `Berichtsheftkontrolle – Mängel im Berichtsheft von ${w.nachname}, ${w.vorname}`;
    const body = `Sehr geehrte Damen und Herren,
${w.b_ap ? '\nSehr geehrte/r ' + w.b_ap + ',\n' : ''}
bei der Berichtsheftkontrolle Ihres/Ihrer Auszubildenden ${w.vorname} ${w.nachname} wurden folgende Mängel festgestellt:

${maengelText}

Wir bitten Sie, dafür Sorge zu tragen, dass die genannten Mängel bis spätestens ${frist} behoben werden.

Bitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).

Den Durchsichtsbogen der letzten Kontrolle fügen wir als Anlage bei.

Mit freundlichen Grüßen
${pruefer}
${rpAdresse}

Anlage: Durchsichtsbogen ${w.nachname}, ${w.vorname}`;

    window._pendingEmail = { to, subject, body };

    App.openModal('✉︎ E-Mail an Betrieb (Wiedervorlage)', `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${to ? esc(to) : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt!</span>'}</div>
        <div><strong>Betrieb:</strong> ${esc(w.b_name || w.ausbildungsstaette)}</div>
        <div><strong>Azubi:</strong> ${esc(w.nachname)}, ${esc(w.vorname)}</div>
        <div><strong>Betreff:</strong> ${esc(subject)}</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:200px;overflow-y:auto">${esc(body)}</pre>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--clr-amber-light);border-radius:var(--radius);font-size:11px">
        <strong>Tipp:</strong> Erstellen Sie vor dem Senden den PDF-Durchsichtsbogen und fügen Sie ihn als Anhang bei.
        <button class="btn btn-sm btn-secondary" style="margin-left:8px" onclick="Workflows.generateWVPDF(${wvId})">▤ PDF jetzt erstellen</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+(window._pendingEmail?.to||'')+'\\nBetreff: '+(window._pendingEmail?.subject||'')+'\\n\\n'+(window._pendingEmail?.body||''));App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        ${!to ? `<button class="btn btn-secondary" onclick="const e=prompt('E-Mail-Adresse eingeben:');if(e)Workflows.openMailto(e,window._pendingEmail.subject,window._pendingEmail.body)">E-Mail eingeben</button>` : ''}
        <button class="btn btn-primary" onclick="Workflows.openMailto(window._pendingEmail.to,window._pendingEmail.subject,window._pendingEmail.body,window._pendingEmail.cc);App.closeModal()">✉︎ In Outlook öffnen</button>`);
  },

  generateWVPDF(wvId) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [wvId])[0];
    if (!w) return;
    // Find latest kontrollergebnis for this student
    const ke = App.query('SELECT ke.*, kt.id as tid FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? ORDER BY ke.erstellt_am DESC LIMIT 1', [w.schueler_id])[0];
    if (ke) {
      PDFExport.generateSingle(ke.tid, w.schueler_id);
    } else {
      App.toast('Kein Kontrollergebnis für PDF gefunden', 'warning');
    }
  },

  // ── Helper: Open mailto link ──
  openMailto(to, subject, body, cc) {
    const maxLen = 1500;
    const truncBody = body.length > maxLen ? body.substring(0, maxLen) + '\n\n[Text gekürzt – bitte aus Vorschau kopieren]' : body;
    let url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(truncBody)}`;
    if (cc) url += `&cc=${encodeURIComponent(cc)}`;

    const w = window.open(url, '_self');
    if (!w) {
      navigator.clipboard.writeText(`An: ${to}${cc ? '\nCC: ' + cc : ''}\nBetreff: ${subject}\n\n${body}`).then(() => {
        App.toast('E-Mail konnte nicht geöffnet werden – Text in Zwischenablage kopiert', 'warning');
      }).catch(() => {
        App.toast('E-Mail-Client konnte nicht geöffnet werden. Bitte manuell senden.', 'error');
      });
    }
  }
};
