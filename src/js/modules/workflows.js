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
    // Kampagnen-Termine haben keine Klassen: Fachrichtung und Klassen dann
    // aus den Azubis selbst (sonst stand „– – –" im Betreff)
    let frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ');
    let klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    if (!klassen.length && schuelerList.length) {
      const frIds = [...new Set(schuelerList.map(s => s.fachrichtung_id).filter(Boolean))];
      if (frIds.length) frStr = App.query(`SELECT bezeichnung FROM fachrichtungen WHERE id IN (${frIds.map(() => '?').join(',')}) ORDER BY bezeichnung`, frIds).map(r => r.bezeichnung).join(', ');
      const klIds = [...new Set(schuelerList.map(s => s.klasse_id).filter(Boolean))];
      if (klIds.length) klassenStr = App.query(`SELECT klassenbezeichnung FROM klassen WHERE id IN (${klIds.map(() => '?').join(',')}) ORDER BY klassenbezeichnung`, klIds).map(r => r.klassenbezeichnung).join(' + ');
    }
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
  _codeLabels: { A: 'Unterschrift Azubi fehlt', B: 'Unterschrift Ausbilder fehlt', C: 'Berufsschulthemen fehlen', D: 'Wetteraufzeichnungen fehlen (Hinweis, nur mit Zusatzvereinbarung verbindlich)', E: 'Inhaltlich lückenhaft', F: 'Berichte fehlen komplett', G: 'Datum/KW falsch', H: 'Fehltage', I: 'Sonstiges (Hinweis)' },

  // Gruppen (Fachrichtung + AJ) und Namensliste je Klasse für die Schul-Mails
  _gruppenUndListe(t) {
    // Fachrichtung + Ausbildungsjahr zum Termindatum – aus Klassen UND aus
    // einzeln zugeordneten Azubis (Kampagnen-Termine, LFK-Gäste)
    const list = App.terminGruppen(t.termin.id, t.termin.geplant_datum);
    const gruppen = list.length
      ? list.map(g => `  - ${g.fr} ${g.aj != null ? g.aj + '. AJ' : ''}${g.jgBez ? ` (Abschluss ${g.jgBez})` : ''}${g.count ? ': ' + g.count + ' Auszubildende' : ''}`).join('\n')
      : `  - ${t.schuelerList.length} Auszubildende (Einzelzuordnung)`;
    const gruppenKurz = list.length ? list.map(g => `${g.fr}${g.aj != null ? ' ' + g.aj + '. AJ' : ''}`).join(', ') : t.ctx.klassen;
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

  // Ergebnisblock für die Schule (Logik-Audit Paket 6, Datenminimierung):
  // Standard sind Zahlen je Ergebnis; Namen stehen nur bei den Abwesenden
  // (die Nachholung findet an der Schule statt). Mit `mitNamen` wie früher
  // die volle Namensliste je Ergebnisart.
  _ergebnisseFuerSchule(terminId, schuelerList, mitNamen) {
    const results = {};
    const abwesend = [];
    schuelerList.forEach(s => {
      const ke = App.query('SELECT ergebnis, anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
      const e = ke?.ergebnis || (ke && ke.anwesend === 0 ? 'abwesend' : 'nicht kontrolliert');
      if (e === 'abwesend') abwesend.push(`${s.nachname}, ${s.vorname}`);
      (results[e] = results[e] || []).push(`${s.nachname}, ${s.vorname}`);
    });
    const lbl = e => e === 'abwesend' ? 'Am Kontrolltag nicht anwesend (Nachholung)' : (this._eLbl[e] || e);
    if (mitNamen) return Object.entries(results).map(([e, names]) => `\n${lbl(e)} (${names.length}):\n  - ${names.join('\n  - ')}\n`).join('');
    const zeilen = Object.entries(results).map(([e, names]) => `  - ${lbl(e)}: ${names.length}`).join('\n');
    return zeilen + (abwesend.length ? `\n\nNicht anwesend – bitte beim nächsten Schultag auf die Nachholung hinweisen:\n  - ${abwesend.sort().join('\n  - ')}` : '') + '\n';
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
    if (isDone) ctx.ergebnisse = this._ergebnisseFuerSchule(terminId, t.schuelerList, App.schuleErgebnisMitNamen());
    const { betreff, body } = App.renderVorlage(isDone ? 'schule_ergebnis' : 'schule_anfrage', ctx);
    const to = (schule.email || '').trim();
    const cc = (schule.email_cc || '').trim();
    const emailType = isDone ? 'Ergebnis-Mitteilung' : 'Terminanfrage';
    window._pendingEmail = { to, subject: betreff, body, cc, terminId, isDone };
    // Statuskette: schon angefragt? (zwei Kollegen fragten sonst doppelt an)
    const kette = App.terminKette(t.termin);
    const anfrageHinweis = !isDone && t.termin.angefragt_am
      ? `<div style="padding:6px 10px;background:var(--clr-amber-light);border-radius:var(--radius);margin-bottom:8px;font-size:12px">⚠︎ Dieser Termin wurde bereits ${esc(kette.label)} – bitte nicht doppelt anfragen (ggf. Erinnerung/Änderung).</div>`
      : '';

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
      ${anfrageHinweis}
      <div style="font-size:13px">
        <div><strong>An:</strong> ${esc(to)}</div>
        ${cc ? `<div><strong>CC:</strong> ${esc(cc)}</div>` : ''}
        <div><strong>Betreff:</strong> ${esc(betreff)}</div>
        <div style="font-size:12px;color:var(--clr-text-light);margin-top:4px">${isDone ? 'Ergebnis-Mitteilung nach Kontrolle' : 'Terminanfrage – bitte Datum bestätigen lassen'} · Text anpassbar unter Einstellungen → Vorlagen</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:300px;overflow-y:auto">${esc(body)}</pre>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('An: '+window._pendingEmail.to+'\\nBetreff: '+window._pendingEmail.subject+'\\n\\n'+window._pendingEmail.body);App.toast('In Zwischenablage kopiert','success')">▤ Kopieren</button>
        <button class="btn btn-primary" onclick="Workflows._schulMailOeffnen()">✉︎ In Outlook öffnen</button>`);
  },
  // Schul-Mail öffnen und den Schritt in der Statuskette vermerken
  // (Terminanfrage → angefragt, Ergebnis-Mitteilung → nachbereitet)
  _schulMailOeffnen(adresse) {
    const p = window._pendingEmail || {};
    this.openMailto(adresse || p.to, p.subject, p.body, p.cc);
    if (p.terminId) {
      App.terminSchritt(p.terminId, p.isDone ? 'nachbereitet' : 'angefragt');
      try { if (App.currentView === 'planung') Views.planung(); else if (App.currentView === 'termin' && typeof TerminSeite !== 'undefined') TerminSeite.render(); } catch(e) {}
    }
    App.closeModal();
  },
  _schulEmailMerkenUndOeffnen(schuleId) {
    const adr = (document.getElementById('mSchEmail2')?.value || '').trim();
    if (!adr) return App.toast('Bitte E-Mail-Adresse eingeben', 'warning');
    // In den Stammdaten merken – sonst beim nächsten Mal wieder Handarbeit
    App.run('UPDATE berufsschulen SET email=? WHERE id=? AND (email IS NULL OR email=\'\')', [adr, schuleId]);
    this._schulMailOeffnen(adr);
  },

  // ── Betriebs-Gruppierung eines Termins ──
  // Betriebe eines Termins mit ihren Azubis. Azubis FREMDER Ämter werden
  // ausgenommen (fremde) – ihre Betriebe schreibt das zuständige Amt an.
  _betriebeDesTermins(terminId, mitErgebnis) {
    const alle = App.getTerminSchueler(terminId);
    const fremde = alle.filter(s => App.istFremdesAmt(s));
    const schueler = alle.filter(s => !App.istFremdesAmt(s)).map(s => {
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
      if (!grouped[key]) grouped[key] = { key, betrieb: s, betriebId: s.betrieb_id || null, name: s.b_name, email: s.b_email, ap: this._ansprechperson(s), azubis: [] };
      grouped[key].azubis.push(s);
    });
    return { schueler, betriebe: Object.values(grouped), fremde };
  },
  // Ansprechperson eines Betriebs mit vollem Namen. IBYKUS liefert den Inhaber
  // als Nachname (betriebe.name) und Vorname, die Firma als Zusatzbezeichnung;
  // der Import schrieb den Vornamen zusätzlich als ansprechpartner – allein
  // „Daniel“ stand dann über der Firma und in der Anrede.
  _ansprechperson(b) {
    const ap = String((b && b.b_ap) || '').trim(), vn = String((b && b.b_vorname) || '').trim(), nn = String((b && b.b_name) || '').trim();
    const voll = [vn, nn].filter(Boolean).join(' ');
    if (!ap) return vn ? voll : '';
    if (vn && ap === vn) return voll;
    return ap;
  },
  // Anschrift nach DIN 5008: Firma, Person (voller Name), Straße, PLZ Ort –
  // ohne doppelte Zeilen; ohne Firma steht die Person (bzw. der Name) oben
  _betriebAnschrift(b, fallbackName) {
    const firma = String(b.b_firma || '').trim();
    const nn = String(b.b_name || fallbackName || '').trim();
    const person = this._ansprechperson(b);
    const zeilen = [];
    if (firma) { zeilen.push(firma); if (person) zeilen.push(person); }
    else if (person && nn && person.endsWith(nn)) zeilen.push(person);
    else { if (nn) zeilen.push(nn); if (person) zeilen.push(person); }
    zeilen.push(String(b.b_strasse || '').trim(), `${b.b_plz || ''} ${b.b_ort || ''}`.trim());
    const gesehen = new Set();
    return zeilen.filter(z => { const k = z.toLowerCase(); if (!z || gesehen.has(k)) return false; gesehen.add(k); return true; }).slice(0, 6);
  },
  // Passende Vorlage je Betrieb: vor der Kontrolle Ankündigung; danach
  // Mängelmitteilung, Nachhol-Aufforderung (kein Azubi des Betriebs wurde
  // kontrolliert – abwesend) oder Bestätigung ohne Beanstandung. Abwesende
  // galten früher als „ohne Beanstandung".
  _betriebVorlageTyp(g, isDone) {
    if (!isDone) return 'betrieb_ankuendigung';
    const bewertet = (g.azubis || []).filter(a => a.ke?.ergebnis);
    if (bewertet.some(a => a.ke.ergebnis !== 'in_ordnung')) return 'betrieb_maengel';
    if (!bewertet.length) return 'nachholung';
    return 'betrieb_ok';
  },
  _betriebVorlageLabel: { betrieb_ankuendigung: 'Ankündigung', betrieb_maengel: 'Mängelmitteilung', betrieb_ok: 'ohne Beanstandung', nachholung: 'Nachhol-Aufforderung (abwesend)' },
  // Vorlage zu einer Wiedervorlage: überfällig → Erinnerung; Nachholung
  // (am Kontrolltag abwesend) → Nachhol-Aufforderung, sonst Mängelmitteilung
  _wvVorlageTyp(w, ueberfaellig) {
    const art = String(w?.art || '');
    // Beratungsgespräch (§ 76 BBiG): Einladung statt Mahnung – auch überfällig
    if (art === 'beratung_betrieb') return 'beratung_betrieb';
    if (ueberfaellig) return 'wv_erinnerung';
    return art.startsWith('nachholung') ? 'nachholung' : 'wv_mahnung';
  },
  // Versandnachweis an der Wiedervorlage: Datum/Art des Anschreibens,
  // Mahnstufe (1 = Mitteilung, danach je Erinnerung +1) und Notiz
  versandVermerken(wvId, art, typ, zusatz) {
    if (!wvId) return;
    const erinnerung = typ === 'wv_erinnerung';
    // Absolut schreiben statt „+1“: eine geloggte Op kann doppelt eingespielt
    // werden (Nachladen, Absturzpuffer) – relativ hieße Mahnstufe +2
    const stufeAlt = App.scalar('SELECT COALESCE(mahnstufe,0) FROM wiedervorlagen WHERE id=?', [wvId]) || 0;
    const stufeNeu = erinnerung ? stufeAlt + 1 : Math.max(stufeAlt, 1);
    App.run(`UPDATE wiedervorlagen SET versand_datum=?, versand_art=?, mahnstufe=${stufeNeu}, geaendert_am=datetime('now','localtime') WHERE id=?`,
      [todayStr(), art || 'email', wvId]);
    const was = erinnerung ? 'Erinnerung' : typ === 'nachholung' ? 'Nachhol-Aufforderung' : typ === 'beratung_betrieb' ? 'Einladung zum Beratungsgespräch (§ 76 BBiG)' : 'Mängelmitteilung';
    App.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)",
      [wvId, `${was} per ${art === 'email' ? 'E-Mail' : (art || 'Brief')} versendet${zusatz ? ', ' + zusatz : ''}`, (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || '']);
  },
  // Azubi-Block für Anschreiben: je Azubi das Ergebnis, dann WAS nachzuholen
  // ist – je Mängel-Code eine Zeile mit den betroffenen Wochen (derselbe
  // Wortlaut wie die automatische Bemerkung und der Bogen) und die fehlenden
  // Pflichtteile. Vorher stand je Woche eine Zeile mit allen Codes; bei
  // zwölf Wochen sprengte das die mailto-Grenze und war für den Betrieb
  // schwer zu lesen.
  _azubiBlock(azubis, mitErgebnis) {
    return azubis.map(a => {
      let line = '  - ' + a.nachname + ', ' + a.vorname;
      if (mitErgebnis && a.ke?.ergebnis) line += ': ' + (this._eLbl[a.ke.ergebnis] || a.ke.ergebnis);
      else if (mitErgebnis && a.ke && a.ke.anwesend === 0) line += ': am Kontrolltag nicht anwesend – Berichtsheft bitte nachreichen';
      if (mitErgebnis) this._nachzuholen(a).forEach(z => { line += '\n    → ' + z; });
      // Eigene Bemerkung des Prüfers (ohne die automatischen Code-Zeilen, die
      // oben schon stehen, und ohne interne Vermerke) – auch bei „In Ordnung“
      if (mitErgebnis) this._bemerkungFuerBetrieb(a.ke).forEach((z, i) => { line += '\n    ' + (i === 0 ? 'Bemerkung: ' : '           ') + z; });
      return line;
    }).join('\n');
  },
  // Zeilen der Ergebnis-Bemerkung, die der Betrieb sehen soll: eigener Text
  // und Sonstiges-Einträge („[AJ2/KW40] …“); automatische Code-/Pflichtteil-
  // Sätze stehen bereits im Mängel-Block, „[Zulassung trotz Abweichung]“ ist intern
  _bemerkungFuerBetrieb(ke) {
    const intern = typeof KontrolleHandler !== 'undefined' && KontrolleHandler.ZULASSUNG_TROTZ_PREFIX ? KontrolleHandler.ZULASSUNG_TROTZ_PREFIX : '[Zulassung trotz Abweichung]';
    return String(ke?.bemerkung || '').split('\n').map(z => z.trim()).filter(z => z && !z.startsWith(intern) && !(App._autoZeileKey && App._autoZeileKey(z)));
  },
  // Schlusssatz der Bestätigung „ohne Beanstandung“ ({hinweis}): gibt es zu
  // einem Azubi eine Bemerkung, soll der Betrieb sie beachten – vorher stand
  // immer „es besteht kein weiterer Handlungsbedarf“, auch mit Bemerkungen
  _betriebHinweis(azubis) {
    const mit = (azubis || []).some(a => this._bemerkungFuerBetrieb(a.ke).length);
    return mit ? 'bitte beachten Sie die Bemerkungen zu den einzelnen Auszubildenden.' : 'es besteht kein weiterer Handlungsbedarf.';
  },
  // Zeilen „was ist nachzuholen“ für einen Azubi: Mängel-Codes (A–G und
  // Sonstiges, Wetter ohne Zusatzvereinbarung nur als Hinweis; Fehltage sind
  // kein Mangel) und fehlende Pflichtteile aus dem Kontrollergebnis
  _nachzuholen(a) {
    const zeilen = [];
    const rows = a.maengel || [];
    if (rows.length && typeof App.hinweisCodeZeile === 'function') {
      const zv = App.hatZusatzvereinbarung ? App.hatZusatzvereinbarung(a.ke) : false;
      (App.HINWEISE_REIHENFOLGE || []).filter(k => App.HINWEISE_CODES && App.HINWEISE_CODES[k]).forEach(c => {
        const z = App.hinweisCodeZeile(rows, c);
        if (z) zeilen.push(c === 'D' && !zv ? z + ' – Hinweis, ohne Zusatzvereinbarung nicht verbindlich' : z);
      });
      const sonst = App.hinweisCodeZeile(rows, 'I', 'Sonstige Beanstandungen, siehe Bemerkung');
      if (sonst) zeilen.push(sonst);
    }
    if (a.ke && App.autoHinweisPflicht) {
      ['p_1_1_ausbildungsplan', 'p_1_1_gefuehrt', 'p_1_4_auszubildende', 'p_1_5_bescheinigungen', 'p_1_5_gefuehrt', 'f_1_6_ausbildungsbetrieb'].forEach(f => {
        const s = App.autoHinweisPflicht(f, a.ke[f]);
        if (s) zeilen.push(s);
      });
    }
    return zeilen;
  },

  // ── B) Seriendruck-Hub: Betriebe anschreiben ──
  seriendruckBetriebe(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return App.toast('Termin nicht gefunden', 'error');
    const { schueler, betriebe, fremde } = this._betriebeDesTermins(terminId, false);
    App.openModal('▤ Betriebe anschreiben – Seriendruck', `
      <p style="font-size:13px;margin-bottom:12px">
        <strong>${betriebe.length} Betriebe</strong> mit insgesamt ${schueler.length} Azubis für den Termin am <strong>${t.ctx.datum}</strong>
        an der ${esc(t.ctx.schule)}${esc(t.ctx.schule_ort)}${t.klassen.length ? ', Klasse(n) ' + esc(t.ctx.klassen) : ''}.
        ${fremde.length ? `<br><span style="font-size:12px;color:var(--clr-purple)">§ ${fremde.length} Azubi(s) fremder Ämter sind ausgenommen – Weitergabe über „§ Ämter" am Termin.</span>` : ''}
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
        '<button class="btn btn-primary" onclick="Workflows.briefeBearbeiten(' + terminId + ')" title="Alle Briefe in der Vorschau bearbeiten und als PDF, Word oder E-Mail-Entwurf ausgeben">✎ Briefe</button>');
  },

  // ── BCC Serien-E-Mail an alle Betriebe ──
  emailBetriebeBCC(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const { betriebe } = this._betriebeDesTermins(terminId, false);
    const emails = [...new Set(betriebe.map(g => g.email).filter(Boolean))];
    const ohne = betriebe.filter(g => !g.email);
    const { betreff, body } = App.renderVorlage('betrieb_bcc', this._antwortCtx(t.ctx));
    App.closeModal();
    App.openModal(`✉︎ Serien-E-Mail an ${emails.length} Betriebe (BCC)`, `
      <div style="margin-bottom:8px;font-size:12px">
        <strong>${emails.length}</strong> Betriebe mit E-Mail${ohne.length ? ` · <span style="color:var(--clr-red)">${ohne.length} ohne E-Mail (Brief nötig): ${esc(ohne.map(g => g.name).join(', '))}</span>` : ''}
      </div>
      <div style="max-height:80px;overflow-y:auto;margin-bottom:8px;font-size:12px;padding:6px;background:var(--clr-warm);border-radius:var(--radius)">
        ${emails.map(e => `<span style="display:inline-block;padding:1px 6px;margin:1px;background:var(--clr-white);border-radius:4px">${esc(e)}</span>`).join('')}
      </div>
      <div class="form-group"><label>Betreff</label><input class="form-control" id="bccSubject" value="${esc(betreff)}"></div>
      <div class="form-group"><label>Text (kann vor dem Senden im E-Mail-Programm bearbeitet werden)</label>
        <textarea class="form-control" id="bccBody" rows="10" style="font-size:12px;font-family:monospace">${esc(body)}</textarea>
      </div>
      <div style="font-size:12px;color:var(--clr-text-light);margin-top:8px">
        Alle Empfänger stehen im <strong>BCC</strong> – die Betriebe sehen sich gegenseitig nicht.
        ${t.ctx.rp_email ? `Absender/An: ${esc(t.ctx.rp_email)}` : '<span style="color:var(--clr-amber)">Tipp: Unter Einstellungen → Kontaktdaten eine RP-E-Mail hinterlegen, dann steht sie im An-Feld.</span>'}
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('bccBody').value);App.toast('Text kopiert','success')">▤ Text kopieren</button>
        <button class="btn btn-sm btn-secondary" onclick="Workflows._kopiereBccAdressen()">▤ Adressen kopieren</button>
        ${ohne.length ? `<button class="btn btn-sm btn-secondary" onclick="Workflows.briefeBearbeiten(${terminId}, { nurOhneEmail: true })" title="Briefe nur für Betriebe ohne E-Mail – in der Vorschau bearbeiten">✎ Briefe für ${ohne.length} ohne E-Mail</button>` : ''}
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
  // EIN Dialog als Arbeitsliste: je Betrieb Vorlage, Azubis, Empfänger und ein
  // Status („geöffnet 10:32“, „Text in der Zwischenablage“); „Nächste öffnen“
  // arbeitet die Liste von oben ab, ohne den Dialog zu verlassen. Vorher lief
  // eine Kette von Zwischendialogen („E-Mail 2 von 10“), und der Hinweis
  // „Text zu lang – in Outlook mit Strg+V einfügen“ ging als flüchtiger Toast
  // hinter dem nächsten Dialog unter.
  emailBetriebIndividuell(terminId) {
    const t = this._ctxTermin(terminId);
    if (!t) return;
    const { betriebe } = this._betriebeDesTermins(terminId, true);
    const isDone = t.termin.status === 'durchgefuehrt';
    App.closeModal();
    const alt = this._individualData && this._individualData.terminId === terminId ? this._individualData.status : null;
    this._individualData = { terminId, betriebe, t, isDone, status: alt || {}, opts: this._betriebMailOptsLaden() };
    const withEmail = betriebe.filter(g => g.email).length;
    App.openModal('✉︎ E-Mails an ' + betriebe.length + ' Betriebe', `
      <div style="margin-bottom:8px;font-size:13px"><strong>${withEmail}</strong> Betriebe mit E-Mail${betriebe.length - withEmail ? ` · <span style="color:var(--clr-red)">${betriebe.length - withEmail} ohne E-Mail → Brief</span>` : ''}</div>
      ${this._betriebMailOptionenHtml()}
      <div id="betriebMailListe" style="max-height:420px;overflow-y:auto">${this._betriebMailListeHtml()}</div>
      <div style="margin-top:8px;font-size:12px;color:var(--clr-text-light)">Je Betrieb wird automatisch die passende Vorlage gewählt: Terminankündigung, Mängelmitteilung, Nachhol-Aufforderung (Azubi abwesend) oder Bestätigung „ohne Beanstandung“. „Öffnen“ startet Outlook mit Empfänger, Betreff und Text; ist der Text zu lang für den Link, liegt er in der Zwischenablage und wird in Outlook mit Strg+V eingefügt – die Zeile sagt es. <strong>„Alle als Outlook-Entwürfe (ZIP)“</strong> erzeugt stattdessen je Betrieb eine .eml-Datei${isDone ? ' mit den Durchsichtsbögen als Anhang' : ''}: entpacken, doppelklicken, in Outlook senden – ohne Längengrenze.${isDone ? ' Beides wird als Versand an den Wiedervorlagen der Azubis vermerkt.' : ''}</div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <span id="betriebMailFuss">${this._betriebMailFussHtml()}</span>`);
  },
  _betriebMailOffen() {
    const d = this._individualData; if (!d) return [];
    return d.betriebe.map((g, idx) => ({ g, idx })).filter(x => x.g.email && !d.status[x.idx]);
  },
  // ── Optionen vor dem Erzeugen (je Person gemerkt): Ansprechpartner
  //    namentlich ansprechen (Standard aus – „Damen und Herren“ reicht),
  //    Signatur (Standard: die angemeldete Person; jeder andere Prüfer; der
  //    Prüfer des Termins; keine – dann fügt Outlook die eigene an), Bögen
  //    als Anhang ──
  MAIL_SIGNATUR_STANDARD: 'ich',
  _betriebMailOptsLaden() {
    return {
      anrede: App.uGet('mail_anrede', '0') === '1',
      signatur: App.uGet('mail_signatur', '') || this.MAIL_SIGNATUR_STANDARD,
      boegen: App.uGet('mail_boegen', '1') !== '0',
    };
  },
  betriebMailOption(key, wert) {
    const d = this._individualData; if (!d) return;
    if (key === 'anrede') { d.opts.anrede = !!wert; App.uSet('mail_anrede', wert ? '1' : '0'); }
    else if (key === 'signatur') { d.opts.signatur = String(wert || this.MAIL_SIGNATUR_STANDARD); App.uSet('mail_signatur', d.opts.signatur); }
    else if (key === 'boegen') { d.opts.boegen = !!wert; App.uSet('mail_boegen', wert ? '1' : '0'); }
    // Vorschau, Längen-Hinweis und Fußzeile folgen den Optionen
    const liste = document.getElementById('betriebMailListe'); if (liste) liste.innerHTML = this._betriebMailListeHtml();
    const fuss = document.getElementById('betriebMailFuss'); if (fuss) fuss.innerHTML = this._betriebMailFussHtml();
  },
  // Auswahl für die Signatur: ich · andere aktive Prüfer · Prüfer des Termins · keine
  _signaturWahl() {
    const d = this._individualData; if (!d) return [];
    const ich = App.currentUser || '';
    const wahl = [];
    if (ich) wahl.push({ wert: 'ich', label: `${ich} (angemeldet)` });
    App.query('SELECT name FROM pruefer WHERE aktiv=1 ORDER BY name').map(r => r.name).filter(n => n && n !== ich)
      .forEach(n => wahl.push({ wert: 'p:' + n, label: n }));
    if (d.t.ctx.pruefer && d.t.ctx.pruefer !== ich && !wahl.some(w => w.wert === 'p:' + d.t.ctx.pruefer)) wahl.push({ wert: 'termin', label: `Prüfer des Termins (${d.t.ctx.pruefer})` });
    wahl.push({ wert: 'keine', label: 'Keine Signatur – eigene in Outlook anfügen' });
    return wahl;
  },
  // Name hinter der gewählten Signatur ('' = keine)
  _signaturName(opts) {
    const d = this._individualData; if (!d) return '';
    const s = opts.signatur || this.MAIL_SIGNATUR_STANDARD;
    if (s === 'keine') return '';
    if (s === 'termin') return d.t.ctx.pruefer || '';
    if (s.startsWith('p:')) return s.slice(2);
    return App.currentUser || d.t.ctx.pruefer || '';
  },
  _betriebMailOptionenHtml() {
    const d = this._individualData; if (!d) return '';
    const o = d.opts;
    const wahl = this._signaturWahl();
    const aktuell = wahl.some(w => w.wert === o.signatur) ? o.signatur : (wahl[0] ? wahl[0].wert : 'keine');
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:8px 10px;margin-bottom:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer" title="Aus: „Sehr geehrte Damen und Herren“. An: zusätzlich „sehr geehrte/r ‹Ansprechpartner›,“ wenn ein Ansprechpartner hinterlegt ist"><input type="checkbox" ${o.anrede ? 'checked' : ''} onchange="Workflows.betriebMailOption('anrede', this.checked)"> Ansprechpartner namentlich ansprechen</label>
      <label style="display:flex;align-items:center;gap:5px" title="Wer unterschreibt: die angemeldete Person (Standard), ein anderer Prüfer oder niemand – dann hängt Outlook beim Senden die eigene Signatur an">Signatur
        <select class="form-control" style="width:auto;font-size:12px;padding:2px 6px" onchange="Workflows.betriebMailOption('signatur', this.value)">${wahl.map(w => `<option value="${esc(w.wert)}" ${w.wert === aktuell ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select>
      </label>
      ${d.isDone ? `<label style="display:flex;align-items:center;gap:5px;cursor:pointer" title="Durchsichtsbögen der bewerteten Azubis als PDF an die Entwürfe hängen (nur ZIP)"><input type="checkbox" ${o.boegen ? 'checked' : ''} onchange="Workflows.betriebMailOption('boegen', this.checked)"> Durchsichtsbögen (PDF) anhängen</label>` : ''}
    </div>`;
  },
  _betriebMailFussHtml() {
    const d = this._individualData; if (!d) return '';
    const mit = d.betriebe.filter(g => g.email).length;
    const offen = this._betriebMailOffen();
    if (!mit) return '';
    // Hauptweg: ZIP mit Outlook-Entwürfen (keine Längengrenze, Bögen als
    // Anhang); „Nächste öffnen“ (mailto) bleibt als zweiter Weg
    const zipKnopf = typeof PizZip !== 'undefined'
      ? `<button class="btn btn-primary" onclick="Workflows.betriebMailsAlsZip()" title="Je Betrieb eine .eml-Datei mit Empfänger, Betreff, Text${d.isDone ? ' und den Durchsichtsbögen als PDF-Anhang' : ''} – ZIP entpacken, in Outlook per Doppelklick als Entwurf öffnen und senden. Keine Längengrenze, kein Strg+V.">⬇ Alle ${mit} als Outlook-Entwürfe (ZIP)</button>`
      : '';
    if (!offen.length) return `${zipKnopf}<span style="color:var(--clr-green);font-weight:600;padding:0 8px">✓ Alle ${mit} E-Mails erledigt</span>`;
    const n = mit - offen.length + 1;
    return `${zipKnopf}<button class="btn ${zipKnopf ? 'btn-secondary' : 'btn-primary'}" onclick="Workflows._naechsteBetriebMail()" title="Alternativ einzeln über den E-Mail-Link: öffnet die nächste noch nicht geöffnete E-Mail (${esc(offen[0].g.name)})">✉︎ Nächste öffnen (${n} von ${mit})</button>`;
  },
  // Alle E-Mails eines Termins als .eml-Entwürfe in einer ZIP-Datei: je Betrieb
  // Empfänger, Betreff, Text und (nach der Kontrolle) die Durchsichtsbögen der
  // genannten Azubis als PDF. Outlook (klassisch) öffnet .eml mit „X-Unsent: 1“
  // als neuen Entwurf mit „Senden“ – ohne mailto-Grenze, ohne Zwischenablage.
  betriebMailsAlsZip() {
    const d = this._individualData; if (!d) return;
    if (typeof PizZip === 'undefined') return App.toast('ZIP-Bibliothek nicht geladen', 'error');
    const mit = d.betriebe.map((g, idx) => ({ g, idx })).filter(x => x.g.email);
    if (!mit.length) return App.toast('Kein Betrieb mit E-Mail-Adresse', 'warning');
    const zip = new PizZip();
    let pdfs = 0;
    const zeit = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    mit.forEach(({ g, idx }, i) => {
      const m = this._betriebMailInhalt(idx); if (!m) return;
      const anhaenge = [];
      if (d.isDone && d.opts.boegen !== false && typeof PDFExport !== 'undefined' && PDFExport.bogenBytes) {
        g.azubis.forEach(a => {
          if (!a.ke || !a.ke.ergebnis) return;   // ohne Ergebnis (abwesend) gibt es keinen Bogen
          try { const b = PDFExport.bogenBytes(d.terminId, a.id); if (b) anhaenge.push(b); } catch(e) { console.warn('Bogen für Anhang:', e); }
        });
      }
      const eml = App.emlErzeugen({ to: g.email, cc: m.cc, subject: m.betreff, body: m.body, anhaenge });
      zip.file(App.safeFilename([String(i + 1).padStart(2, '0'), g.name], 'eml'), eml);
      pdfs += anhaenge.length;
      const erstesMal = !d.status[idx];
      d.status[idx] = { zeit, entwurf: true };
      if (erstesMal) this._betriebVersandVermerken(m, 'Entwurf (.eml) erzeugt');
    });
    zip.file('LIESMICH.txt', [
      'E-Mail-Entwürfe der Berichtsheftkontrolle',
      '',
      `Termin: ${d.t.ctx.datum} – ${d.t.ctx.schule}`,
      `${mit.length} Entwürfe, ${pdfs} Durchsichtsbögen als Anhang`,
      '',
      'So geht es weiter:',
      '1. Diese ZIP-Datei entpacken (Rechtsklick → „Alle extrahieren“).',
      '2. Jede .eml-Datei doppelklicken: Outlook öffnet sie als neuen Entwurf mit Empfänger, Betreff, Text und Anhängen.',
      '3. Prüfen, bei Bedarf ergänzen, „Senden“.',
      '',
      'Öffnet Outlook die Datei nur zum Lesen (ohne „Senden“), in der Berichtsheftkontrolle den Weg „Öffnen“ je Betrieb nutzen.',
      `Erzeugt am ${new Date().toLocaleString('de-DE')} von ${App.currentUser || ''}`,
    ].join('\r\n'));
    const bytes = zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
    App.downloadBlob(bytes, App.safeFilename(['E-Mails_Betriebe', d.t.ctx.schule, d.t.termin.geplant_datum], 'zip'), 'application/zip');
    if (d.isDone && !this._betriebMailOffen().length) { try { App.terminSchritt(d.terminId, 'nachbereitet'); } catch(e) {} }
    const liste = document.getElementById('betriebMailListe'); if (liste) liste.innerHTML = this._betriebMailListeHtml();
    const fuss = document.getElementById('betriebMailFuss'); if (fuss) fuss.innerHTML = this._betriebMailFussHtml();
    App.toast(`ZIP mit ${mit.length} E-Mail-Entwürfen${pdfs ? ` und ${pdfs} Durchsichtsbögen` : ''} erzeugt – entpacken, .eml doppelklicken, in Outlook senden`, 'success', 10000);
  },
  // Versandnachweis an den offenen Wiedervorlagen der Azubis eines Betriebs
  // (Mängelmitteilung / Nachhol-Aufforderung nach der Kontrolle)
  _betriebVersandVermerken(m, zusatz) {
    const d = this._individualData; if (!d || !d.isDone) return;
    if (m.typ !== 'betrieb_maengel' && m.typ !== 'nachholung') return;
    m.g.azubis.forEach(a => {
      if (!a.ke) return;
      App.query("SELECT id FROM wiedervorlagen WHERE kontrollergebnis_id=? AND status IN ('offen','ueberfaellig')", [a.ke.id])
        .forEach(w => this.versandVermerken(w.id, 'email', m.typ === 'nachholung' ? 'nachholung' : 'wv_mahnung', zusatz));
    });
  },
  _betriebMailListeHtml() {
    const d = this._individualData; if (!d) return '';
    return d.betriebe.map((g, idx) => this._betriebMailZeile(g, idx)).join('');
  },
  _betriebMailZeile(g, idx) {
    const d = this._individualData;
    const terminId = d.terminId, isDone = d.isDone;
    const st = d.status[idx];
    const details = g.azubis.map(a => {
      let x = '<strong>' + esc(a.nachname) + ', ' + esc(a.vorname) + '</strong>';
      if (a.ke?.ergebnis) x += ' → ' + esc(this._eLbl[a.ke.ergebnis] || a.ke.ergebnis);
      else if (a.ke && a.ke.anwesend === 0) x += ' → <span style="color:var(--clr-amber)">abwesend</span>';
      if (isDone) {
        const nz = this._nachzuholen(a);
        if (nz.length) x += '<div style="color:var(--clr-red);font-size:12px;padding-left:10px">' + nz.map(z => '→ ' + esc(z)).join('<br>') + '</div>';
      }
      return x;
    }).join('<br>');
    const art = this._betriebVorlageLabel[this._betriebVorlageTyp(g, isDone)];
    const passt = g.email ? this._betriebMailPasst(idx) : true;
    const cc = this._betriebMailCc(g);
    let status = '';
    if (st && st.entwurf) status = `<span style="color:var(--clr-green);font-weight:600">✓ Entwurf (.eml) erzeugt ${esc(st.zeit)}</span> · in Outlook öffnen und senden`;
    else if (st) status = `<span style="color:var(--clr-green);font-weight:600">✓ geöffnet ${esc(st.zeit)}</span>${st.zwischenablage ? ' · <span style="color:var(--clr-amber)">Text liegt in der Zwischenablage – in Outlook mit Strg+V einfügen</span>' : ''}`;
    else if (g.email && !passt) status = '<span style="color:var(--clr-amber)" title="Der Text ist zu lang für den E-Mail-Link. Beim Öffnen startet Outlook mit Empfänger und Betreff, der Text wird in die Zwischenablage kopiert.">Text zu lang für den Link → wird beim Öffnen kopiert (Strg+V in Outlook)</span>';
    return `<div id="betriebMail_${idx}" style="padding:8px 10px;margin-bottom:6px;background:${st ? 'var(--clr-green-light)' : g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap">
        <span><strong>${esc(g.name)}</strong> <span style="font-size:12px;color:var(--clr-text-light)">${art}</span></span>
        <span style="display:flex;gap:4px;flex-wrap:wrap">
          ${g.email
            ? `<button class="btn btn-sm ${st ? 'btn-secondary' : ''}" style="padding:2px 8px;font-size:12px${st ? '' : ';background:var(--clr-forest);color:var(--clr-white);border:none'}" onclick="Workflows._openIndividualEmail(${terminId},${idx})" title="${st ? 'Erneut in Outlook öffnen' : 'In Outlook öffnen'}">✉︎ ${st ? 'Erneut öffnen' : 'Öffnen'}</button>
               <button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:12px" onclick="Workflows._betriebMailKopieren(${idx})" title="Empfänger, Betreff und Text in die Zwischenablage">▤ Text</button>
               <button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:12px" onclick="Workflows._betriebMailVorschau(${idx})" title="Text anzeigen">Vorschau</button>`
            : `<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:12px" onclick="Workflows.briefeBearbeiten(${terminId}, { nurKey: Workflows._individualData.betriebe[${idx}].key })" title="Brief nur für diesen Betrieb – in der Vorschau bearbeiten">✎ Brief</button>
               ${g.betriebId ? `<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:12px" onclick="Workflows._betriebEmailNachtragen(${g.betriebId}, ${terminId})" title="E-Mail-Adresse in den Stammdaten nachtragen">✎ E-Mail nachtragen</button>` : ''}`}
        </span>
      </div>
      <div style="font-size:12px">${g.email ? '✉︎ ' + esc(g.email) : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt</span>'}${g.ap ? ' · ' + esc(g.ap) : ''}${g.email && cc ? ` · <span title="Die betreffenden Azubis mit hinterlegter E-Mail-Adresse erhalten die E-Mail in Kopie">CC Azubi: ${esc(cc)}</span>` : ''}${status ? ' · ' + status : ''}</div>
      <div style="margin-top:4px">${details}</div>
      <pre id="betriebMailVorschau_${idx}" style="display:none;margin-top:6px;padding:8px;background:var(--clr-white);border:1px solid var(--clr-sand);border-radius:var(--radius);font-size:12px;white-space:pre-wrap;max-height:260px;overflow:auto"></pre>
    </div>`;
  },
  // CC an die betreffenden Azubis des Betriebs (alle mit hinterlegter
  // E-Mail-Adresse, ohne Doppel) – gilt für .eml-Entwurf und mailto-Weg
  _betriebMailCc(g) {
    const seen = new Set();
    return (g?.azubis || []).map(a => String(a.email || '').trim()).filter(e => {
      if (!e || !e.includes('@') || seen.has(e.toLowerCase())) return false;
      seen.add(e.toLowerCase()); return true;
    }).join(', ');
  },
  // Mail-Inhalt eines Betriebs (Vorlage nach Lage, Kontext des Termins)
  _betriebMailInhalt(idx) {
    const d = this._individualData; if (!d) return null;
    const g = d.betriebe[idx]; if (!g) return null;
    // Nach der Kontrolle: Mängelmitteilung, Nachhol-Aufforderung (abwesend)
    // oder Bestätigung ohne Beanstandung – früher bekam ein Betrieb ohne
    // Beanstandung eine Terminankündigung im Futur für einen vergangenen Termin.
    const typ = this._betriebVorlageTyp(g, d.isDone);
    const o = d.opts || this._betriebMailOptsLaden();
    const name = this._signaturName(o);
    const ctx = this._antwortCtx({ ...d.t.ctx,
      ...(name ? { ...App.absenderCtx(name), pruefer: name } : { pruefer: '', pruefer_email: '', rp_adresse: '' }),
      anrede: o.anrede ? this._anrede(g.ap) : '',
      azubi_block: this._azubiBlock(g.azubis, d.isDone),
      hinweis: this._betriebHinweis(d.isDone ? g.azubis : []),
      azubi_namen: g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / '),
      frist: formatDate(App.wvFrist('nachholung_abwesend')) });
    let { betreff, body } = App.renderVorlage(typ, ctx);
    // Ohne Signatur auch die Grußformel weg – Outlook hängt die eigene an
    if (!name) body = body.replace(/\s*Mit freundlichen Grüßen\s*$/i, '').replace(/\s+$/, '') + '\n';
    return { g, typ, betreff, body, cc: this._betriebMailCc(g) };
  },
  _betriebMailPasst(idx) {
    const m = this._betriebMailInhalt(idx);
    return !m || this.mailtoPasst(m.g.email, m.betreff, m.body, m.cc);
  },
  _betriebMailKopieren(idx) {
    const m = this._betriebMailInhalt(idx); if (!m) return;
    const text = `An: ${m.g.email}\n${m.cc ? `CC: ${m.cc}\n` : ''}Betreff: ${m.betreff}\n\n${m.body}`;
    Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => App.toast('Empfänger, Betreff und Text kopiert', 'success')).catch(() => App.toast('Kopieren nicht möglich', 'error'));
  },
  _betriebMailVorschau(idx) {
    const pre = document.getElementById('betriebMailVorschau_' + idx); if (!pre) return;
    if (pre.style.display !== 'none') { pre.style.display = 'none'; return; }
    const m = this._betriebMailInhalt(idx); if (!m) return;
    pre.textContent = `Betreff: ${m.betreff}\n\n${m.body}`;
    pre.style.display = '';
  },
  _betriebMailZeileAuffrischen(idx) {
    const d = this._individualData; if (!d) return;
    const el = document.getElementById('betriebMail_' + idx);
    if (el && el.outerHTML !== undefined) el.outerHTML = this._betriebMailZeile(d.betriebe[idx], idx);
    const fuss = document.getElementById('betriebMailFuss');
    if (fuss) fuss.innerHTML = this._betriebMailFussHtml();
  },
  async _betriebEmailNachtragen(betriebId, terminId) {
    const adr = await App.prompt('E-Mail-Adresse des Betriebs (wird in den Stammdaten gespeichert):', { titel: 'E-Mail-Adresse nachtragen', ok: 'Speichern', platzhalter: 'name@betrieb.de' });
    if (!adr) return;
    App.run('UPDATE betriebe SET email=? WHERE id=?', [adr.trim(), betriebId]);
    App.toast('E-Mail-Adresse gespeichert', 'success');
    this.emailBetriebIndividuell(terminId);
  },
  _openIndividualEmail(terminId, betriebIdx) {
    const d = this._individualData;
    if (!d) return;
    const m = this._betriebMailInhalt(betriebIdx);
    if (!m || !m.g.email) return App.toast('Keine E-Mail-Adresse', 'warning');
    const erstesMal = !d.status[betriebIdx];
    const r = this.openMailto(m.g.email, m.betreff, m.body, m.cc, '', { still: true }) || {};
    d.status[betriebIdx] = { zeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), zwischenablage: !!r.zwischenablage };
    // Versandnachweis an den Wiedervorlagen der Azubis dieses Betriebs (nur
    // beim ersten Öffnen – ein zweites Öffnen ist kein zweites Anschreiben)
    if (erstesMal) this._betriebVersandVermerken(m, '');
    // Alle Betriebe angeschrieben → Nachbereitung des Termins erledigt
    if (d.isDone && !this._betriebMailOffen().length) {
      try { App.terminSchritt(terminId, 'nachbereitet'); } catch(e) {}
    }
    this._betriebMailZeileAuffrischen(betriebIdx);
    if (!r.geoeffnet) App.toast('E-Mail konnte nicht geöffnet werden – Text in der Zwischenablage', 'warning');
  },
  // Nächste noch nicht geöffnete E-Mail der Liste – je Klick eine (Popup-
  // Blocker lassen nur eine automatisch geöffnete Mail zu, deshalb kein Timer)
  _naechsteBetriebMail() {
    const d = this._individualData; if (!d) return;
    const offen = this._betriebMailOffen();
    if (!offen.length) return;
    const { idx } = offen[0];
    this._openIndividualEmail(d.terminId, idx);
    try {
      const naechste = this._betriebMailOffen()[0];
      const el = naechste && document.getElementById('betriebMail_' + naechste.idx);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } catch(e) {}
  },
  // Kompatibilität: früherer Einstieg „Alle nacheinander“ → erste öffnen
  _openAllIndividualEmails() { this._naechsteBetriebMail(); },

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
        const wvFrist = App.query(`SELECT w.frist_datum FROM wiedervorlagen w WHERE w.schueler_id IN (${g.azubis.map(a => a.id).join(',')}) AND w.status IN ('offen','ueberfaellig') AND w.frist_datum != '' ORDER BY w.frist_datum LIMIT 1`);
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
  // ── PDF-Briefe an die Betriebe im Briefbogen des Regierungspräsidiums ──
  // Vorlage ist das Rücksendeschreiben der Ausbildungsberatung: Logo, Rück-
  // sendeangabe, Anschrift im Fenster, Infoblock rechts (Abteilung, Name,
  // Telefon, E-Mail, Geschäftszeichen, Datum, Kontrolltermin), Betreff, Text
  // der Vorlage, nach der Kontrolle eine Übersicht je Azubi (Ergebnis,
  // Wiedervorlage, Fehltage), Grußformel mit Platz für die Unterschrift,
  // Anlagen, Fußzeile mit Datenschutzhinweis und Dienstgebäude, Falzmarken,
  // „Seite x von y“ je Brief. Alle Texte des Briefbogens kommen aus
  // App.briefEinstellung (Einstellungen → Kontakt), Telefon/E-Mail aus den
  // Prüfer-Stammdaten.
  BRIEF: { L: 25, R: 185, X2: 125, FUSS_Y: 264, ZEILE: 4.6 },
  // Briefe im Brief-Editor öffnen (Vorschau, jedes Feld änderbar, PDF/Word/E-Mail)
  briefeBearbeiten(terminId, opts) {
    if (typeof BriefEditor === 'undefined') return this.exportSeriendruckPDF(terminId, opts && opts.nurOhneEmail, opts && opts.nurKey);
    BriefEditor.oeffnen(terminId, opts || {});
  },
  // Brief-Dateien (PDF) ohne Editor – für Anhänge, Gesamtpaket und Smoke-Test.
  // opts.modelle: bereits (im Editor) bearbeitete Briefe statt neu erzeugter
  exportSeriendruckPDF(terminId, nurOhneEmail, nurKey, opts) {
    let modelle = (opts && opts.modelle) || this.briefModelle(terminId, { nurOhneEmail, nurKey });
    // Im Brief-Editor bearbeitete Briefe gehen bearbeitet mit (z. B. Gesamtpaket)
    const entwuerfe = !(opts && opts.modelle) && typeof BriefEditor !== 'undefined' && BriefEditor._entwuerfe ? BriefEditor._entwuerfe[terminId] : null;
    if (entwuerfe) modelle = modelle.map(m => entwuerfe[m.key] || m);
    if (!modelle || !modelle.length) { if (opts && opts.bytes) return null; return App.toast('Keine passenden Betriebe', 'warning'); }
    const bytes = this.briefPdfBytes(modelle);
    if (opts && opts.bytes) return bytes;
    const t = this._ctxTermin(terminId);
    App.downloadBlob(bytes, App.safeFilename(['Anschreiben_Betriebe', t ? t.ctx.schule : '', t ? t.termin.geplant_datum : ''], 'pdf'), 'application/pdf');
    App.toast(`PDF mit ${modelle.length} Anschreiben erstellt`, 'success');
  },
  // Alle Briefe eines Termins als Modelle (eins je Betrieb)
  briefModelle(terminId, opts) {
    const o = opts || {};
    const t = this._ctxTermin(terminId);
    if (!t) return [];
    const isDone = t.termin.status === 'durchgefuehrt';
    let { betriebe } = this._betriebeDesTermins(terminId, isDone);
    if (o.nurOhneEmail) betriebe = betriebe.filter(g => !g.email);
    if (o.nurKey) betriebe = betriebe.filter(g => String(g.key) === String(o.nurKey));
    return betriebe.map(g => this._briefModell(g, t, isDone));
  },
  // Ein Dokument mit allen Briefen (je Brief eigene Seitenzählung)
  briefPdfBytes(modelle) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    modelle.forEach((m, idx) => { if (idx > 0) doc.addPage(); this._briefZeichnen(doc, m); });
    return new Uint8Array(doc.output('arraybuffer'));
  },
  // Antwortadresse für Betriebe und Azubis: das Funktionspostfach, nicht die
  // E-Mail der Sachbearbeitung (Einstellung brief_antwort). Ohne Signatur
  // (pruefer_email leer) bleibt es leer.
  _antwortCtx(ctx) {
    const antwort = App.antwortEmail();
    if (!antwort) return ctx;
    return { ...ctx, antwort_email: antwort, ...(ctx && ctx.pruefer_email === '' ? {} : { pruefer_email: antwort }) };
  },
  // Betreff und Text eines Briefs aus der Vorlage (ohne Absenderblock am Ende –
  // der steht im Briefkopf), Übersichtszeilen je Azubi nach der Kontrolle
  _briefInhalt(g, t, isDone) {
    // Vor der Kontrolle: Brief-Ankündigung; danach dieselbe Vorlage wie die
    // E-Mail (Mängel / Nachholung / ohne Beanstandung) – ein Brief nach der
    // Kontrolle kündigte sonst einen vergangenen Termin an
    const typ = isDone ? this._betriebVorlageTyp(g, true) : 'brief_betrieb';
    const { betreff, body } = App.renderVorlage(typ, this._antwortCtx({ ...t.ctx, anrede: this._anrede(g.ap),
      azubi_liste: '  - ' + g.azubis.map(a => `${a.nachname}, ${a.vorname}`).join('\n  - '),
      azubi_block: this._azubiBlock(g.azubis, isDone),
      hinweis: this._betriebHinweis(isDone ? g.azubis : []),
      azubi_namen: g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / '),
      frist: formatDate(App.wvFrist('nachholung_abwesend')),
      rp_adresse: '', rp_name: '' }));
    // Helvetica in jsPDF kennt keine Pfeile/Häkchen – die Zeilen der Vorlage
    // (→ aus dem Mängel-Block) sonst als „!'“ gedruckt
    const pdfText = (s) => String(s || '').replace(/→/g, '–').replace(/✓|✔/g, 'OK').replace(/⚠/g, '!');
    const zeilen = pdfText(body).replace(/\s+$/, '').split('\n');
    const uebersicht = isDone ? g.azubis.filter(a => a.ke).map(a => {
      const ke = a.ke;
      const wv = App.query("SELECT frist_datum, status FROM wiedervorlagen WHERE kontrollergebnis_id=? ORDER BY id DESC LIMIT 1", [ke.id])[0];
      let ergebnis = ke.ergebnis ? (this._eLbl[ke.ergebnis] || ke.ergebnis) : (ke.anwesend === 0 ? 'nicht anwesend – Berichtsheft nachreichen' : 'nicht bewertet');
      let frist = '–';
      if (wv && wv.frist_datum) frist = formatDate(wv.frist_datum);
      else if (ke.ergebnis && ke.ergebnis !== 'in_ordnung') frist = 'nächste Durchsicht';
      else if (!ke.ergebnis && ke.anwesend === 0) frist = formatDate(App.wvFrist('nachholung_abwesend'));
      return [`${a.nachname}, ${a.vorname}`, ergebnis, frist, String(ke.fehltage_gesamt || 0)];
    }) : [];
    return { typ, betreff: pdfText(betreff), zeilen, uebersicht };
  },
  // ── Brief als Modell: jedes automatisch erzeugte Element ist ein Feld, das
  //    der Brief-Editor (BriefEditor) ändern kann. PDF, Word und E-Mail
  //    entstehen aus demselben Modell – was im Editor steht, steht im Brief. ──
  BRIEF_TABELLE_KOPF: ['Auszubildende/r', 'Ergebnis der Durchsicht', 'Wiedervorlage bis', 'Fehltage'],
  _briefModell(g, t, isDone) {
    const b = g.betrieb || {};
    const absender = App.absenderCtx(t.ctx.pruefer);
    const inhalt = this._briefInhalt(g, t, isDone);
    const anschrift = this._betriebAnschrift(b, g.name);
    const iGruss = inhalt.zeilen.findIndex(z => /^\s*Mit freundlichen Gr/i.test(z));
    const textZeilen = iGruss >= 0 ? inhalt.zeilen.slice(0, iGruss) : inhalt.zeilen;
    const nameZeilen = iGruss >= 0 ? inhalt.zeilen.slice(iGruss + 1).map(z => z.trim()).filter(Boolean) : [];
    while (textZeilen.length && !textZeilen[textZeilen.length - 1].trim()) textZeilen.pop();
    const gz = App.briefEinstellung('geschaeftszeichen');
    // Infoblock: Gruppen werden mit etwas Abstand gesetzt
    const info = [
      { label: 'Name:', wert: t.ctx.pruefer, gruppe: 1 },
      { label: 'Telefon:', wert: absender.pruefer_telefon, gruppe: 1 },
      // Rückfragen der Betriebe und Azubis an das Funktionspostfach
      { label: 'E-Mail:', wert: App.antwortEmail() || absender.pruefer_email, gruppe: 1 },
      { label: 'Geschäftszeichen:', wert: gz, gruppe: 2, zusatz: gz ? '(bei Antwort bitte angeben)' : '' },
      { label: 'Datum:', wert: absender.datum_heute, gruppe: 3 },
      { label: isDone ? 'Kontrolle am:' : 'Kontrolltermin:', wert: t.ctx.datum, gruppe: 4 },
      { label: 'Berufsschule:', wert: t.ctx.schule, gruppe: 4 },
    ].filter(z => z.wert);
    const cc = this._betriebMailCc(g);
    return {
      v: 1, terminId: t.termin.id, key: String(g.key), typ: inhalt.typ, isDone,
      betriebName: b.b_firma || g.name || '', email: g.email || '', cc,
      azubiIds: g.azubis.filter(a => a.ke && a.ke.ergebnis).map(a => a.id),
      keIds: g.azubis.filter(a => a.ke).map(a => a.ke.id),
      ruecksende: App.briefEinstellung('ruecksende'),
      anschrift: anschrift.join('\n'),
      abteilung: App.briefEinstellung('abteilung'),
      info,
      betreff: inhalt.betreff,
      text: textZeilen.join('\n'),
      tabelle: inhalt.uebersicht.length ? { kopf: this.BRIEF_TABELLE_KOPF.slice(), zeilen: inhalt.uebersicht.map(z => z.slice()) } : null,
      gruss: iGruss >= 0 ? inhalt.zeilen[iGruss].trim() : '',
      unterschrift: nameZeilen.join('\n'),
      anlagen: isDone ? App.briefEinstellung('anlagen').split('\n').map(z => z.trim()).filter(Boolean).join('\n') : '',
      kopfFolge: `Regierungspräsidium Freiburg · ${App.briefEinstellung('abteilung').split(' – ')[0]} · ${inhalt.betreff}`,
      datenschutz: App.briefEinstellung('datenschutz'),
      fusszeile: App.briefEinstellung('fusszeile'),
    };
  },
  _briefLogo() {
    try { return (typeof PDFExport !== 'undefined' && PDFExport._logoDataUrl) ? PDFExport._logoDataUrl() : null; } catch(e) { return null; }
  },
  // Helvetica in jsPDF: Zeichen ohne Glyphe ersetzen (auch in Editor-Eingaben)
  _pdfText(s) { return String(s || '').replace(/→/g, '–').replace(/✓|✔/g, 'OK').replace(/⚠/g, '!'); },
  // Ein Brief (ggf. mehrere Seiten) aus dem Modell; Kopf, Fuß und
  // Seitenzahlen werden nach dem Text für alle Seiten dieses Briefs gezeichnet
  _briefZeichnen(doc, m) {
    const B = this.BRIEF, L = B.L, R = B.R, W = R - L, X2 = B.X2;
    const grau = [108, 101, 96], tinte = [30, 30, 30];
    const T = (s) => this._pdfText(s);
    const zeilenVon = (s) => String(s || '').split('\n');
    const ersteSeite = doc.internal.getNumberOfPages();

    // Logo (wie Oberfläche und Durchsichtsbogen), sonst Schriftzug
    const logo = this._briefLogo();
    if (logo) { try { doc.addImage(logo.data, logo.format || 'PNG', L, 12, 52, 52 / (logo.ratio || 4.14), undefined, 'FAST'); } catch(e) {} }
    else { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...tinte); doc.text('Regierungspräsidium Freiburg', L, 20); }

    // Rücksendeangabe über dem Anschriftfeld
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...grau);
    if (m.ruecksende) doc.text(T(m.ruecksende).split('\n')[0], L, 37);

    // Anschrift (Fensterfeld)
    doc.setFontSize(11); doc.setTextColor(...tinte);
    let ya = 52;
    zeilenVon(m.anschrift).filter(z => z.trim()).slice(0, 7).forEach(z => { doc.splitTextToSize(T(z), 85).forEach(zz => { doc.text(zz, L, ya); ya += 5; }); });

    // Infoblock rechts
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...tinte);
    const abt = doc.splitTextToSize(T(m.abteilung), 60);
    abt.slice(0, 3).forEach((z, i) => doc.text(z, X2, 40 + i * 3.8));
    let yi = Math.max(52, 40 + Math.min(abt.length, 3) * 3.8 + 5);
    let gruppe = null;
    (m.info || []).forEach(z => {
      if (!String(z.wert || '').trim() && !String(z.label || '').trim()) return;
      if (gruppe !== null && z.gruppe !== gruppe) yi += 2;
      gruppe = z.gruppe;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...grau); doc.text(T(z.label), X2, yi);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...tinte);
      // Lange Werte (E-Mail, Schulname) erst verkleinern, dann umbrechen –
      // sonst bricht eine Adresse mitten im Wort
      const wert = T(z.wert);
      let fs = 9;
      doc.setFontSize(fs);
      while (fs > 7 && doc.getTextWidth(String(wert)) > 38) { fs -= 0.5; doc.setFontSize(fs); }
      const teile = doc.splitTextToSize(String(wert), 38);
      teile.forEach((zz, i) => doc.text(zz, X2 + 24, yi + i * 4));
      yi += 4.5 + (teile.length - 1) * 4;
      if (z.zusatz) { doc.setFontSize(7.5); doc.text(T(z.zusatz), X2 + 24, yi - 0.5); yi += 4; }
    });

    // Betreff
    let y = Math.max(98, ya + 8, yi + 6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...tinte);
    doc.splitTextToSize(T(m.betreff), W).forEach(z => { doc.text(z, L, y); y += 5.2; });
    y += 5;

    // Text – Einrückung der Vorlage bleibt erhalten
    const neueSeite = () => { doc.addPage(); return 32; };
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...tinte);
    zeilenVon(T(m.text)).forEach(z => {
      if (!z.trim()) { y += 2.4; return; }
      const einzug = (z.match(/^\s*/) || [''])[0].length;
      const x = L + Math.min(einzug, 8) * 1.1;
      doc.splitTextToSize(z.trim(), W - (x - L)).forEach(zz => {
        if (y > B.FUSS_Y) y = neueSeite();
        doc.text(zz, x, y); y += B.ZEILE;
      });
    });

    // Übersicht je Azubi (nach der Kontrolle): Ergebnis, Wiedervorlage, Fehltage
    const tab = m.tabelle && m.tabelle.zeilen && m.tabelle.zeilen.length ? m.tabelle : null;
    if (tab && typeof doc.autoTable === 'function') {
      y += 1;
      if (y > B.FUSS_Y - 24) y = neueSeite();
      doc.autoTable({
        startY: y,
        margin: { left: L, right: 210 - R, top: 32, bottom: 297 - B.FUSS_Y + 4 },
        head: [tab.kopf.map(T)],
        body: tab.zeilen.map(z => z.map(T)),
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.4, textColor: tinte, lineColor: [200, 196, 192], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: [242, 240, 239], textColor: tinte, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 46 }, 2: { cellWidth: 34 }, 3: { cellWidth: 18, halign: 'right' } },
      });
      y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...tinte);
    }

    // Grußformel, Platz für die Unterschrift, Name, Anlagen – zusammenhalten
    const nameZeilen = zeilenVon(m.unterschrift).map(z => z.trim()).filter(Boolean);
    const anlagen = zeilenVon(m.anlagen).map(z => z.trim()).filter(Boolean);
    const gruss = String(m.gruss || '').trim();
    const blockH = (gruss ? 6 + 12 + nameZeilen.length * B.ZEILE : nameZeilen.length * B.ZEILE) + (anlagen.length ? 7 + anlagen.length * B.ZEILE : 0);
    if (y + blockH > B.FUSS_Y) y = neueSeite();
    if (gruss) {
      y += 2;
      doc.text(T(gruss), L, y);
      y += 12;                                  // Raum für die handschriftliche Unterschrift
    }
    nameZeilen.forEach(z => { doc.text(T(z), L, y); y += B.ZEILE; });
    if (anlagen.length) {
      y += 3;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text('Anlagen', L, y); y += 4.4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      anlagen.forEach(z => { doc.text(T(z), L, y); y += B.ZEILE; });
    }

    // Kopf der Folgeseiten, Fußzeile und „Seite x von y“ für alle Seiten dieses Briefs
    const letzteSeite = doc.internal.getNumberOfPages();
    const gesamt = letzteSeite - ersteSeite + 1;
    for (let p = ersteSeite; p <= letzteSeite; p++) {
      doc.setPage(p);
      if (p > ersteSeite) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...grau);
        doc.text(T(m.kopfFolge).substring(0, 120), L, 18);
        doc.text(T(m.betriebName).substring(0, 60), R, 18, { align: 'right' });
        doc.setDrawColor(200, 196, 192); doc.setLineWidth(0.2); doc.line(L, 20.5, R, 20.5);
      } else {
        // Falz- und Lochmarken (DIN 5008)
        doc.setDrawColor(140); doc.setLineWidth(0.2);
        doc.line(5, 105, 10, 105); doc.line(5, 210, 10, 210); doc.line(5, 148.5, 12, 148.5);
      }
      this._briefFuss(doc, p - ersteSeite + 1, gesamt, m);
    }
    doc.setPage(letzteSeite);
    doc.setTextColor(0); doc.setLineWidth(0.2); doc.setDrawColor(0);
  },
  // Fußzeile: Datenschutzhinweis, Seitenzahl, Dienstgebäude in drei Spalten
  _briefFuss(doc, seite, gesamt, m) {
    const B = this.BRIEF, L = B.L, R = B.R, grau = [108, 101, 96];
    const datenschutz = m ? m.datenschutz : App.briefEinstellung('datenschutz');
    const fusszeile = m ? m.fusszeile : App.briefEinstellung('fusszeile');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...grau);
    const ds = doc.splitTextToSize(this._pdfText(datenschutz), R - L).slice(0, 3);
    ds.forEach((z, i) => doc.text(z, L, 268 + i * 3.2));
    doc.setFontSize(7.5); doc.text(`Seite ${seite} von ${gesamt}`, R, 279.5, { align: 'right' });
    doc.setDrawColor(200, 196, 192); doc.setLineWidth(0.2); doc.line(L, 281.5, R, 281.5);
    const teile = this._pdfText(fusszeile).split('|').map(z => z.trim()).filter(Boolean);
    const spalten = [L, L + 62, L + 118];
    doc.setFontSize(6.5);
    teile.forEach((z, i) => {
      const sp = Math.floor(i / 2), zeile = i % 2;
      if (sp > 2) return;
      doc.text(z.substring(0, 60), spalten[sp], 285.5 + zeile * 3.2);
    });
    doc.setTextColor(0);
  },

  // ── C) E-Mail an Betrieb bei Wiedervorlage (Mängelmitteilung / Erinnerung) ──
  emailBetriebWV(wvId) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, s.betrieb_id,
      b.name as b_name, b.email as b_email, b.ansprechpartner as b_ap,
      ke.geaendert_von as ke_pruefer, ke.pruefer as ke_pruefer2, kt.pruefer as kt_pruefer, kt.geplant_datum as kt_datum, kt.id as kt_id
      FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id
      LEFT JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE w.id=?`, [wvId])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    // Prüfer DER DURCHSICHT – nicht "irgendein aktiver Prüfer"
    const prueferName = w.ke_pruefer2 || w.ke_pruefer || (w.kt_pruefer || '').split(',')[0].trim() || KontrolleHandler?.activePruefer || App.query('SELECT name FROM pruefer WHERE aktiv=1 LIMIT 1')[0]?.name || 'Ausbildungsberater';
    const maengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [w.schueler_id]);
    const maengelText = maengel.length
      ? maengel.map(m => `  - AJ ${m.ausbildungsjahr}, KW ${m.kalenderwoche}: ${m.maengel_codes.split(',').map(c => KWNav.CODE_LABELS[c] || c).join(', ')}${m.fehltage ? ' (' + m.fehltage + ' Fehltage)' : ''}`).join('\n')
      : '  (keine offenen Mängel)';
    const heute = todayStr();
    const ueberfaellig = w.status === 'ueberfaellig' || (w.status === 'offen' && w.frist_datum && w.frist_datum < heute);
    const fristNeu = App.wvFrist('erinnerung');
    const azubi = `${w.vorname} ${w.nachname}`;
    const ktSchule = w.kt_id ? App.getTerminSchule(w.kt_id) : null;
    // Anlass eines Beratungsgesprächs (§ 76) steht als Notiz „Anlass: …“ an der Wiedervorlage
    const anlass = App.query("SELECT notiz FROM wiedervorlage_notizen WHERE wiedervorlage_id=? AND notiz LIKE 'Anlass:%' ORDER BY id DESC LIMIT 1", [wvId]).map(r => r.notiz.replace(/^Anlass:\s*/, ''))[0] || (maengel.length ? maengelText : '  wiederholte Beanstandungen der Berichtsheftführung');
    const ctx = this._antwortCtx({ ...App.absenderCtx(prueferName), anrede: this._anrede(w.b_ap), azubi, maengel: maengelText,
      frist: w.frist_datum ? formatDate(w.frist_datum) : 'zur nächsten Durchsicht', frist_alt: w.frist_datum ? formatDate(w.frist_datum) : 'zur nächsten Durchsicht', frist_neu: formatDate(fristNeu),
      azubi_block: '  - ' + w.nachname + ', ' + w.vorname, azubi_namen: w.nachname + ', ' + w.vorname,
      betrieb: w.b_name || w.ausbildungsstaette || '', anlass,
      datum: formatDate(w.kt_datum || ''), schule: ktSchule ? ktSchule.name : '' });
    // Nachholungs-WV (am Kontrolltag abwesend) bekommt die Nachhol-Aufforderung,
    // keinen Mängel-Text; Beratungsgespräch (§ 76) die Einladung
    const typ = this._wvVorlageTyp(w, ueberfaellig);
    const { betreff, body } = App.renderVorlage(typ, ctx);
    const to = w.b_email || '';
    const istBeratung = typ === 'beratung_betrieb';
    window._pendingEmail = { to, subject: betreff, body, wvId, typ, fristNeu: ueberfaellig && !istBeratung ? fristNeu : null };
    App.openModal(`✉︎ ${istBeratung ? 'Einladung zum Beratungsgespräch (§ 76 BBiG)' : ueberfaellig ? 'Erinnerung' : typ === 'nachholung' ? 'Nachhol-Aufforderung' : 'Mängelmitteilung'} an Betrieb (Wiedervorlage)`, `
      <div style="font-size:13px">
        <div><strong>An:</strong> ${to ? esc(to) : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt!</span>'}</div>
        <div><strong>Betrieb:</strong> ${esc(w.b_name || w.ausbildungsstaette)} · <strong>Azubi:</strong> ${esc(w.nachname)}, ${esc(w.vorname)}</div>
        ${w.versand_datum ? `<div style="font-size:12px;color:var(--clr-text-light)">Bisher: ${w.mahnstufe || 1}× angeschrieben, zuletzt ${formatDate(w.versand_datum)} (${esc(w.versand_art || '')})</div>` : ''}
        ${ueberfaellig && !istBeratung ? `<div style="margin-top:6px;padding:6px 10px;background:var(--clr-amber-light);border-radius:var(--radius)">Frist ${formatDate(w.frist_datum)} ist überschritten → Erinnerung mit neuer Frist:
          <input type="date" class="form-control" id="wvFristNeu" value="${fristNeu}" style="display:inline-block;width:150px;padding:2px 6px;margin-left:6px" onchange="Workflows._wvFristNeuGeaendert(this.value)"> (wird in der Wiedervorlage gespeichert)</div>` : ''}
        <div style="margin-top:4px"><strong>Betreff:</strong> <span id="wvMailBetreff">${esc(betreff)}</span></div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre id="wvMailBody" style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:220px;overflow-y:auto">${esc(body)}</pre>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px">
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
    }
    // Versandnachweis (Datum, Art, Mahnstufe) + Notiz
    if (p.wvId) this.versandVermerken(p.wvId, 'email', p.typ, p.fristNeu ? 'neue Frist ' + formatDate(p.fristNeu) : '');
    this.openMailto(p.to, p.subject, p.body);
    App.closeModal();
    if (p.fristNeu) { App.toast('Neue Frist gespeichert', 'success'); try { Views.wiedervorlagen(); } catch(e) {} }
  },
  async _betriebEmailNachtragenWV(betriebId, wvId) {
    const adr = await App.prompt('E-Mail-Adresse des Betriebs (wird in den Stammdaten gespeichert):', { titel: 'E-Mail-Adresse nachtragen', ok: 'Speichern', platzhalter: 'name@betrieb.de' });
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
    const fristTxt = formatDate(frist || App.wvFrist('nachholung_abwesend'));
    this._individualData = null;
    let listHtml = '';
    betroffen.forEach((g, idx) => {
      listHtml += `<div style="padding:8px 10px;margin-bottom:6px;background:${g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div><strong>${esc(g.name)}</strong> · ${g.azubis.map(a => esc(a.nachname + ', ' + a.vorname)).join(' / ')}<div style="font-size:12px">${g.email ? '✉︎ ' + esc(g.email) : '<span style="color:var(--clr-red)">Keine E-Mail – Brief drucken</span>'}</div></div>
        ${g.email ? `<button class="btn btn-sm" style="background:var(--clr-forest);color:var(--clr-white);border:none;font-size:12px" onclick="Workflows._nachholungMail(${idx})">✉︎ Senden</button>` : `<button class="btn btn-sm btn-secondary" style="font-size:12px" onclick="Workflows.briefeBearbeiten(${terminId}, { nurKey: Workflows._nachholung.betroffen[${idx}].key })">✎ Brief</button>`}
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
    const ctx = this._antwortCtx({ ...n.t.ctx, anrede: this._anrede(g.ap), azubi_block: this._azubiBlock(g.azubis, false),
      azubi_namen: g.azubis.map(a => a.nachname + ', ' + a.vorname).join(' / '), frist: n.fristTxt });
    const { betreff, body } = App.renderVorlage('nachholung', ctx);
    this.openMailto(g.email, betreff, body);
  },

  // ── D2) Sammel-Erinnerung je Betrieb: alle offenen/überfälligen WV eines Betriebs in EINER Mail ──
  _sammelGruppen(nurUeberfaellig) {
    const heute = todayStr();
    const rows = App.query(`SELECT w.*, s.nachname, s.vorname, s.betrieb_id, s.ausbildungsstaette, s.zustaendiges_amt,
        b.name AS b_name, b.email AS b_email, b.ansprechpartner AS b_ap
      FROM wiedervorlagen w JOIN schueler s ON s.id=w.schueler_id LEFT JOIN betriebe b ON b.id=s.betrieb_id
      WHERE w.status IN ('offen','ueberfaellig') ORDER BY b.name, s.nachname`);
    const gruppen = {};
    rows.forEach(w => {
      if (App.istFremdesAmt(w)) return;
      const ueberfaellig = w.status === 'ueberfaellig' || (w.frist_datum && w.frist_datum < heute);
      if (nurUeberfaellig && !ueberfaellig) return;
      const key = w.betrieb_id || ('n:' + (w.ausbildungsstaette || '?'));
      if (!gruppen[key]) gruppen[key] = { key, betriebId: w.betrieb_id || null, name: w.b_name || w.ausbildungsstaette || '?', email: w.b_email || '', ap: w.b_ap || '', wvs: [] };
      gruppen[key].wvs.push({ ...w, ueberfaellig });
    });
    return Object.values(gruppen).filter(g => g.wvs.length);
  },
  sammelErinnerung(nurUeberfaellig) {
    const gruppen = this._sammelGruppen(!!nurUeberfaellig);
    if (!gruppen.length) return App.toast('Keine offenen Wiedervorlagen (eigenes Amt)', 'info');
    this._sammel = gruppen;
    App.openModal(`✉︎ Sammel-Erinnerung je Betrieb (${gruppen.length})`, `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Je Betrieb EINE E-Mail mit allen offenen Nachweisen (Vorlage „Sammel-Erinnerung"). Jeder Versand wird an den Wiedervorlagen vermerkt (Datum, Mahnstufe).
        <label style="margin-left:8px;cursor:pointer"><input type="checkbox" ${nurUeberfaellig ? 'checked' : ''} onchange="App.closeModal();Workflows.sammelErinnerung(this.checked)"> nur überfällige</label></div>
      ${gruppen.map((g, i) => `<div style="padding:8px 10px;margin-bottom:6px;background:${g.email ? 'var(--clr-warm)' : 'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong>${esc(g.name)}</strong> <span style="color:var(--clr-text-light)">${g.wvs.length} WV${g.wvs.some(w => w.ueberfaellig) ? ' · <span style="color:var(--clr-red)">überfällig</span>' : ''}</span>
          <span style="margin-left:auto">${g.email ? `<button class="btn btn-sm" style="background:var(--clr-forest);color:var(--clr-white);border:none;font-size:12px" onclick="Workflows._sammelMail(${i})">✉︎ Senden</button>` : '<span style="color:var(--clr-red)">Keine E-Mail hinterlegt</span>'}</span></div>
        <div style="margin-top:4px">${g.wvs.map(w => `${esc(w.nachname)}, ${esc(w.vorname)} – ${esc(wvArtLabel(w.art))}, ${w.frist_datum ? 'Frist ' + formatDate(w.frist_datum) : 'bis zur nächsten Durchsicht'}${w.mahnstufe ? ` (${w.mahnstufe}× angeschrieben)` : ''}`).join('<br>')}</div>
      </div>`).join('')}`, '<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>');
  },
  _sammelBlock(g) {
    return g.wvs.map(w => `  - ${w.nachname}, ${w.vorname}: ${wvArtLabel(w.art)}, ${w.frist_datum ? 'Frist ' + formatDate(w.frist_datum) : 'bis zur nächsten Durchsicht'}${w.ueberfaellig ? ' (überschritten)' : ''}`).join('\n');
  },
  _sammelMail(i) {
    const g = (this._sammel || [])[i];
    if (!g) return;
    const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || 'Ausbildungsberater';
    const ctx = this._antwortCtx({ ...App.absenderCtx(pruefer), anrede: this._anrede(g.ap), azubi_block: this._sammelBlock(g),
      azubi_namen: g.wvs.map(w => w.nachname + ', ' + w.vorname).filter((v, k, a) => a.indexOf(v) === k).join(' / ') });
    const { betreff, body } = App.renderVorlage('wv_sammel', ctx);
    this.openMailto(g.email, betreff, body);
    g.wvs.forEach(w => this.versandVermerken(w.id, 'email', w.mahnstufe ? 'wv_erinnerung' : 'wv_mahnung', 'Sammel-Erinnerung'));
    App.toast(`Sammel-Erinnerung an ${g.name} geöffnet – ${g.wvs.length} Wiedervorlage(n) vermerkt`, 'success');
    try { if (App.currentView === 'wiedervorlagen') Views.wiedervorlagen(); } catch(e) {}
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
          ${!to ? `<input class="form-control" id="mAmtEmail" placeholder="E-Mail des zuständigen Beraters" style="display:inline-block;width:280px;padding:3px 6px;margin-left:6px"> <span style="font-size:12px;color:var(--clr-text-light)">(wird für dieses Amt gespeichert)</span>` : ''}
        </div>
        <div><strong>Betreff:</strong> ${esc(betreff)}</div>
        <hr style="margin:8px 0;border-color:var(--clr-sand)">
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:260px;overflow-y:auto">${esc(body)}</pre>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px">
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
  MAILTO_MAX: 1900,
  _mailtoUrl(to, subject, body, cc, bcc) {
    const params = [];
    if (cc) params.push('cc=' + encodeURIComponent(cc));
    if (bcc) params.push('bcc=' + encodeURIComponent(bcc));
    const base = `mailto:${to || ''}?subject=${encodeURIComponent(subject || '')}`;
    const rest = params.length ? '&' + params.join('&') : '';
    return { base, rest, full: base + '&body=' + encodeURIComponent(body || '') + rest };
  },
  // Passt die Mail komplett in den Link? (sonst landet der Text in der Zwischenablage)
  mailtoPasst(to, subject, body, cc, bcc) {
    return this._mailtoUrl(to, subject, body, cc, bcc).full.length <= this.MAILTO_MAX;
  },
  // opts.still: keine Toasts – der Aufrufer zeigt den Stand selbst (Betriebsliste).
  // Rückgabe { geoeffnet, zwischenablage }.
  openMailto(to, subject, body, cc, bcc, opts) {
    const still = !!(opts && opts.still);
    const { base, rest, full } = this._mailtoUrl(to, subject, body, cc, bcc);
    let url = full, hinweis = '', zwischenablage = false;
    if (full.length > this.MAILTO_MAX) {
      url = base + rest;
      zwischenablage = true;
      try { navigator.clipboard.writeText(body || ''); } catch(e) {}
      hinweis = 'Der Text ist zu lang für den E-Mail-Link – er wurde in die Zwischenablage kopiert: bitte in der geöffneten E-Mail mit Strg+V einfügen.';
      if (url.length > this.MAILTO_MAX && bcc) {
        url = base;
        try { navigator.clipboard.writeText(`BCC: ${bcc}\n\n${body || ''}`); } catch(e) {}
        hinweis = 'Empfängerliste und Text wurden in die Zwischenablage kopiert (zu lang für den Link) – bitte in der E-Mail einfügen.';
      }
    }
    // Nicht window.open(url, '_self'): Chrome meldet bei file:-Seiten dafür
    // „Unsafe attempt to load URL" – location.href öffnet das Mailprogramm
    // ohne diese Warnung
    let w = null;
    try { location.href = url; w = window; } catch(e) { w = null; }
    if (hinweis && !still) App.toast(hinweis, 'warning');
    if (!w) {
      Promise.resolve().then(() => navigator.clipboard.writeText(`An: ${to}${cc ? '\nCC: ' + cc : ''}${bcc ? '\nBCC: ' + bcc : ''}\nBetreff: ${subject}\n\n${body}`)).then(() => {
        if (!still) App.toast('E-Mail konnte nicht geöffnet werden – Text in Zwischenablage kopiert', 'warning');
      }).catch(() => { if (!still) App.toast('E-Mail-Client konnte nicht geöffnet werden. Bitte manuell senden.', 'error'); });
    }
    return { geoeffnet: !!w, zwischenablage };
  }
};
