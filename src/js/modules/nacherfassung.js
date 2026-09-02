// ═══════════════════════════════════════════════════════════════════
//  Nacherfassung: vergangene Durchsichten (Papierbogen / Altdaten) schnell
//  in den Datenbestand übernehmen.
//
//  Datenmodell – identisch zur Live-Kontrolle:
//  • „Geprüft bis KW" → alle Kalenderwochen vom Ausbildungsbeginn bis
//    einschließlich dieser KW gelten als geprüft (kw_status.geprueft=1,
//    kaskadiert über frühere Ausbildungsjahre) – über KWNav.persistCodes /
//    trackSessionKW, also EXAKT der Mechanismus der Live-Kontrolle.
//  • Fehltage gesamt (pauschal, laut Papierbogen) → kontrollergebnisse.
//    fehltage_pauschal; fehltage_gesamt = KW-Einträge + pauschal.
//  • Mängelcodes → der zuletzt geprüften KW zugeordnet.
//  • Pro Speichern entsteht/wächst EIN Nacherfassungs-Termin je Schule+Datum;
//    jeder Azubi wird einzeln daran gebunden (kontrolltermin_schueler).
// ═══════════════════════════════════════════════════════════════════
const NacherfassungHandler = {
  _rows: [],
  _kwDefault: null,

  loadKlassen() {
    const bsId = document.getElementById('neSchule')?.value;
    const sel = document.getElementById('neKlasse');
    if (!sel) return;
    sel.innerHTML = '<option value="">– alle Klassen –</option>';
    if (!bsId) return;
    // Ungefiltert (kein App.gf): auch Klassen mit Azubis fremder Ämter
    const klassen = App.query("SELECT k.*, j.bezeichnung as jg, fr.bezeichnung as fr_name FROM klassen k LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id WHERE k.berufsschule_id=? ORDER BY k.klassenbezeichnung", [bsId]);
    klassen.forEach(k => {
      sel.insertAdjacentHTML('beforeend', `<option value="${k.id}">${esc(k.klassenbezeichnung)} (${esc(k.jg||'')} – ${esc(k.fr_name||'')})</option>`);
    });
    this.loadSchueler();
  },

  // KW-Vorschlag für „geprüft bis": die Woche VOR dem Durchsichtsdatum
  // (die laufende Woche ist am Durchsichtstag meist noch nicht im Heft)
  _kwVorschlag(datumStr) {
    const d = App._parseDate(datumStr);
    if (!d) return '';
    d.setDate(d.getDate() - 7);
    return App._isoKW(d);
  },
  _datumGeaendert() {
    const neu = this._kwVorschlag(document.getElementById('neTerminDatum')?.value);
    document.querySelectorAll('.ne-kw').forEach(inp => {
      // Nur Felder aktualisieren, die noch den alten Vorschlag tragen
      if (String(inp.value) === String(this._kwDefault ?? '')) inp.value = neu;
    });
    this._kwDefault = neu;
  },

  loadSchueler() {
    const bsId = document.getElementById('neSchule')?.value;
    const klId = document.getElementById('neKlasse')?.value;
    const jgId = document.getElementById('neJahrgang')?.value;
    const amt = document.getElementById('neAmt')?.value;
    const area = document.getElementById('neSchuelerArea');
    if (!area) return;

    if (!bsId) {
      area.innerHTML = '<div class="card"><div class="empty-state"><p>Bitte zuerst eine Schule auswählen</p></div></div>';
      return;
    }

    // Bewusst OHNE globale Filter: die Nacherfassung hat eigene Filter
    // (Schule/Klasse/Jahrgang/Amt) – der globale Amt-Filter würde sonst genau
    // die mitkontrollierten Azubis fremder Ämter ausblenden.
    let where = 's.aktiv=1';
    const params = [];
    where += ' AND k.berufsschule_id=?'; params.push(bsId);
    if (klId) { where += ' AND s.klasse_id=?'; params.push(klId); }
    if (jgId) { where += ' AND s.jahrgang_id=?'; params.push(jgId); }
    if (amt) { where += ' AND s.zustaendiges_amt=?'; params.push(amt); }

    const schueler = App.query(`SELECT s.*, k.klassenbezeichnung, j.bezeichnung as jahrgang, fr.bezeichnung as fachrichtung,
      b.name as betrieb_name, b.ort as betrieb_ort
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      WHERE ${where}
      ORDER BY s.nachname, s.vorname`, params);

    if (!schueler.length) {
      area.innerHTML = '<div class="card"><div class="empty-state"><p>Keine Schüler für diese Auswahl gefunden</p></div></div>';
      return;
    }

    const eLbl = {
      '': '–', in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung',
      sachberichte_wetter_email: 'E-Mail (Wetter)', berichte_bis_termin_email: 'E-Mail (Berichte)',
      persoenliche_vorlage_rp: 'Vorlage RP', post_an_rp: 'Post ans RP'
    };

    this._rows = schueler;
    const datum = document.getElementById('neTerminDatum')?.value || todayStr();
    this._kwDefault = this._kwVorschlag(datum);

    area.innerHTML = `
    <div class="card">
      <div class="card-header" style="justify-content:space-between">
        <span>2. Ergebnisse erfassen – ${schueler.length} Schüler</span>
        <span id="neProgress" style="font-size:11px;color:var(--clr-sage)">0/${schueler.length} erfasst</span>
      </div>
      <div style="padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px;line-height:1.7;margin-bottom:8px">
        <strong>So wird gespeichert:</strong>
        <strong>Geprüft bis KW</strong> = alle Wochen vom Ausbildungsbeginn bis einschließlich dieser Woche gelten als kontrolliert (auch frühere Ausbildungsjahre) und erscheinen so im KW-Raster; Vorschlag ist die Woche vor dem Durchsichtsdatum – KW-Nummern vor der Durchsichtswoche zählen zum Vorjahr des Rasters.
        <strong>Fehltage gesamt</strong> = Stand laut Berichtsheft, pauschal (nicht wochengenau) – spätere wochengenaue Einträge kommen obendrauf.
        <strong>Codes</strong> werden der zuletzt geprüften KW zugeordnet.
        Es werden nur Zeilen mit einem <strong>Ergebnis</strong> gespeichert.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-secondary" onclick="NacherfassungHandler._alleInOrdnung()" title="Setzt bei allen Zeilen ohne Ergebnis „In Ordnung"">Alle offenen → In Ordnung</button>
        <button class="btn btn-sm btn-secondary" onclick="NacherfassungHandler._kwFuerAlle()" title="Trägt den KW-Vorschlag bei allen Zeilen ein">KW-Vorschlag für alle</button>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="min-width:140px">Name</th>
            <th style="min-width:100px">Betrieb</th>
            <th title="Letzte Kontrolle (Datum + Ergebnis) und bisher geprüfter Stand" style="width:90px">Bisher</th>
            <th title="Bis einschließlich dieser Kalenderwoche gilt das Berichtsheft als geprüft" style="width:70px;text-align:center">Geprüft bis KW</th>
            <th title="Fehltage gesamt laut Berichtsheft (pauschal, nicht wochengenau) – leer = unverändert" style="width:70px;text-align:center">Fehltage gesamt</th>
            <th style="min-width:120px">Ergebnis</th>
            <th title="Wiedervorlage-Frist" style="width:100px">WV-Frist</th>
            <th title="Mängelcodes (kommagetrennt: A,B,C…) – der zuletzt geprüften KW zugeordnet" style="width:80px">Codes</th>
            <th style="min-width:120px">Bemerkung</th>
          </tr></thead>
          <tbody>
            ${schueler.map((s, i) => {
              const lastKE = App.query("SELECT ke.ergebnis, ke.fehltage_gesamt, kt.geplant_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1", [s.id])[0];
              const lastInfo = lastKE ? formatDate(lastKE.geplant_datum).substring(0,6) + (lastKE.ergebnis === 'in_ordnung' ? ' ✓' : ' !') : '–';
              // Bisher geprüfter Stand in SCHULJAHRES-Reihenfolge (36..52, dann 1..35)
              const bisher = App.query(`SELECT ausbildungsjahr, kalenderwoche FROM kw_status WHERE schueler_id=? AND geprueft=1
                ORDER BY ausbildungsjahr DESC, CASE WHEN kalenderwoche >= 36 THEN 0 ELSE 1 END, kalenderwoche DESC LIMIT 1`, [s.id])[0];
              const bisherTxt = bisher ? `bis KW ${bisher.kalenderwoche} (AJ${bisher.ausbildungsjahr})` : 'nichts geprüft';
              const fehlBisher = lastKE ? (lastKE.fehltage_gesamt || 0) : (App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [s.id]) || 0);
              const amp = App.getSchuelerAmpel(s.id);
              const fremd = s.zustaendiges_amt && s.zustaendiges_amt !== App.EIGENES_AMT;
              return `<tr data-sid="${s.id}" class="ne-row">
                <td>
                  <strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)} <span title="${esc(amp.label)}">${amp.icon}</span>
                  ${fremd ? `<span style="font-size:9px;padding:1px 5px;background:var(--clr-blue-light);border-radius:8px;margin-left:4px;font-weight:600" title="Fremdes Amt: ${esc(App.amtLabel(s.zustaendiges_amt))}">§ ${esc(s.zustaendiges_amt)}</span>` : ''}
                  <div style="font-size:10px;color:var(--clr-text-light)">${esc(s.klassenbezeichnung||'')} · ${esc(s.jahrgang||'')}</div>
                </td>
                <td style="font-size:11px">${esc(s.betrieb_name||s.ausbildungsstaette||'–')}<div style="font-size:10px;color:var(--clr-text-light)">${esc(s.betrieb_ort||'')}</div></td>
                <td style="font-size:10px"><div>${lastInfo}</div><div style="color:var(--clr-text-light)">${bisherTxt}</div><div style="color:var(--clr-text-light)">${fehlBisher} Fehltage</div></td>
                <td><input type="number" class="form-control ne-kw" data-idx="${i}" value="${this._kwDefault}" min="1" max="53" placeholder="–" style="font-size:11px;padding:3px 4px;width:56px;text-align:center" title="Bis einschließlich dieser KW geprüft (Vorschlag: Woche vor dem Durchsichtsdatum)"></td>
                <td><input type="number" class="form-control ne-fehl" data-idx="${i}" value="" min="0" max="999" placeholder="${fehlBisher}" style="font-size:11px;padding:3px 4px;width:56px;text-align:center" title="Fehltage gesamt laut Berichtsheft (bisher im Tool: ${fehlBisher}) – leer lassen = unverändert"></td>
                <td>
                  <select class="form-control ne-ergebnis" data-idx="${i}" style="font-size:11px;padding:3px 6px" onchange="NacherfassungHandler._onErgebnis(${i},this.value)">
                    ${Object.entries(eLbl).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
                  </select>
                </td>
                <td><input type="date" class="form-control ne-wv" data-idx="${i}" style="font-size:11px;padding:3px 6px;display:none"></td>
                <td><input class="form-control ne-codes" data-idx="${i}" placeholder="A,B,F…" style="font-size:11px;padding:3px 6px;width:70px;text-transform:uppercase"></td>
                <td><input class="form-control ne-bem" data-idx="${i}" placeholder="optional" style="font-size:11px;padding:3px 6px"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px">
        <button class="btn btn-primary" onclick="NacherfassungHandler.saveAll()" style="font-size:14px;padding:10px 24px">Alle speichern</button>
        <span style="font-size:11px;color:var(--clr-text-light)">Nur Zeilen mit einem Ergebnis (≠ "–") werden gespeichert. Mehrfaches Speichern ergänzt denselben Nacherfassungs-Termin (Schule + Datum).</span>
      </div>
    </div>`;
  },

  _alleInOrdnung() {
    document.querySelectorAll('.ne-ergebnis').forEach(sel => {
      if (!sel.value) { sel.value = 'in_ordnung'; this._onErgebnis(parseInt(sel.dataset.idx, 10), 'in_ordnung'); }
    });
  },
  _kwFuerAlle() {
    const v = this._kwVorschlag(document.getElementById('neTerminDatum')?.value);
    document.querySelectorAll('.ne-kw').forEach(inp => { inp.value = v; });
  },

  _onErgebnis(idx, val) {
    const wvInput = document.querySelector(`.ne-wv[data-idx="${idx}"]`);
    if (wvInput) {
      const needsWV = val && val !== '' && val !== 'in_ordnung';
      wvInput.style.display = needsWV ? '' : 'none';
      if (needsWV && !wvInput.value) {
        // Default: +4 Wochen ab Durchsichtsdatum
        const d = document.getElementById('neTerminDatum')?.value;
        if (d) {
          const dt = new Date(d + 'T00:00:00'); dt.setDate(dt.getDate() + 28);
          wvInput.value = dateStr(dt);
        }
      }
    }
    this._updateProgress();
  },

  _updateProgress() {
    const filled = document.querySelectorAll('.ne-ergebnis');
    let count = 0;
    filled.forEach(sel => { if (sel.value && sel.value !== '') count++; });
    const el = document.getElementById('neProgress');
    if (el) el.textContent = `${count}/${this._rows.length} erfasst`;
  },

  // Nacherfassungs-Termin je Schule + Datum finden oder anlegen
  _terminFuer(datum, bsId, pruefer, klId) {
    const vorhanden = App.query(`SELECT id FROM kontrolltermine WHERE geplant_datum=? AND berufsschule_id=? AND bemerkung LIKE 'Nacherfassung%' ORDER BY id DESC LIMIT 1`, [datum, bsId])[0];
    if (vorhanden) {
      if (klId) App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [vorhanden.id, klId]);
      return vorhanden.id;
    }
    const schule = App.scalar('SELECT name FROM berufsschulen WHERE id=?', [bsId]) || '';
    const titel = `Nacherfassung – ${schule} (Durchsicht vom ${formatDate(datum)})`;
    App.run(`INSERT INTO kontrolltermine (geplant_datum, durchgefuehrt_datum, pruefer, status, typ, bemerkung, berufsschule_id) VALUES (?,?,?,'durchgefuehrt','schulkontrolle',?,?)`,
      [datum, datum, pruefer, titel, bsId]);
    const terminId = App.scalar('SELECT id FROM kontrolltermine WHERE rowid=last_insert_rowid()');
    // NUR eine explizit gewählte Klasse verknüpfen – „alle Klassen der Schule"
    // machte aus 4 nacherfassten Azubis einen Termin mit der ganzen Schule.
    if (klId && terminId) App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [terminId, klId]);
    return terminId;
  },

  // Einen Azubi nacherfassen (DOM-frei, testbar).
  // row: { ergebnis, codes, bemerkung, wvDate, fehltageGesamt (Zahl|null), bisKW (Zahl|0) }
  erfasseAzubi(terminId, s, row, datum, pruefer) {
    // 1) Kontrollergebnis – mit Übernahme aus der letzten abgeschlossenen
    //    Durchsicht (Durchsichtsnummer, Pflichtteile), wie in der Live-Kontrolle
    const prev = App.query(`SELECT ke.* FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.kontrolltermin_id != ? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [s.id, terminId])[0] || {};
    const vorhanden = App.query('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
    if (vorhanden) {
      App.run(`UPDATE kontrollergebnisse SET ergebnis=?, bemerkung=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`,
        [row.ergebnis, row.bemerkung || '', pruefer, vorhanden.id]);
    } else {
      App.run(`INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id, schueler_id, ergebnis, bemerkung, durchsicht_nr, geprueft_kws, fehltage_pauschal,
          p_1_1_ausbildungsplan, p_1_4_auszubildende, p_1_5_bescheinigungen, bescheinigungen_anzahl, f_1_2_vertragliche_regelungen, f_1_6_ausbildungsbetrieb,
          erstellt_am, geaendert_am, geaendert_von)
        VALUES (?,?,?,?,?,'{}',?,?,?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'),?)`,
        [terminId, s.id, row.ergebnis, row.bemerkung || '', (prev.durchsicht_nr || 0) + 1, prev.fehltage_pauschal || 0,
         prev.p_1_1_ausbildungsplan || '', prev.p_1_4_auszubildende || '', prev.p_1_5_bescheinigungen || '', prev.bescheinigungen_anzahl || 0,
         prev.f_1_2_vertragliche_regelungen || '', prev.f_1_6_ausbildungsbetrieb || '', pruefer]);
    }
    const keId = App.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id]);
    if (!keId) throw new Error('Kontrollergebnis konnte nicht angelegt werden');
    // 2) Einzel-Zuordnung zum Termin (Exporte, Schutz vor dem Aufräumen)
    App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [terminId, s.id]);

    // 3) Wiedervorlage
    if (row.ergebnis !== 'in_ordnung' && row.wvDate) {
      const wvDa = App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId]);
      if (!wvDa) App.run("INSERT INTO wiedervorlagen (schueler_id, kontrollergebnis_id, art, frist_datum, status) VALUES (?,?,?,?,'offen')",
        [s.id, keId, row.ergebnis, row.wvDate]);
    }

    // 4) Geprüft bis KW – derselbe Mechanismus wie in der Live-Kontrolle:
    //    persistCodes/trackSessionKW markieren ALLE Wochen bis zur Ziel-KW
    //    (inkl. Kaskade in frühere Ausbildungsjahre) und hängen die Codes an.
    let ziel = null;
    if (row.bisKW) ziel = App.ajKwFuerStichtag(s.id, datum, row.bisKW);
    else if (row.codes) ziel = App.ajKwFuerStichtag(s.id, datum, this._kwVorschlag(datum));
    if (ziel) {
      KWNav.persistCodes(keId, ziel.aj, ziel.kw, row.codes || '', 0, s.id, true);
    }

    // 5) Fehltage gesamt (pauschal): Eingabe = Gesamtstand laut Berichtsheft.
    //    Pauschalanteil so setzen, dass Gesamt = Eingabe (KW-genaue Einträge
    //    bleiben unangetastet und zählen weiter mit).
    if (row.fehltageGesamt != null && !isNaN(row.fehltageGesamt)) {
      const kwSumme = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [s.id]) || 0;
      const pauschal = Math.max(0, Math.min(999, Math.round(row.fehltageGesamt) - kwSumme));
      App.run('UPDATE kontrollergebnisse SET fehltage_pauschal=? WHERE id=?', [pauschal, keId]);
    }
    KontrolleHandler.autoUpdateFehltage(s.id, keId);

    // 6) Archiv-Snapshot wie beim Abschluss einer Live-Kontrolle
    try {
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [keId])[0];
      const kwRows = App.query('SELECT * FROM kw_status WHERE schueler_id=?', [s.id]);
      const pflicht = { p_1_1: ke.p_1_1_ausbildungsplan, p_1_4: ke.p_1_4_auszubildende, p_1_5: ke.p_1_5_bescheinigungen,
        besch_anz: ke.bescheinigungen_anzahl, f_1_2: ke.f_1_2_vertragliche_regelungen, f_1_6: ke.f_1_6_ausbildungsbetrieb };
      const snapDa = App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE kontrollergebnis_id=?', [keId]);
      if (!snapDa) {
        App.run(`INSERT INTO durchsicht_snapshots (kontrollergebnis_id, schueler_id, snapshot_datum, kw_daten_json, geprueft_kws_json, pflichtteile_json, ergebnis, bemerkung, pruefer) VALUES (?,?,?,?,?,?,?,?,?)`,
          [keId, s.id, datum, JSON.stringify(kwRows), ke.geprueft_kws || '{}', JSON.stringify(pflicht), ke.ergebnis || '', ke.bemerkung || '', pruefer]);
      }
    } catch(e) { console.warn('Nacherfassung Snapshot:', e.message); }
    return keId;
  },

  saveAll() {
    const datum = document.getElementById('neTerminDatum')?.value;
    const pruefer = document.getElementById('neTerminPruefer')?.value || '';
    const bsId = parseInt(document.getElementById('neSchule')?.value) || null;
    if (!datum || !bsId) return App.toast('Bitte Datum und Schule angeben', 'warning');

    const toSave = [];
    document.querySelectorAll('.ne-ergebnis').forEach((sel) => {
      if (!sel.value || sel.value === '') return;
      // Index aus dem Datensatz-Attribut, NICHT aus der DOM-Position: nach dem
      // Sortieren der Tabelle stimmen die beiden nicht mehr überein.
      const i = parseInt(sel.dataset.idx, 10);
      const s = this._rows[i];
      if (!s) return;
      const codes = (document.querySelector(`.ne-codes[data-idx="${i}"]`)?.value || '').toUpperCase().replace(/[^A-I,]/g, '');
      const bem = document.querySelector(`.ne-bem[data-idx="${i}"]`)?.value || '';
      const wvDate = document.querySelector(`.ne-wv[data-idx="${i}"]`)?.value || '';
      const fehlRaw = document.querySelector(`.ne-fehl[data-idx="${i}"]`)?.value;
      const fehltageGesamt = fehlRaw === '' || fehlRaw == null ? null : Math.max(0, parseInt(fehlRaw) || 0);
      const bisKW = parseInt(document.querySelector(`.ne-kw[data-idx="${i}"]`)?.value) || 0;
      toSave.push({ s, row: { ergebnis: sel.value, codes, bemerkung: bem, wvDate, fehltageGesamt, bisKW } });
    });
    if (!toSave.length) return App.toast('Nichts zu speichern – bitte Ergebnisse eintragen', 'warning');

    const klId = parseInt(document.getElementById('neKlasse')?.value) || null;
    const terminId = this._terminFuer(datum, bsId, pruefer, klId);
    if (!terminId) return App.toast('Termin konnte nicht angelegt werden', 'error');

    let saved = 0, fehler = 0;
    toSave.forEach(({ s, row }) => {
      try { this.erfasseAzubi(terminId, s, row, datum, pruefer); saved++; }
      catch(rowErr) { fehler++; console.warn('Nacherfassung Zeile:', rowErr.message); }
    });
    App.invalidateTerminCache && App.invalidateTerminCache();
    App.toast(`✓ ${saved} Durchsicht(en) nacherfasst (Termin ${formatDate(datum)})${fehler ? ` · ${fehler} Fehler (Konsole)` : ''}`, fehler ? 'warning' : 'success');
    this.loadSchueler(); // Refresh
    this._updateNichtErfasst();
  },

  _updateNichtErfasst() {
    const body = document.getElementById('neNichtErfasstBody');
    const countEl = document.getElementById('neNichtErfasstCount');
    if (!body) return;

    const gf = App.gf('schueler');
    const nichtErfasst = App.query(`SELECT s.*, j.bezeichnung as jahrgang, fr.bezeichnung as fachrichtung,
      bs.name as schule, k.klassenbezeichnung
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
      WHERE s.aktiv=1 AND s.id NOT IN (SELECT DISTINCT ke.schueler_id FROM kontrollergebnisse ke WHERE ke.ergebnis != '')
      ${gf}
      ORDER BY bs.name, j.bezeichnung, s.nachname`, []);

    if (countEl) countEl.textContent = nichtErfasst.length > 0 ? `(${nichtErfasst.length} Schüler)` : '(alle erfasst ✓)';

    if (!nichtErfasst.length) {
      body.innerHTML = '<div style="padding:12px;text-align:center;color:var(--clr-green)">✓ Alle Schüler wurden mindestens einmal kontrolliert!</div>';
      return;
    }

    // Nach TATSÄCHLICHEM Schulstandort gruppieren (Landesfachklassen)
    const bySchool = {};
    nichtErfasst.forEach(s => {
      let key = s.schule || 'Ohne Schule';
      try { const ak = App.getAktuelleSchule(s); if (ak && ak.schule) key = ak.schule + (ak.isLandesfachklasse ? ' (LFK)' : ''); } catch(e) {}
      if (!bySchool[key]) bySchool[key] = [];
      bySchool[key].push(s);
    });

    body.innerHTML = Object.entries(bySchool).sort((a, b) => a[0].localeCompare(b[0])).map(([school, students]) => `
      <div style="margin:8px 0">
        <div style="font-weight:600;font-size:12px;color:var(--clr-forest);padding:4px 0">${esc(school)} (${students.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${students.map(s => `<span style="font-size:11px;padding:2px 6px;background:var(--clr-amber-light);border-radius:4px" title="${esc(s.fachrichtung||'')} · ${esc(s.jahrgang||'')} · ${App.amtLabel(s.zustaendiges_amt)}">${esc(s.nachname)}, ${esc(s.vorname)}${s.zustaendiges_amt && s.zustaendiges_amt !== App.EIGENES_AMT ? ' <small>§' + esc(s.zustaendiges_amt) + '</small>' : ''}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }
};
