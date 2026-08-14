const NacherfassungHandler = {
  _rows: [],

  loadKlassen() {
    const bsId = document.getElementById('neSchule')?.value;
    const sel = document.getElementById('neKlasse');
    if (!sel) return;
    sel.innerHTML = '<option value="">– alle Klassen –</option>';
    if (!bsId) return;
    const klassen = App.query("SELECT k.*, j.bezeichnung as jg, fr.bezeichnung as fr_name FROM klassen k LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id WHERE k.berufsschule_id=?" + App.gf('klassen') + " ORDER BY k.klassenbezeichnung", [bsId]);
    klassen.forEach(k => {
      sel.insertAdjacentHTML('beforeend', `<option value="${k.id}">${esc(k.klassenbezeichnung)} (${esc(k.jg||'')} – ${esc(k.fr_name||'')})</option>`);
    });
    this.loadSchueler();
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

    let where = (App._extraFilterSql().overrideAktiv ? "1=1" : "s.aktiv=1") + App.gf('schueler');
    const params = [];
    where += " AND k.berufsschule_id=?"; params.push(bsId);
    if (klId) { where += " AND s.klasse_id=?"; params.push(klId); }
    if (jgId) { where += " AND s.jahrgang_id=?"; params.push(jgId); }
    if (amt) { where += " AND s.zustaendiges_amt=?"; params.push(amt); }

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

    area.innerHTML = `
    <div class="card">
      <div class="card-header" style="justify-content:space-between">
        <span>2. Ergebnisse erfassen – ${schueler.length} Schüler</span>
        <span id="neProgress" style="font-size:11px;color:var(--clr-sage)">0/${schueler.length} erfasst</span>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="min-width:140px">Name</th>
            <th style="min-width:100px">Betrieb</th>
            <th title="Fehltage gesamt – editierbar für Nacherfassung" style="width:55px">Fehl.</th>
            <th title="Letzte geprüfte Kalenderwoche – editierbar" style="width:55px">KW</th>
            <th title="Letzte Kontrolle (Datum + Ergebnis)" style="width:70px">Letzte</th>
            <th style="min-width:120px">Ergebnis</th>
            <th title="Wiedervorlage-Frist" style="width:100px">WV-Frist</th>
            <th title="Mängelcodes (kommagetrennt: A,B,C...)" style="width:80px">Codes</th>
            <th style="min-width:120px">Bemerkung</th>
          </tr></thead>
          <tbody>
            ${schueler.map((s, i) => {
              const fehlGesamt = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [s.id]) || 0;
              const lastKE = App.query("SELECT ke.ergebnis, kt.geplant_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1", [s.id]);
              const lastInfo = lastKE.length ? formatDate(lastKE[0].geplant_datum).substring(0,6) + (lastKE[0].ergebnis === 'in_ordnung' ? '✓' : '!') : '–';
              // Letzte geprüfte KW in SCHULJAHRES-Reihenfolge (36..52, dann 1..35):
              // ein einfaches MAX() liefert immer 52 statt der tatsächlich letzten Woche.
              const lastKW = App.scalar(`SELECT kalenderwoche FROM kw_status WHERE schueler_id=? AND geprueft=1
                ORDER BY ausbildungsjahr DESC, CASE WHEN kalenderwoche >= 36 THEN 0 ELSE 1 END, kalenderwoche DESC LIMIT 1`, [s.id]) || '';
              const amp = App.getSchuelerAmpel(s.id);
              return `<tr data-sid="${s.id}" class="ne-row">
                <td>
                  <strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)} <span title="${esc(amp.label)}">${amp.icon}</span>
                  <div style="font-size:10px;color:var(--clr-text-light)">${esc(s.klassenbezeichnung||'')} · ${esc(s.jahrgang||'')}</div>
                </td>
                <td style="font-size:11px">${esc(s.betrieb_name||s.ausbildungsstaette||'–')}<div style="font-size:10px;color:var(--clr-text-light)">${esc(s.betrieb_ort||'')}</div></td>
                <td><input type="number" class="form-control ne-fehl" data-idx="${i}" value="" min="0" max="7" placeholder="0" style="font-size:11px;padding:3px 4px;width:48px;text-align:center" title="Fehltage in der erfassten KW (bisher gesamt: ${fehlGesamt})"></td>
                <td><input type="number" class="form-control ne-kw" data-idx="${i}" value="${lastKW}" min="1" max="52" placeholder="–" style="font-size:11px;padding:3px 4px;width:48px;text-align:center" title="Letzte geprüfte KW"></td>
                <td style="font-size:10px;text-align:center">${lastInfo}</td>
                <td>
                  <select class="form-control ne-ergebnis" data-idx="${i}" style="font-size:11px;padding:3px 6px" onchange="NacherfassungHandler._onErgebnis(${i},this.value)">
                    ${Object.entries(eLbl).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
                  </select>
                </td>
                <td><input type="date" class="form-control ne-wv" data-idx="${i}" style="font-size:11px;padding:3px 6px;display:none"></td>
                <td><input class="form-control ne-codes" data-idx="${i}" placeholder="A,B,F..." style="font-size:11px;padding:3px 6px;width:70px;text-transform:uppercase"></td>
                <td><input class="form-control ne-bem" data-idx="${i}" placeholder="optional" style="font-size:11px;padding:3px 6px"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px">
        <button class="btn btn-primary" onclick="NacherfassungHandler.saveAll()" style="font-size:14px;padding:10px 24px">Alle speichern</button>
        <span style="font-size:11px;color:var(--clr-text-light)">Nur Zeilen mit einem Ergebnis (≠ "–") werden gespeichert.</span>
      </div>
    </div>`;
  },

  _onErgebnis(idx, val) {
    const wvInput = document.querySelector(`.ne-wv[data-idx="${idx}"]`);
    if (wvInput) {
      const needsWV = val && val !== '' && val !== 'in_ordnung';
      wvInput.style.display = needsWV ? '' : 'none';
      if (needsWV && !wvInput.value) {
        // Default: +4 weeks from Datum
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

  saveAll() {
    const datum = document.getElementById('neTerminDatum')?.value;
    const pruefer = document.getElementById('neTerminPruefer')?.value || '';
    const bsId = document.getElementById('neSchule')?.value;
    if (!datum || !bsId) return App.toast('Bitte Datum und Schule angeben', 'warning');

    // Collect rows with data
    const toSave = [];
    document.querySelectorAll('.ne-ergebnis').forEach((sel) => {
      if (!sel.value || sel.value === '') return;
      // Index aus dem Datensatz-Attribut, NICHT aus der DOM-Position: nach dem
      // Sortieren der Tabelle stimmen die beiden nicht mehr überein und das
      // Ergebnis würde einem anderen Azubi zugeschrieben.
      const i = parseInt(sel.dataset.idx, 10);
      const s = this._rows[i];
      if (!s) return;
      const codes = (document.querySelector(`.ne-codes[data-idx="${i}"]`)?.value || '').toUpperCase().replace(/\s+/g, '');
      const bem = document.querySelector(`.ne-bem[data-idx="${i}"]`)?.value || '';
      const wvDate = document.querySelector(`.ne-wv[data-idx="${i}"]`)?.value || '';
      const fehl = Math.max(0, Math.min(7, parseInt(document.querySelector(`.ne-fehl[data-idx="${i}"]`)?.value) || 0));
      const kw = parseInt(document.querySelector(`.ne-kw[data-idx="${i}"]`)?.value) || 0;
      toSave.push({ schueler: s, ergebnis: sel.value, codes, bemerkung: bem, wvDate, fehltage: fehl, lastKW: kw });
    });

    if (!toSave.length) return App.toast('Nichts zu speichern – bitte Ergebnisse eintragen', 'warning');

    // Create Kontrolltermin
    const klId = document.getElementById('neKlasse')?.value;
    const klasseIds = klId ? [parseInt(klId)] : App.query("SELECT DISTINCT k.id FROM klassen k WHERE k.berufsschule_id=?", [bsId]).map(r => r.id);

    // typ 'einsendung' — 'nacherfassung' würde den CHECK-Constraint verletzen (SCHEMA erlaubt nur schulkontrolle/einsendung)
    App.run("INSERT INTO kontrolltermine (geplant_datum, pruefer, status, typ, bemerkung) VALUES (?,?,'durchgefuehrt','einsendung','Nacherfasst am ' || date('now'))",
      [datum, pruefer]);
    const terminId = App.scalar("SELECT last_insert_rowid()");
    klasseIds.forEach(kId => {
      App.run("INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)", [terminId, kId]);
    });

    // Save results
    let saved = 0;
    toSave.forEach(row => {
     try {
      const s = row.schueler;
      // Kontrollergebnis (with fehltage)
      App.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id, schueler_id, ergebnis, bemerkung, fehltage_gesamt, erstellt_am, geaendert_von) VALUES (?,?,?,?,?,datetime('now'),?)",
        [terminId, s.id, row.ergebnis, row.bemerkung, row.fehltage || 0, pruefer]);
      // Gezielt nachladen statt last_insert_rowid(): Wurde der INSERT wegen
      // OR IGNORE übersprungen (Schüler doppelt in der Liste, zweiter Klick auf
      // "Alle speichern"), zeigte die Nummer auf einen fremden Datensatz.
      const keId = App.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id]);

      // Wiedervorlage (Tabelle hat KEINE kontrolltermin_id-Spalte!)
      if (row.ergebnis !== 'in_ordnung' && row.wvDate) {
        App.run("INSERT INTO wiedervorlagen (schueler_id, kontrollergebnis_id, art, frist_datum, status) VALUES (?,?,?,?,'offen')",
          [s.id, keId, row.ergebnis, row.wvDate]);
      }

      // KW-Status: Upsert der behobene_codes/bemerkung NICHT zerstört (kein REPLACE!)
      const upsertKw = (kw, codes, fehl) => {
        const ex = App.query('SELECT id FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, kw]);
        if (ex.length) {
          App.run('UPDATE kw_status SET maengel_codes=?, fehltage=?, geprueft=1, erstellt_bei=COALESCE(erstellt_bei,?) WHERE id=?',
            [codes, fehl, keId, ex[0].id]);
        } else {
          // ON CONFLICT: die lokale Vorabprüfung sichert nur DIESEN Client ab –
          // beim Replay-Empfänger kann die KW bereits existieren (parallel live
          // geprüft), dann darf die Op nicht still am UNIQUE scheitern
          App.run(`INSERT INTO kw_status (schueler_id, ausbildungsjahr, kalenderwoche, maengel_codes, geprueft, fehltage, erstellt_bei) VALUES (?,?,?,?,1,?,?)
            ON CONFLICT(schueler_id, ausbildungsjahr, kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1, erstellt_bei=COALESCE(kw_status.erstellt_bei, excluded.erstellt_bei)`,
            [s.id, aj, kw, codes, fehl, keId]);
        }
      };
      // Aktuelles Ausbildungsjahr, nicht das letzte: sonst landen nacherfasste
      // Mängel eines Erstjahres-Azubis im Raster des 3. Ausbildungsjahres.
      const ajListe = App.getSchuelerAJs(s.id) || [1];
      const ajAktuell = App.getCurrentAJ(s.ausbildungsbeginn, s.id);
      const aj = (ajAktuell && ajListe.includes(ajAktuell)) ? ajAktuell : (ajListe[ajListe.length - 1] || 1);
      const kw = row.lastKW || 0;
      if (kw > 0) {
        upsertKw(kw, row.codes || '', row.fehltage || 0);
      } else if (row.codes) {
        const roughKw = parseInt(document.getElementById('neTerminDatum').value.substring(5,7)) <= 6 ? 1 : 36;
        upsertKw(roughKw, row.codes, 0);
      }
      saved++;
     } catch(rowErr) {
      console.warn('Nacherfassung Zeile:', rowErr.message);
     }
    });

    App.toast(`✓ ${saved} Kontrollergebnisse nacherfasst (Termin ${formatDate(datum)})`, 'success');
    this.loadSchueler(); // Refresh
    this._updateNichtErfasst();
  },

  _updateNichtErfasst() {
    const body = document.getElementById('neNichtErfasstBody');
    const countEl = document.getElementById('neNichtErfasstCount');
    if (!body) return;

    const gf = App.gf('schueler');
    const nichtErfasst = App.query(`SELECT s.nachname, s.vorname, s.id, j.bezeichnung as jahrgang, fr.bezeichnung as fachrichtung,
      bs.name as schule, k.klassenbezeichnung, s.zustaendiges_amt
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

    // Group by school
    const bySchool = {};
    nichtErfasst.forEach(s => {
      const key = s.schule || 'Ohne Schule';
      if (!bySchool[key]) bySchool[key] = [];
      bySchool[key].push(s);
    });

    body.innerHTML = Object.entries(bySchool).map(([school, students]) => `
      <div style="margin:8px 0">
        <div style="font-weight:600;font-size:12px;color:var(--clr-forest);padding:4px 0">${esc(school)} (${students.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${students.map(s => `<span style="font-size:11px;padding:2px 6px;background:var(--clr-amber-light);border-radius:4px" title="${esc(s.fachrichtung||'')} · ${esc(s.jahrgang||'')} · ${App.amtLabel(s.zustaendiges_amt)}">${esc(s.nachname)}, ${esc(s.vorname)}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }
};
