// File validation helper
function _validateFile(file, opts = {}) {
  const maxSize = opts.maxSize || 50 * 1024 * 1024;
  if (file.size > maxSize) {
    App.toast(`Datei zu groß (${(file.size/1024/1024).toFixed(1)} MB, max ${(maxSize/1024/1024).toFixed(0)} MB)`, 'error');
    return false;
  }
  if (opts.extensions) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!opts.extensions.includes(ext)) {
      App.toast(`Dateityp .${ext} nicht unterstützt`, 'error');
      return false;
    }
  }
  return true;
}

const ImportHandler = {
  // ── Copy & Paste Import: Tab-separierte Daten aus Zwischenablage ──
  handlePaste(textareaId, mode) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const raw = ta.value.trim();
    if (!raw) return App.toast('Bitte zuerst Daten einfügen (Ctrl+V)', 'warning');

    // Parse: Zeilen splitten, dann Tab oder Semikolon als Trennzeichen erkennen
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return App.toast('Mindestens 2 Zeilen nötig (Kopfzeile + Daten)', 'error');

    // Trennzeichen erkennen: Tab > Semikolon > Komma
    const firstLine = lines[0];
    let sep = '\t';
    if (firstLine.split('\t').length < 2) {
      sep = firstLine.split(';').length >= firstLine.split(',').length ? ';' : ',';
    }

    const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, '').replace(/^\uFEFF/, ''));
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''));
      if (vals.every(v => !v)) continue; // Leere Zeile
      const row = {};
      headers.forEach((h, j) => { row[h] = vals[j] || ''; });
      data.push(row);
    }

    if (!data.length) return App.toast('Keine Daten erkannt', 'error');
    App.toast(`${data.length} Zeilen aus Zwischenablage erkannt (${headers.length} Spalten)`, 'success');

    if (mode === 'lfk') {
      this.showLFKMapping(data, headers);
    } else {
      this.showMapping(data, headers, 'Zwischenablage');
    }
  },

  handleFile(file) {
    if (!file) return;
    if (!_validateFile(file, { extensions: ['csv','txt','xlsx','xls'], maxSize: 50*1024*1024 })) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // ── XLSX/XLS via SheetJS ──
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
          if (!data.length) return App.toast('Excel-Datei ist leer', 'error');
          // Get field names from first row keys
          const fields = Object.keys(data[0]).map(f => f.replace(/^\uFEFF/, ''));
          App.toast(`${data.length} Zeilen aus "${file.name}" (Blatt: ${sheetName})`, 'success');
          this.showMapping(data, fields, file.name);
        } catch (err) {
          console.warn('Excel:', err); App.toast('Excel-Datei konnte nicht gelesen werden', 'error');
          console.error(err);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // ── CSV/TXT via PapaParse ──
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimitersToGuess: [';', ',', '\t', '|'],
        complete: (results) => {
          if (!results.data.length) return App.toast('CSV ist leer', 'error');
          if (results.meta.fields?.length) {
            results.meta.fields[0] = results.meta.fields[0].replace(/^\uFEFF/, '');
          }
          App.toast(`${results.data.length} Zeilen erkannt (Trennzeichen: "${results.meta.delimiter}")`, 'success');
          this.showMapping(results.data, results.meta.fields, file.name);
        },
        error: (err) => { console.warn('CSV:', err); App.toast('CSV-Datei konnte nicht gelesen werden', 'error'); }
      });
    }
  },

  showMapping(data, fields, quelle) {
    this._importQuelle = quelle || '';
    // Field mapping: internal key → [Label, [IBYKUS column patterns]]
    const fieldDefs = {
      nachname:          ['Nachname *',         ['name','nachname','familienname']],
      vorname:           ['Vorname *',           ['vorname','vname']],
      ausbildungsstaette:['Betrieb (Name) *',    ['betriebsname','betrieb','firma']],
      zusatzbezeichnung: ['Betrieb (Firma)',      ['zusatzbezeichnung','zusatz','firmenname']],
      beruf_code:        ['Beruf (Code) *',      ['beruf','berufscode','fachrichtung']],
      ausbildungsbeginn: ['Ausbildungsbeginn',   ['av-beginn','avbeginn','ausbildungsbeginn','beginn','vertragsbeginn']],
      ausbildungsende:   ['Ausbildungsende',     ['av-ende','avende','ausbildungsende','ende']],
      telefon:           ['Telefon',             ['telefon','tel','phone','mobiltelefon','mobil','handy']],
      email:             ['E-Mail',              ['email','e-mail','mail','emailadresse']],
      ibykus_id:         ['BAV-Ident (ID)',      ['bav-ident','bavident','ibykus','ibykus-id','identnr','bav_ident']],
      pruefungstermin:   ['Abschlussprüfung *',  ['abschlussprüfung','abschlusspruefung','prüfungstermin','pruefung','ap-termin','abschluss']],
      berufsschule:      ['Klassebeschreibung (=Schule) *', ['klassebeschreibung','schulklasse','berufsschule','schule','schulname']],
      betrieb_ort:       ['Betrieb-Ort',         ['betrieb-ort','betriebsort']],
      betrieb_strasse:   ['Betrieb-Straße',      ['betrieb-straße','betrieb-strasse','betriebsstrasse']],
      betrieb_plz:       ['Betrieb-PLZ',         ['betrieb-plz','betriebsplz']],
      betrieb_tel:       ['Betrieb-Tel.',        ['betrieb-tel.','betrieb-tel','betriebstel','telefon betrieb']],
      betrieb_fax:       ['Betrieb-Fax',         ['betrieb-fax','betriebsfax']],
      betrieb_email:     ['Betrieb-E-Mail',      ['betrieb-e-mail','betrieb-email','betriebsemail']],
      betriebsnummer:    ['Betriebsnummer',      ['betriebsnummer','betriebsnr','betriebs-nr']],
      betrieb_vorname:   ['Betriebsvorname (AP)',['betriebsvorname','betriebvorname']],
      zustaendiges_amt:  ['Zuständiges Amt',     ['zuständiges amt','zustaendiges amt','zuständiges_amt','amt','zustaendig']],
      geschlecht:        ['Geschlecht',          ['geschlecht','sex','gender','m/w','m/w/d']],
      schulabschluss:    ['Schulabschluss',      ['schulabschluss','schulabschluß','school']],
      pruefungserfolg:   ['Prüfungserfolg',      ['prüfungserfolg','pruefungserfolg']],
      pruefungserfolg_wdh1: ['Prüfungserfolg WDH1', ['prüfungserfolg wdh1','pruefungserfolg_wdh1','wdh1']],
      pruefungserfolg_wdh2: ['Prüfungserfolg WDH2', ['prüfungserfolg wdh2','pruefungserfolg_wdh2','wdh2']],
      bav_status:         ['BAV-Status',           ['bav-status','bavstatus','bav_status','vertragsstatus']],
      zwischenpruefung:   ['Zwischenprüfung',      ['zwischenprüfung','zwischenpruefung','zwischenpr']],
    };
    const fieldKeys = Object.keys(fieldDefs);

    // Jede CSV-Spalte darf nur EINEM Feld zugeordnet werden. Ohne diese Sperre
    // beanspruchte z.B. eine Spalte "Nr" gleichzeitig Betriebsnummer und
    // BAV-Ident – jeder Azubi bekam dann einen eigenen Betrieb.
    const vergeben = new Set();
    function bestMatch(fieldKey, columns) {
      const patterns = fieldDefs[fieldKey]?.[1] || [];
      const frei = columns.filter(c => !vergeben.has(c));
      // Runde 1: exakter Treffer
      for (const col of frei) { const cl = col.toLowerCase().trim(); if (patterns.includes(cl)) { vergeben.add(col); return col; } }
      // Runde 2: Spaltenname enthält das Muster (Mindestlänge 4, damit kurze
      // Kürzel wie "nr" nicht wahllos greifen). Die Rückrichtung
      // (Muster enthält Spaltenname) entfällt – sie erzeugte Fehlzuordnungen
      // wie Azubi-Nachname -> Ausbildungsstätte.
      for (const col of frei) {
        const cl = col.toLowerCase().trim();
        for (const p of patterns) { if (p.length >= 4 && cl.includes(p)) { vergeben.add(col); return col; } }
      }
      return '';
    }

    // Zuordnung einmal vorab berechnen (bestMatch ist durch die Sperre
    // zustandsbehaftet und darf pro Feld nur einmal laufen)
    const autoMap = {};
    fieldKeys.forEach(f => { autoMap[f] = bestMatch(f, fields); });
    const matchCount = fieldKeys.filter(f => autoMap[f]).length;

    // ── Datumsformat über ALLE Datumsspalten erkennen ──
    // Der echte IBYKUS-Export kommt teils durch Excel gedreht ("9/1/07",
    // US-Reihenfolge, zweistelliges Jahr). Ein einzelner Wert ist mehrdeutig,
    // die ganze Spalte fast nie: irgendwo steht ein Tag > 12.
    const datumsSpalten = ['ausbildungsbeginn', 'ausbildungsende', 'geburtsdatum', 'pruefungstermin']
      .map(f => autoMap[f]).filter(Boolean);
    const datumsWerte = [];
    data.forEach(row => datumsSpalten.forEach(c => { if (row[c]) datumsWerte.push(row[c]); }));
    const erkannteFolge = this._datumsfolgeErkennen(datumsWerte);
    this._datumsFormat = erkannteFolge || 'TMJ';
    const datumsBeispiele = [...new Set(datumsWerte.map(w => String(w).trim()).filter(Boolean))].slice(0, 4);
    const folgeText = erkannteFolge === 'MTJ' ? 'Monat/Tag/Jahr (US/Excel)'
      : erkannteFolge === 'TMJ' ? 'Tag.Monat.Jahr (deutsch)' : null;

    const preview = document.getElementById('importPreview');
    preview.innerHTML = `
      <div style="margin-top:16px">
        <h4 style="font-family:var(--font-display);margin-bottom:4px">${data.length} Datensätze erkannt – Spalten zuordnen:</h4>
        <p style="font-size:12px;margin-bottom:12px;color:${matchCount >= 8 ? 'var(--clr-green)' : 'var(--clr-amber)'}">
          <strong>${matchCount} von ${fieldKeys.length}</strong> Spalten automatisch erkannt
          ${matchCount >= fieldKeys.length ? ' – alle Felder zugeordnet ✓' : ' – bitte restliche prüfen'}
        </p>
        ${datumsWerte.length ? `<div class="card" style="margin-bottom:12px;padding:10px 14px;${folgeText ? '' : 'background:#fff3cd;border-color:#ffc107'}">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <strong style="font-size:13px">Datumsformat:</strong>
            <select class="form-control" id="map_datumsformat" style="width:auto;font-size:12px;padding:4px 8px" onchange="ImportHandler._datumsFormat=this.value">
              <option value="TMJ" ${this._datumsFormat === 'TMJ' ? 'selected' : ''}>Tag.Monat.Jahr (deutsch, z.B. 01.09.2024)</option>
              <option value="MTJ" ${this._datumsFormat === 'MTJ' ? 'selected' : ''}>Monat/Tag/Jahr (US/Excel, z.B. 9/1/07)</option>
            </select>
            <span style="font-size:11px;color:var(--clr-text-light)">Beispiele aus der Datei: ${datumsBeispiele.map(b => `<code>${esc(b)}</code>`).join(' · ')}</span>
          </div>
          <div style="font-size:11px;margin-top:6px;color:${folgeText ? 'var(--clr-green)' : 'var(--clr-amber)'}">
            ${folgeText
              ? `✓ Automatisch erkannt: ${folgeText} – bei Bedarf oben ändern.`
              : `⚠︎ Reihenfolge nicht eindeutig erkennbar (kein Tageswert über 12 gefunden). Bitte anhand der Beispiele prüfen! Falsche Wahl vertauscht Tag und Monat.`}
          </div>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${fieldKeys.map(f => {
            const matched = autoMap[f];
            const label = fieldDefs[f][0];
            return `<div class="form-group" style="margin:0">
              <label>${label} ${matched ? '✓' : ''}</label>
              <select class="form-control" id="map_${f}" ${matched ? 'style="border-color:var(--clr-green);background:var(--clr-green-light)"' : ''}>
                <option value="">– nicht zuordnen –</option>
                ${fields.map(col => `<option value="${col}" ${col === matched ? 'selected' : ''}>${col}</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>
        <div class="card" style="margin-bottom:12px;padding:12px 16px;background:var(--clr-leaf-light);border-color:var(--clr-sage-light)">
          <strong style="font-size:13px;color:var(--clr-forest-dark)">⚙︎ Vollautomatische Zuordnung:</strong>
          <ul style="font-size:12px;color:var(--clr-text);margin:6px 0 0 16px;line-height:1.8">
            <li><strong>Beruf-Code</strong> (31–37 Gärtner, 171–177 Fachwerker) → Fachrichtung</li>
            <li><strong>Abschlussprüfung</strong> ("S2028", "W2027") → Abschlussjahrgang</li>
            <li><strong>Klassebeschreibung</strong> → Berufsschule automatisch anlegen</li>
            <li><strong>AV-beginn</strong> → Lehrjahr berechnen (1/2/3)</li>
            <li><strong>Klasse</strong> = Schule + Jahrgang + Fachrichtung + Lehrjahr → automatisch erstellt</li>
            <li><strong>Betriebsname + Zusatzbezeichnung</strong> → kombiniert als Ausbildungsstätte</li>
          </ul>
        </div>
        <div style="overflow:auto;max-height:200px;border:1px solid var(--clr-sand);border-radius:var(--radius);margin-bottom:8px">
          <table class="data-table"><thead><tr><th style="font-size:10px;color:var(--clr-text-light)">Roh-Daten (erste ${Math.min(5,data.length)} Zeilen)</th>${fields.slice(0,12).map(f => `<th style="font-size:10px">${esc(f)}</th>`).join('')}</tr></thead><tbody>
            ${data.slice(0,5).map((row,i) => `<tr><td style="font-size:10px;color:var(--clr-text-light)">${i+1}</td>${fields.slice(0,12).map(f => `<td style="font-size:11px">${esc((row[f]||'').substring(0,25))}</td>`).join('')}</tr>`).join('')}
          </tbody></table>
          ${data.length > 5 ? `<p style="padding:4px 8px;font-size:11px;color:var(--clr-text-light)">… und ${data.length - 5} weitere Zeilen</p>` : ''}
        </div>
        <details style="margin-bottom:12px" onmouseover="if(!this._loaded){this._loaded=true;ImportHandler._renderMappedPreview()}">
          <summary style="cursor:pointer;font-size:12px;color:var(--clr-forest);font-weight:600;padding:4px 0">Vorschau: So werden die Daten interpretiert (erste 3)</summary>
          <div id="mappedPreview" style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px;margin-top:4px;max-height:200px;overflow-y:auto">
            <em style="color:var(--clr-text-light)">Aufklappen um Vorschau zu laden…</em>
          </div>
        </details>
        <button class="btn btn-primary" onclick="ImportHandler.doImport(window._importData)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${data.length} Schüler importieren (vollautomatisch)
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('importPreview').innerHTML=''">Abbrechen</button>
      </div>`;
    window._importData = data;
  },

  _renderMappedPreview() {
    try {
      const gm = f => document.getElementById('map_'+f)?.value||'';
      const data = window._importData;
      if (!data) return;
      let h = '<table class="data-table"><thead><tr><th>Name</th><th>Betrieb</th><th>Beruf-Code</th><th>Schule</th><th>AV-Beginn</th><th>AV-Ende</th><th>BAV-Status</th></tr></thead><tbody>';
      data.slice(0,3).forEach(r => {
        const bavRaw = (r[gm('bav_status')]||'').trim().toUpperCase();
        const bavColor = bavRaw === 'ENDE' ? 'var(--clr-red)' : 'var(--clr-green)';
        h += '<tr><td><strong>'+(r[gm('nachname')]||'?')+'</strong>, '+(r[gm('vorname')]||'?')+'</td>';
        h += '<td>'+(r[gm('ausbildungsstaette')]||'–')+'</td>';
        h += '<td>'+(r[gm('beruf_code')]||'–')+'</td>';
        h += '<td>'+(r[gm('berufsschule')]||'–')+'</td>';
        h += '<td>'+(r[gm('ausbildungsbeginn')]||'–')+'</td>';
        h += '<td>'+(r[gm('ausbildungsende')]||'–')+'</td>';
        h += '<td style="color:'+bavColor+';font-weight:600">'+(bavRaw||'–')+'</td></tr>';
      });
      h += '</tbody></table>';
      document.getElementById('mappedPreview').innerHTML = h;
    } catch(e) { console.warn('Preview:', e); }
  },

  // ── Import-Historie: Anzeige ──
  historieHtml(limit = 12) {
    let rows = [];
    try { rows = App.query('SELECT * FROM import_historie ORDER BY zeitpunkt DESC, id DESC LIMIT ?', [limit]); } catch(e) {}
    if (!rows.length) return '';
    const typLabel = { azubis: 'Azubis', lfk: 'LFK', ausbilder: 'Ausbilder' };
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-header">Import-Historie</div>
      <div style="overflow-x:auto"><table class="data-table" style="font-size:12px"><thead><tr>
        <th>Zeitpunkt</th><th>Typ</th><th>Datei</th><th>Bearbeiter</th><th style="text-align:right">Zeilen</th><th style="text-align:right">Neu</th><th style="text-align:right">Aktualisiert</th><th style="text-align:right">Übersprungen</th><th style="text-align:right">Probleme</th><th></th>
      </tr></thead><tbody>
        ${rows.map(h => {
          const probleme = (h.fehler || 0) + (h.datums_fehler || 0);
          return `<tr>
            <td style="white-space:nowrap">${esc((h.zeitpunkt || '').substring(0, 16))}</td>
            <td>${esc(typLabel[h.typ] || h.typ)}</td>
            <td title="${esc(h.datei)}">${esc((h.datei || '–').substring(0, 28))}</td>
            <td>${esc(h.bearbeiter || '–')}</td>
            <td style="text-align:right">${h.zeilen}</td>
            <td style="text-align:right"><strong>${h.neu}</strong></td>
            <td style="text-align:right">${h.aktualisiert}</td>
            <td style="text-align:right">${h.uebersprungen}</td>
            <td style="text-align:right">${probleme ? `<span class="badge-status ${h.fehler ? 'badge-overdue' : 'badge-open'}">${probleme}</span>` : '<span style="color:var(--clr-green)">0</span>'}</td>
            <td>${probleme ? `<button class="btn btn-sm btn-secondary" style="font-size:10px;padding:2px 8px" onclick="ImportHandler.zeigeImportDetails(${h.id})">Details</button>` : ''}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
    </div>`;
  },
  zeigeImportDetails(id) {
    const h = App.query('SELECT * FROM import_historie WHERE id=?', [id])[0];
    if (!h) return;
    let details = [];
    try { details = JSON.parse(h.details_json || '[]'); } catch(e) {}
    const datum = details.filter(d => d.art === 'datum');
    const fehler = details.filter(d => d.art !== 'datum');
    App.openModal(`Import vom ${esc((h.zeitpunkt || '').substring(0, 16))}`, `
      <div style="font-size:13px;line-height:1.9">
        <div><strong>${esc(h.datei || 'Unbekannte Quelle')}</strong> · ${esc(h.bearbeiter || '–')} · Format: ${h.datumsformat === 'MTJ' ? 'Monat/Tag/Jahr (US)' : 'Tag.Monat.Jahr'}</div>
        <div>${h.zeilen} Zeilen · ${h.neu} neu · ${h.aktualisiert} aktualisiert · ${h.uebersprungen} übersprungen</div>
      </div>
      ${datum.length ? `<div style="margin-top:10px;padding:8px 12px;background:#fff3cd;border-radius:var(--radius);font-size:12px">
        <strong>Unlesbare Datumswerte (${h.datums_fehler}):</strong>
        <div style="max-height:160px;overflow-y:auto;margin-top:4px">${datum.map(e => `<div>Zeile ${e.zeile}: ${esc(e.name || '')} – ${esc(e.fehler)}</div>`).join('')}</div>
        ${h.datums_fehler > datum.length ? `<div style="color:var(--clr-text-light)">…${h.datums_fehler - datum.length} weitere nicht protokolliert</div>` : ''}
      </div>` : ''}
      ${fehler.length ? `<div style="margin-top:10px;padding:8px 12px;background:#ffeef0;border-radius:var(--radius);font-size:12px">
        <strong>Übersprungene Zeilen (${h.fehler}):</strong>
        <div style="max-height:160px;overflow-y:auto;margin-top:4px">${fehler.map(e => `<div>${e.zeile ? 'Zeile ' + e.zeile + ': ' : ''}${esc(e.name || '')} – <span style="color:var(--clr-red)">${esc(e.fehler)}</span></div>`).join('')}</div>
        ${h.fehler > fehler.length ? `<div style="color:var(--clr-text-light)">…${h.fehler - fehler.length} weitere nicht protokolliert</div>` : ''}
      </div>` : ''}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        ${details.length ? `<button class="btn btn-primary" onclick="ImportHandler.exportImportFehler(${h.id})">Fehlerliste als Excel</button>` : ''}`);
  },
  exportImportFehler(id) {
    if (typeof XLSX === 'undefined') return App.toast('Excel-Bibliothek nicht geladen', 'error');
    const h = App.query('SELECT * FROM import_historie WHERE id=?', [id])[0];
    if (!h) return;
    let details = [];
    try { details = JSON.parse(h.details_json || '[]'); } catch(e) {}
    if (!details.length) return App.toast('Keine Details protokolliert', 'info');
    const ws = XLSX.utils.json_to_sheet(details.map(d => ({
      Zeile: d.zeile || '', Name: d.name || '', Art: d.art === 'datum' ? 'Datum unlesbar' : 'Übersprungen', Problem: d.fehler || '',
    })));
    ws['!cols'] = [{ wch: 7 }, { wch: 28 }, { wch: 15 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Importfehler');
    XLSX.writeFile(wb, `Importfehler_${(h.zeitpunkt || '').substring(0, 10)}.xlsx`);
  },

  // ── Import-Historie: jeder Lauf wird dauerhaft protokolliert ──
  _logImportHistorie(eintrag) {
    try {
      const details = JSON.stringify((eintrag.details || []).slice(0, 200));
      App.run(`INSERT INTO import_historie (zeitpunkt, typ, datei, bearbeiter, zeilen, neu, aktualisiert, uebersprungen, fehler, datums_fehler, datumsformat, details_json)
               VALUES (datetime('now','localtime'),?,?,?,?,?,?,?,?,?,?,?)`,
        [eintrag.typ || 'azubis', eintrag.datei || this._importQuelle || '',
         (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '',
         eintrag.zeilen || 0, eintrag.neu || 0, eintrag.aktualisiert || 0,
         eintrag.uebersprungen || 0, eintrag.fehler || 0, eintrag.datumsFehler || 0,
         eintrag.datumsformat || this._datumsFormat || '', details]);
      // Bestand begrenzen (die letzten 100 Läufe reichen)
      App.run(`DELETE FROM import_historie WHERE id NOT IN (SELECT id FROM import_historie ORDER BY zeitpunkt DESC, id DESC LIMIT 100)`);
    } catch(e) { console.warn('Import-Historie:', e.message); }
  },

  // ── Datumsparser für alle real vorkommenden Export-Formate ──
  //   TT.MM.JJJJ · JJJJ-MM-TT · T/M/JJ(JJ) · T.M.JJ · M/T/JJ (Excel-US)
  // Bei Schrägstrich/zweistelligem Jahr ist die Reihenfolge mehrdeutig
  // ("9/1/07") – sie kommt aus der Spaltenanalyse bzw. der Auswahl im Dialog.
  _datumsFormat: 'TMJ',
  _jahr4(j) { return j >= 100 ? j : (j <= 49 ? 2000 + j : 1900 + j); },
  _parseD(t, fmtOverride) {
    if (!t) return null;
    const fmt = fmtOverride || this._datumsFormat || 'TMJ';
    const bau = (j, mo, tg) => {
      const d = new Date(j, mo - 1, tg);
      if (d.getFullYear() !== j || d.getMonth() !== mo - 1 || d.getDate() !== tg) return null;
      return d;
    };
    const str = String(t).trim();
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return bau(+m[1], +m[2], +m[3]);
    m = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    const jahr = this._jahr4(+m[3]);
    if (a > 12 && b <= 12) return bau(jahr, b, a);       // a muss der Tag sein
    if (b > 12 && a <= 12) return bau(jahr, a, b);       // b muss der Tag sein
    return fmt === 'MTJ' ? bau(jahr, a, b) : bau(jahr, b, a);
  },
  // Reihenfolge aus einer ganzen Spalte ableiten: Werte mit einer Zahl > 12
  // verraten die Position des Tages. Rückgabe: 'TMJ' | 'MTJ' | null (unklar).
  _datumsfolgeErkennen(werte) {
    let tagVorn = 0, tagHinten = 0;
    for (const w of werte) {
      const m = String(w || '').trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) tagVorn++;
      else if (b > 12 && a <= 12) tagHinten++;
    }
    if (tagVorn && !tagHinten) return 'TMJ';
    if (tagHinten && !tagVorn) return 'MTJ';
    if (tagVorn > tagHinten * 10) return 'TMJ';
    if (tagHinten > tagVorn * 10) return 'MTJ';
    return null;
  },

  async doImport(data) {
    if (!data || !data.length) return App.toast('Keine Daten zum Importieren', 'warning');

    // Validierung: Pflichtfelder müssen zugeordnet sein
    const getMap = f => document.getElementById('map_' + f)?.value || '';
    const nachCol = getMap('nachname');
    const vorCol = getMap('vorname');
    if (!nachCol || !vorCol) {
      return App.toast('Pflichtfelder "Nachname" und "Vorname" müssen zugeordnet sein!', 'error');
    }
    const firstRow = data[0];
    if (firstRow && (firstRow[nachCol] === undefined || firstRow[vorCol] === undefined)) {
      return App.toast(`Spalte "${nachCol}" oder "${vorCol}" existiert nicht in den Daten. Bitte Zuordnung prüfen.`, 'error');
    }

    App.showLoading('Importiere Schülerdaten…');
    const savedAutoSaveTimer = App.autoSaveTimer;
    App._bulkImport = true;
    if (App.autoSaveTimer) clearTimeout(App.autoSaveTimer);
   try { // Sicherstellen dass _bulkImport IMMER zurückgesetzt wird (sonst Dirty-Tracking dauerhaft aus!)
    const frs = App.query('SELECT * FROM fachrichtungen');
    let jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge');
    let schulen = App.query('SELECT * FROM berufsschulen');
    let klassen = App.query('SELECT k.*, bs.name as schule_name FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id');
    const today = new Date();
    let imported = 0, skipped = 0;
    let stats = { schulen: new Set(), jahrgaenge: new Set(), klassen: new Set(), frNotFound: new Set() };

    // ── Match Fachrichtung by IBYKUS code (31-37, 171-177) ──
    function matchFR(codeStr) {
      if (!codeStr) return null;
      const code = codeStr.toString().trim();
      // Try exact match first
      let fr = frs.find(f => f.code === code);
      // Try with leading zero (31 → 031)
      if (!fr && code.length <= 2) fr = frs.find(f => f.code === code.padStart(3, '0'));
      // Try without leading zero (031 → 31)
      if (!fr) fr = frs.find(f => f.code === code.replace(/^0+/, ''));
      return fr ? fr.id : null;
    }

    // ── FR short name for Klassen-Bezeichnung ──
    function frShort(frId) {
      const fr = frs.find(f => f.id === frId);
      if (!fr) return '?';
      const typ = fr.typ === 'Fachwerker' ? 'FW ' : '';
      return typ + fr.bezeichnung;
    }

    // ── Parse date (DD.MM.YYYY) ──
    // Format aus dem Dialog übernehmen (Fallback: zuletzt erkanntes)
    const fmtSel = document.getElementById('map_datumsformat');
    if (fmtSel && fmtSel.value) this._datumsFormat = fmtSel.value;
    const parseD = (t, fmt) => ImportHandler._parseD(t, fmt);

    // ── Lehrjahr from Ausbildungsbeginn ──
    function calcLJ(beg) {
      const d = parseD(beg);
      if (!d) return null;
      let lj = today.getFullYear() - d.getFullYear();
      if (today.getMonth() < d.getMonth() || (today.getMonth()===d.getMonth() && today.getDate() < d.getDate())) lj--;
      return Math.max(1, Math.min(3, lj + 1));
    }

    // ── Jahrgang from "S2028" / "W2027" code (AP only, NOT ZP!) ──

    function getJG(code) {
      if (!code) return null;
      code = code.toString().trim();
      // Direkt den IBYKUS-Wert übernehmen - keine Anpassungen!
      const bez = code;
      // Versuche Prefix und Jahr zu extrahieren für Sortierung
      const m = code.toUpperCase().match(/^([SWHF])(\d{4})$/);
      const typMap = { S: 'Sommer', W: 'Winter', F: 'Frühjahr', H: 'Herbst' };
      const typ = m ? (typMap[m[1]] || m[1]) : '';
      const year = m ? parseInt(m[2]) : (parseInt(code.match(/\d{4}/)?.[0]) || 0);
      let jg = jahrgaenge.find(j => j.bezeichnung === bez);
      if (jg) return jg.id;
      // Create new Jahrgang with original IBYKUS value as bezeichnung
      App.run('INSERT OR IGNORE INTO abschlussjahrgaenge (bezeichnung,typ,jahr) VALUES (?,?,?)', [bez,typ,year]);
      const n = App.query('SELECT * FROM abschlussjahrgaenge WHERE bezeichnung=?', [bez]);
      if (n.length) { jahrgaenge.push(n[0]); stats.jahrgaenge.add(bez); return n[0].id; }
      return null;
    }

    // ── Get/create Berufsschule from Klassebeschreibung ──
    function getSchule(name) {
      if (!name) return null;
      name = name.trim();
      if (!name) return null;
      let s = schulen.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!s) s = schulen.find(x => name.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(name.toLowerCase()));
      if (s) return s.id;
      App.run('INSERT INTO berufsschulen (name) VALUES (?)', [name]);
      const n = App.query('SELECT * FROM berufsschulen WHERE name=?', [name]);
      if (n.length) { schulen.push(n[0]); stats.schulen.add(name); return n[0].id; }
      return null;
    }

    // ── Get/create Klasse ──
    function getKlasse(sid, jid, fid, lj) {
      if (!sid || !jid) return null;
      let k = klassen.find(x => x.berufsschule_id===sid && x.jahrgang_id===jid && x.fachrichtung_id===fid);
      if (k) return k.id;
      // Build class name: "FR S2028" format
      const jgBez = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jid]) || '';
      const bez = `${frShort(fid)} ${jgBez}`.trim();
      App.run('INSERT OR IGNORE INTO klassen (berufsschule_id,jahrgang_id,lehrjahr,fachrichtung_id,klassenbezeichnung) VALUES (?,?,?,?,?)', [sid,jid,lj,fid,bez]);
      const n = App.query('SELECT k.*,bs.name as schule_name FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.berufsschule_id=? AND k.jahrgang_id=? AND k.fachrichtung_id IS ?', [sid,jid,fid]);
      if (n.length) {
        klassen.push(n[0]);
        const sc = schulen.find(s => s.id===sid);
        stats.klassen.add(`${sc?.name||'?'} → ${bez}`);
        return n[0].id;
      }
      return null;
    }

    // ── Build Betriebsname (combine name + zusatz) ──
    function buildBetrieb(row) {
      const name = (row[getMap('ausbildungsstaette')] || '').trim();
      const zusatz = (row[getMap('zusatzbezeichnung')] || '').trim();
      const ort = (row[getMap('betrieb_ort')] || '').trim();
      let result = zusatz || name;
      if (zusatz && name && !zusatz.toLowerCase().includes(name.toLowerCase())) {
        result = `${name}, ${zusatz}`;
      }
      if (ort) result += ` (${ort})`;
      return result;
    }

    // ── Get or create Betrieb with full contact data ──
    function getOrCreateBetrieb(row) {
      const name = (row[getMap('ausbildungsstaette')] || '').trim();
      if (!name) return null;
      const bnr = (row[getMap('betriebsnummer')] || '').trim();
      const bVorname = (row[getMap('betrieb_vorname')] || '').trim();
      const zusatz = (row[getMap('zusatzbezeichnung')] || '').trim();
      const strasse = (row[getMap('betrieb_strasse')] || '').trim();
      const plz = (row[getMap('betrieb_plz')] || '').trim();
      const ort = (row[getMap('betrieb_ort')] || '').trim();
      const tel = (row[getMap('betrieb_tel')] || '').trim();
      const fax = (row[getMap('betrieb_fax')] || '').trim();
      const email = (row[getMap('betrieb_email')] || '').trim();
      // Find by Betriebsnummer first, then by name
      let b = bnr ? App.query('SELECT * FROM betriebe WHERE betriebsnummer=?', [bnr])[0] : null;
      if (!b) b = App.query('SELECT * FROM betriebe WHERE name=? AND ort=?', [name, ort])[0];
      if (b) {
        // Always overwrite with newest import data (unless import field is empty)
        if (email) App.run('UPDATE betriebe SET email=? WHERE id=?', [email, b.id]);
        if (tel) App.run('UPDATE betriebe SET telefon=? WHERE id=?', [tel, b.id]);
        if (bVorname) App.run('UPDATE betriebe SET vorname=? WHERE id=?', [bVorname, b.id]);
        if (zusatz) App.run('UPDATE betriebe SET zusatzbezeichnung=?,firma=? WHERE id=?', [zusatz, zusatz, b.id]);
        if (strasse) App.run('UPDATE betriebe SET strasse=? WHERE id=?', [strasse, b.id]);
        if (plz) App.run('UPDATE betriebe SET plz=? WHERE id=?', [plz, b.id]);
        if (ort) App.run('UPDATE betriebe SET ort=? WHERE id=?', [ort, b.id]);
        if (fax) App.run('UPDATE betriebe SET fax=? WHERE id=?', [fax, b.id]);
        return b.id;
      }
      // Create new
      // Leere Betriebsnummer als NULL: betriebsnummer ist UNIQUE, und '' gilt in
      // SQLite als regulärer Wert – der zweite Betrieb ohne Nummer scheiterte,
      // wodurch der ganze Azubi-Datensatz verworfen wurde.
      App.run('INSERT INTO betriebe (betriebsnummer,name,vorname,zusatzbezeichnung,firma,ansprechpartner,strasse,plz,ort,telefon,fax,email) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [bnr || null, name, bVorname, zusatz, zusatz, bVorname, strasse, plz, ort, tel, fax, email]);
      const n = App.query('SELECT id FROM betriebe WHERE rowid=last_insert_rowid()');
      return n.length ? n[0].id : null;
    }

    // ═══ MAIN IMPORT LOOP ═══
    let jgCounter = {};
    let noKlasseCount = 0;
    let errorRows = [];      // echte Fehler – Zeile wurde übersprungen
    let datumsFehler = [];   // Datum unlesbar – Zeile wurde OHNE Datum importiert
   try {
    data.forEach((row, rowIdx) => {
     try {
      const nachname = (row[getMap('nachname')]||'').trim();
      const vorname = (row[getMap('vorname')]||'').trim();
      if (!nachname || !vorname) { skipped++; return; }

      const betrieb   = buildBetrieb(row);
      const betriebId = getOrCreateBetrieb(row);
      const berufCode = (row[getMap('beruf_code')]||'').trim();
      const abegRaw   = (row[getMap('ausbildungsbeginn')]||'').trim();
      const aendRaw   = (row[getMap('ausbildungsende')]||'').trim();
      // Convert DD.MM.YYYY to ISO YYYY-MM-DD. Unparsbares Datum → '' (NICHT den Rohtext
      // in eine Datums-Spalte schreiben — der zerstört KW-Mathematik + Phasen-Berechnung)
      const abeg = (() => { const d = parseD(abegRaw); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''; })();
      const aend = (() => { const d = parseD(aendRaw); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''; })();
      if ((abegRaw && !abeg) || (aendRaw && !aend)) {
        datumsFehler.push({ zeile: rowIdx + 2, fehler: `Unlesbares Datum: "${abegRaw && !abeg ? abegRaw : aendRaw}"`, name: nachname + ', ' + vorname });
      }
      const ibyk      = (row[getMap('ibykus_id')]||'').trim();
      const apCode    = (row[getMap('pruefungstermin')]||'').trim();
      const schulName = (row[getMap('berufsschule')]||'').trim();
      const tel       = (row[getMap('telefon')]||'').trim();
      const email     = (row[getMap('email')]||'').trim();
      const amt       = (row[getMap('zustaendiges_amt')]||'').trim();
      const geschRaw  = (row[getMap('geschlecht')]||'').trim().toLowerCase();
      const geschlecht = geschRaw === '1' || geschRaw.startsWith('m') ? 'm' : geschRaw === '2' || geschRaw.startsWith('w') || geschRaw.startsWith('f') ? 'w' : geschRaw === '3' || geschRaw.startsWith('d') ? 'd' : '';
      const schulabschluss = (row[getMap('schulabschluss')]||'').trim();
      const peRaw = (row[getMap('pruefungserfolg')]||'').trim();
      const pruefungserfolg = peRaw === '1' ? 'bestanden' : peRaw === '2' ? 'nicht_bestanden' : '';
      const peW1Raw = (row[getMap('pruefungserfolg_wdh1')]||'').trim();
      const pruefungserfolg_wdh1 = peW1Raw === '1' ? 'bestanden' : peW1Raw === '2' ? 'nicht_bestanden' : '';
      const peW2Raw = (row[getMap('pruefungserfolg_wdh2')]||'').trim();
      const pruefungserfolg_wdh2 = peW2Raw === '1' ? 'bestanden' : peW2Raw === '2' ? 'nicht_bestanden' : '';
      const bav_status = (row[getMap('bav_status')]||'').trim().toUpperCase();
      const zwischenpruefung = (row[getMap('zwischenpruefung')]||'').trim();

      // BAV-Status → aktiv/inaktiv ableiten:
      // BESTAET (Bestätigt) + BEARB (Bearbeitet) = aktives Ausbildungsverhältnis
      // ENDE = Ausbildungsverhältnis beendet → inaktiv setzen
      const bavAktiv = bav_status === 'ENDE' ? 0 : 1;
      const bavStatus = bav_status === 'ENDE' ? 'abgebrochen' : 'aktiv';

      // 1) Fachrichtung (by numeric code)
      const frId = matchFR(berufCode);
      if (!frId && berufCode) stats.frNotFound.add(berufCode);

      // 2) Jahrgang (from "S2028" code)
      const jgId = apCode ? getJG(apCode) : null;
      jgCounter[jgId] = (jgCounter[jgId] || 0) + 1;

      // 3) Berufsschule (from Klassebeschreibung)
      const sId = getSchule(schulName);

      // 4) Lehrjahr (from AV-beginn)
      const lj = calcLJ(abeg);

      // 5) Klasse (auto-create) – Verkürzer + Dreijährige in derselben Klasse
      const klId = (sId && frId) ? getKlasse(sId, jgId, frId, lj) : null;
      if (!klId) noKlasseCount++;

      // 6) Duplikatsprüfung: Update statt Skip bei Änderungen
      let existingId = null;
      if (ibyk) existingId = App.scalar('SELECT id FROM schueler WHERE ibykus_id=? AND ibykus_id != ""', [ibyk]);
      // "jahrgang_id IS ?" statt "=?": bei jgId=null matcht "= NULL" nie → Massenduplikate bei Re-Import
      if (!existingId && nachname && vorname) existingId = App.scalar('SELECT id FROM schueler WHERE nachname=? AND vorname=? AND jahrgang_id IS ?', [nachname,vorname,jgId]);

      if (existingId) {
        // Check if data changed → update
        const ex = App.query('SELECT * FROM schueler WHERE id=?', [existingId])[0];
        const changes = [];
        // Namensänderungen (z.B. Heirat) kamen bisher nie im Tool an, und ein
        // über den Namen gefundener Datensatz behielt seine leere BAV-Ident –
        // beim nächsten Import entstand daraus eine Dublette.
        if (nachname && ex.nachname !== nachname) changes.push(['nachname', nachname, ex.nachname]);
        if (vorname && ex.vorname !== vorname) changes.push(['vorname', vorname, ex.vorname]);
        if (ibyk && !ex.ibykus_id) changes.push(['ibykus_id', ibyk, ex.ibykus_id]);
        if (aend && ex.ausbildungsende !== aend) changes.push(['ausbildungsende', aend, ex.ausbildungsende]);
        if (abeg && ex.ausbildungsbeginn !== abeg) changes.push(['ausbildungsbeginn', abeg, ex.ausbildungsbeginn]);
        if (betrieb && ex.ausbildungsstaette !== betrieb) changes.push(['ausbildungsstaette', betrieb, ex.ausbildungsstaette]);
        if (tel && ex.telefon !== tel) changes.push(['telefon', tel, ex.telefon]);
        if (email && ex.email !== email) changes.push(['email', email, ex.email]);
        if (betriebId && ex.betrieb_id !== betriebId) changes.push(['betrieb_id', betriebId, ex.betrieb_id]);
        if (klId && ex.klasse_id !== klId) changes.push(['klasse_id', klId, ex.klasse_id]);
        if (jgId && ex.jahrgang_id !== jgId) changes.push(['jahrgang_id', jgId, ex.jahrgang_id]);
        if (frId && ex.fachrichtung_id !== frId) changes.push(['fachrichtung_id', frId, ex.fachrichtung_id]);
        if (amt && ex.zustaendiges_amt !== amt) changes.push(['zustaendiges_amt', amt, ex.zustaendiges_amt]);
        if (geschlecht && ex.geschlecht !== geschlecht) changes.push(['geschlecht', geschlecht, ex.geschlecht]);
        if (schulabschluss && ex.schulabschluss !== schulabschluss) changes.push(['schulabschluss', schulabschluss, ex.schulabschluss]);
        if (pruefungserfolg && ex.pruefungserfolg !== pruefungserfolg) changes.push(['pruefungserfolg', pruefungserfolg, ex.pruefungserfolg]);
        if (pruefungserfolg_wdh1 && ex.pruefungserfolg_wdh1 !== pruefungserfolg_wdh1) changes.push(['pruefungserfolg_wdh1', pruefungserfolg_wdh1, ex.pruefungserfolg_wdh1]);
        if (pruefungserfolg_wdh2 && ex.pruefungserfolg_wdh2 !== pruefungserfolg_wdh2) changes.push(['pruefungserfolg_wdh2', pruefungserfolg_wdh2, ex.pruefungserfolg_wdh2]);
        if (bav_status && ex.bav_status !== bav_status) changes.push(['bav_status', bav_status, ex.bav_status]);
        if (zwischenpruefung && ex.zwischenpruefung !== zwischenpruefung) changes.push(['zwischenpruefung', zwischenpruefung, ex.zwischenpruefung]);

        // BAV-Status geändert → aktiv/status synchronisieren
        if (bav_status && ex.bav_status !== bav_status) {
          if (ex.aktiv !== bavAktiv) changes.push(['aktiv', bavAktiv, ex.aktiv]);
          // "ENDE" heißt in IBYKUS nur "Vertrag beendet" – auch bei regulärem,
          // bestandenem Abschluss. Ein bereits gepflegtes Ergebnis (bestanden,
          // verlängert) darf davon nicht zu "abgebrochen" überschrieben werden.
          const ergebnisGepflegt = ['ap_bestanden', 'verlaengert', 'abgebrochen'].includes(ex.status);
          if (ex.status !== bavStatus && !(bavAktiv === 0 && ergebnisGepflegt)) changes.push(['status', bavStatus, ex.status]);
          if (bavAktiv === 0 && ex.aktiv === 1) {
            const today = todayStr();
            if (!ex.inaktiv_datum) changes.push(['inaktiv_datum', today, ex.inaktiv_datum]);
            if (!ex.inaktiv_grund) changes.push(['inaktiv_grund', 'BAV beendet (IBYKUS)', ex.inaktiv_grund]);
            stats.bavEnde = (stats.bavEnde || 0) + 1;
          }
          if (bavAktiv === 1 && ex.aktiv === 0) {
            // BAV wieder aktiv (z.B. BEARB nach ENDE) → reaktivieren
            changes.push(['inaktiv_datum', '', ex.inaktiv_datum]);
            changes.push(['inaktiv_grund', '', ex.inaktiv_grund]);
            stats.bavReaktiviert = (stats.bavReaktiviert || 0) + 1;
          }
        }

        // Phasen-Schutz: Wenn Ausbildungsdaten sich ändern und Phasen existieren → Konflikt sammeln
        let hatPhasen = false;
        try { hatPhasen = typeof AzubiRechner !== 'undefined' && AzubiRechner.getPhasen(existingId).length > 0; } catch(e) {}
        const datumsAenderung = changes.some(([f]) => f === 'ausbildungsbeginn' || f === 'ausbildungsende');
        if (hatPhasen && datumsAenderung) {
          const konfliktChanges = changes.filter(([f]) => f === 'ausbildungsbeginn' || f === 'ausbildungsende');
          if (!stats.phasenKonflikte) stats.phasenKonflikte = [];
          stats.phasenKonflikte.push({ id: existingId, name: `${ex.nachname}, ${ex.vorname}`, changes: konfliktChanges, allChanges: changes });
          // Datums-Felder NICHT überschreiben, Rest schon
          const safeChanges = changes.filter(([f]) => f !== 'ausbildungsbeginn' && f !== 'ausbildungsende');
          if (safeChanges.length) {
            safeChanges.forEach(([field, newVal]) => {
              App.run(`UPDATE schueler SET ${field}=? WHERE id=?`, [newVal, existingId]);
            });
          }
        } else if (changes.length) {
          changes.forEach(([field, newVal]) => {
            App.run(`UPDATE schueler SET ${field}=? WHERE id=?`, [newVal, existingId]);
          });
        }
        if (changes.length) {
          if (!stats.updated) stats.updated = 0;
          stats.updated++;
        }
        skipped++;
        return;
      }

      // 7) Insert
      App.run('INSERT INTO schueler (nachname,vorname,ausbildungsstaette,fachrichtung_id,ausbildungsbeginn,ausbildungsende,ibykus_id,klasse_id,jahrgang_id,betrieb_id,telefon,email,zustaendiges_amt,geschlecht,schulabschluss,pruefungserfolg,pruefungserfolg_wdh1,pruefungserfolg_wdh2,bav_status,zwischenpruefung,aktiv,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [nachname,vorname,betrieb,frId,abeg,aend,ibyk,klId,jgId,betriebId,tel,email,amt,geschlecht,schulabschluss,pruefungserfolg,pruefungserfolg_wdh1,pruefungserfolg_wdh2,bav_status,zwischenpruefung,bavAktiv,bavStatus]);
      imported++;
      if (bavAktiv === 0) stats.bavEnde = (stats.bavEnde || 0) + 1;
     } catch(rowErr) {
      console.warn(`Import Zeile ${rowIdx + 2}:`, rowErr.message);
      errorRows.push({ zeile: rowIdx + 2, fehler: rowErr.message, name: (row[getMap('nachname')]||'') + ', ' + (row[getMap('vorname')]||'') });
      skipped++;
     }
    });
   } catch(loopErr) {
    console.error('Import-Loop abgebrochen:', loopErr);
    App.toast('Import-Fehler: ' + loopErr.message, 'error');
   }

    // ── AUTO-SWITCH to the Jahrgang with most imported students ──
    if (imported > 0) {
      // Zeilen ohne Jahrgang landen unter dem String-Key "null" — der darf NICHT
      // gewinnen, sonst werden ALLE Jahrgänge deaktiviert und keiner wieder aktiviert
      const mostUsedJgId = Object.entries(jgCounter).filter(([k]) => k !== 'null' && k !== 'undefined').sort((a,b) => b[1]-a[1])[0]?.[0];
      if (mostUsedJgId) {
        // Set as active (MUST use App.run for dirty-tracking + auto-save!)
        App.run('UPDATE abschlussjahrgaenge SET aktiv=0');
        App.run('UPDATE abschlussjahrgaenge SET aktiv=1 WHERE id=?', [parseInt(mostUsedJgId)]);
        // Jahrgänge updated → auto-selects aktiv
        const jgName = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [parseInt(mostUsedJgId)]);
        stats.switchedTo = jgName;
      }
    } else {
      // (jahrgang refresh no longer needed)
    }

    // ── Result Summary ──
    let parts = [`<strong>${imported}</strong> Schüler importiert`];
    if (stats.updated) parts.push(`<strong>${stats.updated}</strong> bestehende Schüler aktualisiert (geänderte Daten aus Ibykus)`);
    if (skipped) parts.push(`${skipped - (stats.updated||0)} übersprungen (unveränderte Duplikate)`);
    if (stats.schulen.size) parts.push(`<strong>${stats.schulen.size}</strong> Schulen angelegt: ${[...stats.schulen].join(', ')}`);
    if (stats.jahrgaenge.size) parts.push(`<strong>${stats.jahrgaenge.size}</strong> Jahrgänge angelegt: ${[...stats.jahrgaenge].join(', ')}`);
    if (stats.klassen.size) parts.push(`<strong>${stats.klassen.size}</strong> Klassen angelegt`);
    if (stats.switchedTo) parts.push(`Jahrgang <strong>${stats.switchedTo}</strong> aktiviert`);
    // H/F codes now stored as Frühjahr/Herbst directly
    if (stats.frNotFound.size) parts.push(`⚠︎ Unbekannte Beruf-Codes: ${[...stats.frNotFound].join(', ')}`);
    if (stats.bavEnde) parts.push(`⚠︎ <strong>${stats.bavEnde}</strong> Auszubildende als inaktiv markiert (BAV-Status: ENDE)`);
    if (stats.bavReaktiviert) parts.push(`✓ <strong>${stats.bavReaktiviert}</strong> Auszubildende reaktiviert (BAV-Status wieder aktiv)`);
    if (noKlasseCount > 0) parts.push(`⚠︎ ${noKlasseCount} Schüler ohne Klassenzuordnung (fehlende Daten: Schule/Beruf/AV-Beginn)`);

    if (datumsFehler.length) parts.push(`⚠︎ <strong>${datumsFehler.length}</strong> Zeilen mit unlesbarem Datum – Datensätze wurden <strong>ohne Datum</strong> importiert (Datumsformat im Dialog prüfen!)`);
    if (errorRows.length) parts.push(`⚠︎ <strong>${errorRows.length}</strong> Zeilen übersprungen (Fehler)`);

    // Re-enable dirty-tracking (IMMER, auch bei Fehlern)
    App._bulkImport = false;
    // Während des Imports ist die Änderungsverfolgung aus – die Daten stehen
    // NUR im Arbeitsspeicher. Schlägt das Speichern fehl, sind sie beim
    // nächsten regulären Speichern verloren, deshalb hier hart melden.
    this._importGespeichert = false;
    try {
      if (!App.dbFileHandle) throw new Error('Keine Datenbankdatei verbunden');
      await App.fullSave();
      this._importGespeichert = true;
    } catch(e) {
      console.error('Import konnte nicht gespeichert werden:', e);
      App.toast('ACHTUNG: Import wurde NICHT gespeichert (' + (e.message || e) + '). Bitte Netzlaufwerk prüfen und erneut speichern!', 'error');
    }
    App.hideLoading();
    // Log import in einstellungen
    this._logImportHistorie({
      typ: 'azubis', zeilen: data.length, neu: imported, aktualisiert: stats.updated || 0,
      uebersprungen: skipped - (stats.updated || 0), fehler: errorRows.length, datumsFehler: datumsFehler.length,
      details: [...datumsFehler.map(e => ({ ...e, art: 'datum' })), ...errorRows.map(e => ({ ...e, art: 'fehler' }))],
    });
    const history = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='import_history'") || '[]');
    history.unshift({ datum: new Date().toISOString(), importiert: imported, uebersprungen: skipped, zeilen: data.length });
    if (history.length > 20) history.length = 20;
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('import_history',?)", [JSON.stringify(history)]);

    const pKonf = stats.phasenKonflikte || [];
    // Konflikte NICHT als JSON ins onclick-Attribut serialisieren (Escaping-Falle bei
    // CSV-Werten mit Entities/Quotes) — stattdessen per Index referenzieren:
    this._pendingKonflikte = pKonf;
    App.openModal('Import abgeschlossen', `
      ${this._importGespeichert === false ? `<div style="margin-bottom:12px;padding:10px 14px;background:var(--clr-red-light);border:1px solid var(--clr-red);border-radius:var(--radius);font-size:13px">
        <strong>Der Import wurde NICHT auf das Netzlaufwerk geschrieben.</strong> Die Daten stehen nur in dieser Sitzung.
        Bitte die Verbindung prüfen und über „Speichern" erneut sichern – sonst gehen sie verloren.</div>` : ''}
      <div style="font-size:14px;line-height:2">${parts.map(s => `<div>✓ ${s}</div>`).join('')}</div>
      ${stats.klassen.size ? `<div style="margin-top:12px;padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;max-height:200px;overflow-y:auto">
        <strong>Erstellte Klassen:</strong><br>${[...stats.klassen].map(k => `• ${k}`).join('<br>')}</div>` : ''}
      ${pKonf.length ? `<div style="margin-top:12px;padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:var(--radius);font-size:13px">
        <strong>⚠︎ ${pKonf.length} Phasen-Konflikte:</strong> Ausbildungsdaten haben sich geändert, aber Phasen sind hinterlegt. Die Datums-Felder wurden <strong>nicht überschrieben</strong>.
        <div style="max-height:150px;overflow-y:auto;margin-top:6px;font-size:12px">
          ${pKonf.map((k, ki) => `<div style="padding:4px 0;border-bottom:1px solid #eee">
            <strong>${esc(k.name)}</strong>: ${k.changes.map(([f,neu,alt]) => `${esc(f)}: ${esc(alt||'–')} → ${esc(neu)}`).join(', ')}
            <button class="btn btn-sm" style="padding:1px 6px;font-size:10px;margin-left:4px" onclick="ImportHandler._resolveKonflikt(${k.id},'accept',ImportHandler._pendingKonflikte[${ki}].changes);this.parentElement.style.opacity=0.4;this.textContent='✓ Übernommen'">Neue Daten übernehmen</button>
          </div>`).join('')}
        </div>
      </div>` : ''}
      ${datumsFehler.length ? `<div style="margin-top:12px;padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:var(--radius);font-size:12px">
        <strong>⚠︎ Unlesbare Datumswerte (${datumsFehler.length}) – Datensätze OHNE Datum importiert:</strong>
        <div style="font-size:11px;margin:4px 0">Häufigste Ursache: falsches Datumsformat gewählt. Format im Import-Dialog umstellen und erneut importieren – die Daten werden dann nachgetragen.</div>
        <div style="max-height:100px;overflow-y:auto;margin-top:4px">${datumsFehler.slice(0, 10).map(e => `<div>Zeile ${e.zeile}: ${esc(e.name)} – ${esc(e.fehler)}</div>`).join('')}${datumsFehler.length > 10 ? `<div style="color:var(--clr-text-light)">…und ${datumsFehler.length - 10} weitere</div>` : ''}</div>
      </div>` : ''}
      ${errorRows.length ? `<div style="margin-top:12px;padding:10px 14px;background:#ffeef0;border:1px solid var(--clr-red);border-radius:var(--radius);font-size:12px">
        <strong>⚠︎ Übersprungene Zeilen (${errorRows.length}):</strong>
        <div style="max-height:120px;overflow-y:auto;margin-top:4px">${errorRows.slice(0, 20).map(e => `<div>Zeile ${e.zeile}: ${esc(e.name)} – <span style="color:var(--clr-red)">${esc(e.fehler)}</span></div>`).join('')}${errorRows.length > 20 ? `<div style="color:var(--clr-text-light)">...und ${errorRows.length - 20} weitere</div>` : ''}</div>
      </div>` : ''}
    `, `<button class="btn btn-primary" onclick="App.closeModal();Views.importView()">OK</button>`);
   } catch(importErr) {
    console.error('Import fehlgeschlagen:', importErr);
    App.toast('Import-Fehler: ' + importErr.message, 'error');
   } finally {
    App._bulkImport = false;
    App.hideLoading();
   }
  },

  _resolveKonflikt(schuelerId, action, changes) {
    if (action === 'accept') {
      changes.forEach(([field, newVal]) => {
        App.run(`UPDATE schueler SET ${field}=? WHERE id=?`, [newVal, schuelerId]);
      });
      const phasen = typeof AzubiRechner !== 'undefined' ? AzubiRechner.getPhasen(schuelerId) : [];
      if (phasen.length) {
        const s = App.query('SELECT ausbildungsbeginn, ausbildungsende FROM schueler WHERE id=?', [schuelerId])[0];
        const first = phasen[0];
        const last = phasen[phasen.length - 1];
        if (s.ausbildungsbeginn && first.von !== s.ausbildungsbeginn) {
          App.run('UPDATE ausbildungsphasen SET von=? WHERE id=?', [s.ausbildungsbeginn, first.id]);
        }
        if (s.ausbildungsende && last.typ === 'ausbildung' && !last.bis) {
          // offene letzte Phase: nothing to adjust
        } else if (s.ausbildungsende && last.bis && last.bis !== s.ausbildungsende) {
          App.run('UPDATE ausbildungsphasen SET bis=? WHERE id=?', [s.ausbildungsende, last.id]);
        }
      }
      App.toast('Daten übernommen, Phasen angepasst', 'success');
    }
  },

  addManually() {
    const frs = App.query('SELECT * FROM fachrichtungen ORDER BY typ, bezeichnung');
    const klassen = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name`);
    const betriebe = App.query('SELECT * FROM betriebe ORDER BY name');
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');
    App.openModal('Schüler hinzufügen', `
      <div class="form-row">
        <div class="form-group"><label>Nachname *</label><input class="form-control" id="mSNach"></div>
        <div class="form-group"><label>Vorname *</label><input class="form-control" id="mSVor"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Betrieb (verknüpft)</label><select class="form-control" id="mSBetriebId">
          <option value="">– Kein Betrieb –</option>${betriebe.map(b=>`<option value="${b.id}">${esc(b.name)}${b.ort?' ('+esc(b.ort)+')':''}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Ausb.stätte (Freitext)</label><input class="form-control" id="mSBetrieb" placeholder="Falls kein Betrieb verknüpft" style="font-size:11px"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Fachrichtung</label><select class="form-control" id="mSFR">
          <option value="">–</option>${frs.map(f=>`<option value="${f.id}">${esc(f.typ + ': ' + f.bezeichnung)} (${f.code})</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Klasse → Schule</label><select class="form-control" id="mSKlasse">
          <option value="">–</option>${klassen.map(k=>`<option value="${k.id}">${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Jahrgang</label><select class="form-control" id="mSJG">
          <option value="">–</option>${jahrgaenge.map(j=>`<option value="${j.id}">${esc(j.bezeichnung)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>iBykus-Ident</label><input class="form-control" id="mSIbykus" placeholder="Optional" style="font-size:12px"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Ausbildungsbeginn</label><input type="date" class="form-control" id="mSBeginn"></div>
        <div class="form-group"><label>Ausbildungsende</label><input type="date" class="form-control" id="mSEnde"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>☎︎ Telefon</label><input class="form-control" id="mSTelefon" placeholder="Mobil/Festnetz"></div>
        <div class="form-group"><label>✉︎ E-Mail</label><input class="form-control" id="mSEmail" placeholder="azubi@email.de"></div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="ImportHandler.saveManual()">Speichern</button>`);
  },
  saveManual() {
    const n = document.getElementById('mSNach').value.trim();
    const v = document.getElementById('mSVor').value.trim();
    if (!n || !v) return App.toast('Name und Vorname sind Pflichtfelder', 'error');
    App.run(`INSERT INTO schueler (nachname,vorname,ausbildungsstaette,fachrichtung_id,klasse_id,jahrgang_id,betrieb_id,ibykus_id,ausbildungsbeginn,ausbildungsende,telefon,email) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [n, v, document.getElementById('mSBetrieb').value.trim(),
       document.getElementById('mSFR').value || null,
       document.getElementById('mSKlasse').value || null,
       document.getElementById('mSJG').value || null,
       document.getElementById('mSBetriebId').value || null,
       document.getElementById('mSIbykus').value.trim(),
       document.getElementById('mSBeginn').value,
       document.getElementById('mSEnde').value,
       document.getElementById('mSTelefon').value.trim(),
       document.getElementById('mSEmail').value.trim()]);
    App.closeModal();
    Views.importView();
    App.toast('Schüler hinzugefügt', 'success');
  },
  editSchueler(id) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [id])[0];
    const frs = App.query('SELECT * FROM fachrichtungen ORDER BY typ, bezeichnung');
    const klassen = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name`);
    const betriebe = App.query('SELECT * FROM betriebe ORDER BY name');
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');

    // Linked info
    const klasse = s.klasse_id ? App.query('SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] : null;
    const betrieb = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
    const keCount = App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=? AND ergebnis != ""', [id]) || 0;
    const wvCount = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [id]) || 0;
    const fehlGesamt = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [id]) || 0;
    const ampel = App.getSchuelerAmpel(id);

    const statusLabels = {aktiv:'Aktiv',ap_zugelassen:'AP zugelassen',ap_bestanden:'AP bestanden',abgebrochen:'Abgebrochen',verlaengert:'Verlängert'};
    const geschlechtLabels = {'':'– Nicht angegeben –', m:'Männlich', w:'Weiblich', d:'Divers'};
    const peLabels = {'':'– Keine Angabe –', bestanden:'Bestanden', nicht_bestanden:'Nicht bestanden'};

    // Lehrjahr berechnen
    let lehrjahrInfo = '–';
    if (s.ausbildungsbeginn) {
      const d = new Date(s.ausbildungsbeginn);
      const now = new Date();
      let lj = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth()===d.getMonth() && now.getDate() < d.getDate())) lj--;
      lj = Math.max(1, Math.min(4, lj + 1));
      lehrjahrInfo = `${lj}. Lehrjahr`;
    }

    App.openModal(`${ampel.icon} ${s.nachname}, ${s.vorname}`, `
      <!-- Quick-Info Bar -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;font-size:11px">
        <span style="padding:3px 8px;background:var(--clr-blue-light);border-radius:10px">${keCount} Kontrollen</span>
        ${wvCount ? `<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:10px;color:var(--clr-red)">${wvCount} offene WV</span>` : ''}
        <span style="padding:3px 8px;background:${fehlGesamt>=77?'var(--clr-red-light)':'var(--clr-warm)'};border-radius:10px">${fehlGesamt} Fehltage</span>
        ${klasse ? `<span style="padding:3px 8px;background:var(--clr-green-light);border-radius:10px">${esc(klasse.schule)}</span>` : ''}
        ${s.landesfachklasse ? `<span style="padding:3px 8px;background:#e8d5f5;border-radius:10px;color:#7b2fa0">LFK: ${esc(s.landesfachklasse)}</span>` : ''}
        ${betrieb?.email ? `<span style="padding:3px 8px;background:var(--clr-warm);border-radius:10px">${esc(betrieb.email)}</span>` : ''}
      </div>

      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mSTab1',this)">Persönlich</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mSTab2',this)">Ausbildung</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mSTab3',this)">Prüfungen</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mSTab4',this)">Status</button>
      </div>

      <!-- Tab 1: Persönlich -->
      <div id="mSTab1" class="modal-tab-content active">
        <div class="form-row">
          <div class="form-group"><label>Nachname *</label><input class="form-control" id="mSNach" value="${esc(s.nachname)}"></div>
          <div class="form-group"><label>Vorname *</label><input class="form-control" id="mSVor" value="${esc(s.vorname)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Geschlecht</label><select class="form-control" id="mSGeschlecht">
            ${Object.entries(geschlechtLabels).map(([v,l])=>`<option value="${v}" ${(s.geschlecht||'')===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Schulabschluss</label><input class="form-control" id="mSSchulabschluss" value="${esc(s.schulabschluss||'')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Telefon</label><input class="form-control" id="mSTelefon" value="${esc(s.telefon||'')}" placeholder="Mobil/Festnetz"></div>
          <div class="form-group"><label>E-Mail</label><input class="form-control" id="mSEmail" value="${esc(s.email||'')}" placeholder="azubi@email.de"></div>
        </div>
      </div>

      <!-- Tab 2: Ausbildung -->
      <div id="mSTab2" class="modal-tab-content">
        <div class="form-row">
          <div class="form-group"><label>Betrieb (verknüpft)</label><select class="form-control" id="mSBetriebId">
            <option value="">– Kein Betrieb –</option>${betriebe.map(b=>`<option value="${b.id}" ${b.id===s.betrieb_id?'selected':''}>${esc(b.name)}${b.ort?' ('+esc(b.ort)+')':''}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Ausb.stätte (Freitext)</label><input class="form-control" id="mSBetrieb" value="${esc(s.ausbildungsstaette)}" style="font-size:11px"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fachrichtung</label><select class="form-control" id="mSFR">
            <option value="">–</option>${frs.map(f=>`<option value="${f.id}" ${f.id===s.fachrichtung_id?'selected':''}>${esc(f.bezeichnung)} (${f.code})</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Klasse / Schule</label><select class="form-control" id="mSKlasse">
            <option value="">–</option>${klassen.map(k=>`<option value="${k.id}" ${k.id===s.klasse_id?'selected':''}>${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
          </select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Jahrgang</label><select class="form-control" id="mSJG">
            <option value="">–</option>${jahrgaenge.map(j=>`<option value="${j.id}" ${j.id===s.jahrgang_id?'selected':''}>${esc(j.bezeichnung)}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>iBykus-Ident</label><input class="form-control" id="mSIbykus" value="${esc(s.ibykus_id||'')}" style="font-size:12px"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Ausbildungsbeginn</label><input type="date" class="form-control" id="mSBeginn" value="${s.ausbildungsbeginn||''}"></div>
          <div class="form-group"><label>Ausbildungsende</label><input type="date" class="form-control" id="mSEnde" value="${s.ausbildungsende||''}"></div>
          <div class="form-group"><label>Lehrjahr (berechnet)</label><input class="form-control" value="${lehrjahrInfo}" disabled style="background:var(--clr-warm);font-weight:600"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Zuständiges Amt</label><select class="form-control" id="mSAmt">
            <option value="">–</option>${Object.entries(App.AEMTER).map(([code,name])=>`<option value="${code}" ${s.zustaendiges_amt===code?'selected':''}>${code} ${esc(name)}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Landesfachklasse</label><input class="form-control" id="mSLFK" value="${esc(s.landesfachklasse||'')}" placeholder="Gemüse, Obst, Baumschule, Stauden" style="font-size:11px"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Beruf (Tarif)</label><select class="form-control" id="mSBerufId">
            <option value="">–</option>${(typeof AzubiRechner!=='undefined'?AzubiRechner.BERUFE:[]).map(b=>`<option value="${b.id}" ${(s.beruf_id||'')===b.id?'selected':''}>${esc(b.label)}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Geburtsdatum</label><input type="date" class="form-control" id="mSGeburt" value="${s.geburtsdatum||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Reguläre Dauer (Monate)</label><input type="number" class="form-control" id="mSDauer" value="${s.regulaer_dauer_monate||36}" min="6" max="48"></div>
          <div class="form-group"><label>Verkürzung (Monate)</label><input type="number" class="form-control" id="mSVerk" value="${s.verkuerzung_monate||0}" min="0" max="18"></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:6px;padding-top:20px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="mSVorzeitig" ${s.vorzeitige_zulassung?'checked':''} style="width:18px;height:18px;accent-color:var(--clr-forest)"> Vorzeitige Zulassung (§45)
          </label></div>
        </div>
        ${typeof AzubiDashboard!=='undefined'&&AzubiDashboard.isEnabled()?`<div style="text-align:right;margin-top:4px"><button class="btn btn-sm btn-secondary" onclick="App.closeModal();AzubiDashboard.open(${id})" style="font-size:11px">Azubi-Dashboard öffnen</button></div>`:''}
      </div>

      <!-- Tab 3: Prüfungen -->
      <div id="mSTab3" class="modal-tab-content">
        <div class="form-row">
          <div class="form-group"><label>Zwischenprüfung</label><input class="form-control" id="mSZP" value="${esc(s.zwischenpruefung||'')}" placeholder="z.B. S2026"></div>
          <div class="form-group" style="display:flex;flex-direction:column;gap:6px;padding-top:20px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="mSAPZu" ${s.ap_zugelassen?'checked':''} style="width:18px;height:18px;accent-color:var(--clr-forest)"> AP zugelassen
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="mSAPBe" ${s.ap_bestanden?'checked':''} style="width:18px;height:18px;accent-color:var(--clr-green)"> AP bestanden
            </label>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Prüfungserfolg</label><select class="form-control" id="mSPE">
            ${Object.entries(peLabels).map(([v,l])=>`<option value="${v}" ${(s.pruefungserfolg||'')===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Wiederholung 1</label><select class="form-control" id="mSPEW1">
            ${Object.entries(peLabels).map(([v,l])=>`<option value="${v}" ${(s.pruefungserfolg_wdh1||'')===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Wiederholung 2</label><select class="form-control" id="mSPEW2">
            ${Object.entries(peLabels).map(([v,l])=>`<option value="${v}" ${(s.pruefungserfolg_wdh2||'')===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
        </div>
      </div>

      <!-- Tab 4: Status -->
      <div id="mSTab4" class="modal-tab-content">
        <div class="form-row">
          <div class="form-group"><label>Status</label><select class="form-control" id="mSStatus">
            ${Object.entries(statusLabels).map(([v,l])=>`<option value="${v}" ${(s.status||'aktiv')===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>BAV-Status (IBYKUS)</label><input class="form-control" id="mSBAV" value="${esc(s.bav_status||'')}" placeholder="z.B. BESTAET, BEARB, ENDE"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Inaktiv seit</label><input type="date" class="form-control" id="mSInaktivDatum" value="${s.inaktiv_datum||''}"></div>
          <div class="form-group"><label>Inaktiv-Grund</label><input class="form-control" id="mSInaktivGrund" value="${esc(s.inaktiv_grund||'')}"></div>
        </div>
        <div class="form-group"><label>Import-Datum</label><input class="form-control" value="${s.import_datum||'–'}" disabled style="background:var(--clr-warm)"></div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-sm btn-secondary" onclick="App.closeModal();SchuelerAkte.open(${id})" title="Bemerkungen & Dateien">${svgIcon('akte')} Akte${(() => { const c = SchuelerAkte.getCount(id); return c ? ' (' + c + ')' : ''; })()}</button>
        ${s.aktiv ? `<button class="btn btn-danger btn-sm" onclick="ImportHandler.setInaktiv(${id})">Inaktiv setzen</button>` : `<button class="btn btn-success btn-sm" onclick="ImportHandler.setAktiv(${id})">Reaktivieren</button>`}
        <button class="btn btn-primary" onclick="ImportHandler.updateSchueler(${id})">Speichern</button>`);
    _makeModalWide();
  },
  updateSchueler(id) {
    const n = document.getElementById('mSNach').value.trim();
    const v = document.getElementById('mSVor').value.trim();
    if (!n || !v) return App.toast('Name und Vorname sind Pflichtfelder', 'error');
    const oldS = App.query('SELECT * FROM schueler WHERE id=?', [id])[0] || {};
    const status = document.getElementById('mSStatus').value;
    const aktiv = (status === 'aktiv' || status === 'ap_zugelassen') ? 1 : 0;
    App.run(`UPDATE schueler SET nachname=?,vorname=?,ausbildungsstaette=?,fachrichtung_id=?,klasse_id=?,
      betrieb_id=?,jahrgang_id=?,ibykus_id=?,ausbildungsbeginn=?,ausbildungsende=?,
      telefon=?,email=?,zustaendiges_amt=?,landesfachklasse=?,
      status=?,aktiv=?,ap_zugelassen=?,ap_bestanden=?,inaktiv_grund=?,inaktiv_datum=?,
      geschlecht=?,schulabschluss=?,pruefungserfolg=?,pruefungserfolg_wdh1=?,pruefungserfolg_wdh2=?,
      bav_status=?,zwischenpruefung=?,
      beruf_id=?,geburtsdatum=?,regulaer_dauer_monate=?,verkuerzung_monate=?,vorzeitige_zulassung=? WHERE id=?`,
      [n, v, document.getElementById('mSBetrieb').value.trim(),
       document.getElementById('mSFR').value || null,
       document.getElementById('mSKlasse').value || null,
       document.getElementById('mSBetriebId').value || null,
       document.getElementById('mSJG').value || null,
       document.getElementById('mSIbykus').value.trim(),
       document.getElementById('mSBeginn').value,
       document.getElementById('mSEnde').value,
       document.getElementById('mSTelefon')?.value?.trim() || '',
       document.getElementById('mSEmail')?.value?.trim() || '',
       document.getElementById('mSAmt')?.value || '',
       document.getElementById('mSLFK')?.value?.trim() || '',
       status, aktiv,
       document.getElementById('mSAPZu').checked ? 1 : 0,
       document.getElementById('mSAPBe').checked ? 1 : 0,
       document.getElementById('mSInaktivGrund')?.value || '',
       document.getElementById('mSInaktivDatum')?.value || '',
       document.getElementById('mSGeschlecht')?.value || '',
       document.getElementById('mSSchulabschluss')?.value?.trim() || '',
       document.getElementById('mSPE')?.value || '',
       document.getElementById('mSPEW1')?.value || '',
       document.getElementById('mSPEW2')?.value || '',
       document.getElementById('mSBAV')?.value?.trim() || '',
       document.getElementById('mSZP')?.value?.trim() || '',
       document.getElementById('mSBerufId')?.value || '',
       document.getElementById('mSGeburt')?.value || '',
       parseInt(document.getElementById('mSDauer')?.value) || 36,
       parseInt(document.getElementById('mSVerk')?.value) || 0,
       document.getElementById('mSVorzeitig')?.checked ? 1 : 0,
       id]);
    // Änderungen loggen
    const newS = App.query('SELECT * FROM schueler WHERE id=?', [id])[0] || {};
    App.IBYKUS_FELDER.forEach(f => { if (String(oldS[f]||'') !== String(newS[f]||'')) App.logChange(id, f, oldS[f], newS[f], 'stammdaten_bearbeitet'); });
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler aktualisiert', 'success');
  },
  setInaktiv(id) {
    const today = todayStr();
    App.logChange(id, 'status', 'aktiv', 'ap_bestanden', 'inaktiv_gesetzt');
    App.run("UPDATE schueler SET aktiv=0, status='ap_bestanden', inaktiv_datum=? WHERE id=?", [today, id]);
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler auf inaktiv gesetzt', 'success');
  },
  setAktiv(id) {
    App.logChange(id, 'status', 'inaktiv', 'aktiv', 'reaktiviert');
    App.run("UPDATE schueler SET aktiv=1, status='aktiv', inaktiv_datum='', inaktiv_grund='' WHERE id=?", [id]);
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler reaktiviert', 'success');
  },
  deleteSchueler(id) {
    if (!confirm('Schüler wirklich löschen?')) return;
    App.deleteSchuelerKaskade(id);
    try { SchuelerView.render(); } catch(e) {}
  },
  // ═══════════════════════════════════════════
  //  LANDESFACHKLASSE-IMPORT
  // ═══════════════════════════════════════════
  handleLFKFile(file) {
    if (!file) return;
    if (!_validateFile(file, { extensions: ['csv','txt','xlsx','xls'], maxSize: 50*1024*1024 })) return;
    const ext = file.name.split('.').pop().toLowerCase();

    const process = (data, fields) => {
      if (!data.length) return App.toast('Datei ist leer', 'error');
      App.toast(`${data.length} Zeilen aus "${file.name}" erkannt`, 'success');
      this.showLFKMapping(data, fields);
    };

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
          const fields = Object.keys(data[0] || {}).map(f => f.replace(/^\uFEFF/, ''));
          process(data, fields);
        } catch (err) { console.warn('Excel:', err); App.toast('Excel-Datei konnte nicht gelesen werden', 'error'); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true, skipEmptyLines: true, dynamicTyping: false,
        delimitersToGuess: [';', ',', '\t', '|'],
        complete: (results) => {
          if (results.meta.fields?.length) results.meta.fields[0] = results.meta.fields[0].replace(/^\uFEFF/, '');
          process(results.data, results.meta.fields);
        },
        error: (err) => { console.warn('CSV:', err); App.toast('CSV-Datei konnte nicht gelesen werden', 'error'); }
      });
    }
  },

  showLFKMapping(data, fields) {
    // Column patterns for auto-matching
    const lfkFieldDefs = {
      nr:               ['Nr. / BAV-Ident *',  ['nr','nr.','bav-ident','bavident','ident','ibykus','identnr','bav_ident','besch-person']],
      beschreibung:     ['Beschreibung Klasse', ['beschreibung klasse','beschreibung','klassebeschreibung','klasse']],
      landesfachklasse: ['Landesfachklasse *',  ['landesfachklasse','lfk','landesfachkl']],
    };
    const lfkKeys = Object.keys(lfkFieldDefs);

    function bestMatch(key, columns) {
      const patterns = lfkFieldDefs[key]?.[1] || [];
      for (const col of columns) { const cl = col.toLowerCase().trim(); if (patterns.includes(cl)) return col; }
      for (const col of columns) { const cl = col.toLowerCase().trim(); for (const p of patterns) { if (cl.includes(p) || p.includes(cl)) return col; } }
      return '';
    }

    const matchCount = lfkKeys.filter(f => bestMatch(f, fields)).length;
    const preview = document.getElementById('lfkImportPreview');
    preview.innerHTML = `
      <div style="margin-top:16px">
        <h4 style="font-family:var(--font-display);margin-bottom:4px">${data.length} Datensätze – Spalten zuordnen:</h4>
        <p style="font-size:12px;margin-bottom:12px;color:${matchCount >= 2 ? 'var(--clr-green)' : 'var(--clr-amber)'}">
          <strong>${matchCount} von ${lfkKeys.length}</strong> Spalten automatisch erkannt
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
          ${lfkKeys.map(f => {
            const matched = bestMatch(f, fields);
            const label = lfkFieldDefs[f][0];
            return `<div class="form-group" style="margin:0">
              <label>${label} ${matched ? '✓' : ''}</label>
              <select class="form-control" id="lfkmap_${f}" ${matched ? 'style="border-color:var(--clr-green);background:var(--clr-green-light)"' : ''}>
                <option value="">– nicht zuordnen –</option>
                ${fields.map(col => `<option value="${col}" ${col === matched ? 'selected' : ''}>${col}</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>
        <div class="card" style="margin-bottom:12px;padding:12px 16px;background:var(--clr-leaf-light);border-color:var(--clr-sage-light)">
          <strong style="font-size:13px;color:var(--clr-forest-dark)">So funktioniert der LFK-Import:</strong>
          <ul style="font-size:12px;color:var(--clr-text);margin:6px 0 0 16px;line-height:1.8">
            <li>Schüler werden anhand <strong>Nr./BAV-Ident</strong> oder <strong>Name</strong> zugeordnet</li>
            <li>Wenn <strong>Landesfachklasse ≠ Beschreibung Klasse</strong> → wird als LFK gespeichert</li>
            <li>Betroffene Fachrichtungen: Gemüse (3. AJ), Obst (2.+3. AJ), Baumschule (3. AJ), Stauden (3. AJ)</li>
            <li>Die <strong>aktuelle Schule</strong> wird dann je nach Ausbildungsjahr automatisch angezeigt</li>
          </ul>
        </div>
        <div style="overflow:auto;max-height:180px;border:1px solid var(--clr-sand);border-radius:var(--radius);margin-bottom:8px">
          <table class="data-table"><thead><tr>${fields.slice(0,6).map(f => `<th style="font-size:10px">${esc(f)}</th>`).join('')}</tr></thead><tbody>
            ${data.slice(0,5).map(row => `<tr>${fields.slice(0,6).map(f => `<td style="font-size:11px">${esc((row[f]||'').substring(0,35))}</td>`).join('')}</tr>`).join('')}
          </tbody></table>
        </div>
        <button class="btn btn-primary" onclick="ImportHandler.doImportLFK(window._lfkImportData)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Landesfachklassen importieren
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('lfkImportPreview').innerHTML=''">Abbrechen</button>
      </div>`;
    window._lfkImportData = data;
  },

  doImportLFK(data) {
    try {
    if (!data) return;
    const gm = f => document.getElementById('lfkmap_' + f)?.value || '';
    const nrCol = gm('nr');
    const beschCol = gm('beschreibung');
    const lfkCol = gm('landesfachklasse');
    if (!nrCol || !lfkCol) return App.toast('Bitte SOWOHL Nr./BAV-Ident ALS AUCH Landesfachklasse zuordnen', 'error');

    App.showLoading('Importiere Landesfachklassen…');
    let updated = 0, skipped = 0, notFound = 0, cleared = 0;

    data.forEach(row => {
      const nr = (row[nrCol] || '').toString().trim();
      const beschreibung = (row[beschCol] || '').trim();
      const lfk = (row[lfkCol] || '').trim();

      if (!nr) { skipped++; return; }

      // Landesfachklasse immer speichern wenn befüllt – das Feld in IBYKUS
      // bedeutet: Schüler ist einer Landesfachklasse zugeordnet (auch wenn
      // die Schule zufällig dieselbe ist wie die reguläre Berufsschulklasse)
      const lfkValue = lfk ? lfk.replace(/^Berufsschule\s+/i, '').trim() : '';

      // Finde Schüler: erst per ibykus_id, dann per Nr als allg. Match
      let schuelerId = App.scalar('SELECT id FROM schueler WHERE ibykus_id=? AND ibykus_id != "" AND aktiv=1', [nr]);
      if (!schuelerId) {
        // Versuche numerischen Teil als BAV-Ident zu matchen
        schuelerId = App.scalar('SELECT id FROM schueler WHERE ibykus_id LIKE ? AND aktiv=1', ['%' + nr + '%']);
      }

      if (!schuelerId) { notFound++; return; }

      const current = App.scalar('SELECT landesfachklasse FROM schueler WHERE id=?', [schuelerId]) || '';
      if (lfkValue && current !== lfkValue) {
        App.run('UPDATE schueler SET landesfachklasse=? WHERE id=?', [lfkValue, schuelerId]);
        updated++;
      } else if (!lfkValue && current) {
        // LFK wurde entfernt (Beschreibung = LFK → normal)
        App.run("UPDATE schueler SET landesfachklasse='' WHERE id=?", [schuelerId]);
        cleared++;
      } else {
        skipped++;
      }
    });

    App.hideLoading();

    let parts = [];
    if (updated) parts.push(`<strong>${updated}</strong> Schüler mit Landesfachklasse aktualisiert`);
    if (cleared) parts.push(`${cleared} Landesfachklassen entfernt (wieder normale Klasse)`);
    if (skipped) parts.push(`${skipped} unverändert/übersprungen`);
    if (notFound) parts.push(`⚠︎ ${notFound} Schüler nicht gefunden (Nr./BAV-Ident stimmt nicht überein)`);

    this._logImportHistorie({ typ: 'lfk', zeilen: data.length, aktualisiert: updated,
      uebersprungen: skipped + cleared, fehler: notFound,
      details: notFound ? [{ fehler: notFound + ' Schüler nicht gefunden (Nr./BAV-Ident)', art: 'fehler' }] : [] });
    App.openModal('LFK-Import abgeschlossen', `
      <div style="font-size:14px;line-height:2">${parts.map(s => `<div>✓ ${s}</div>`).join('')}</div>
    `, `<button class="btn btn-primary" onclick="App.closeModal();Views.importView()">OK</button>`);
    document.getElementById('lfkImportPreview').innerHTML = '';
    } catch(e) {
      console.error('doImportLFK:', e);
      App.toast('Import fehlgeschlagen: ' + (e.message || e), 'error');
    } finally {
      App.hideLoading();
    }
  },

  // ═══════════════════════════════════════════
  //  AUSBILDER-IMPORT
  // ═══════════════════════════════════════════
  handleAusbilderFile(file) {
    if (!file) return;
    if (!_validateFile(file, { extensions: ['csv','txt','xlsx','xls'], maxSize: 50*1024*1024 })) return;
    const ext = file.name.split('.').pop().toLowerCase();

    const process = (data, fields) => {
      if (!data.length) return App.toast('Datei ist leer', 'error');
      // Auto-map columns
      const patterns = {
        betriebsnummer: ['betriebsnummer','betriebsnr','betriebs-nr','bnr'],
        betriebsname: ['betriebsname','betrieb','firma','ausbildungsstaette','ausbildungsstätte','name betrieb'],
        betrieb_ort: ['betrieb-ort','betriebsort','ort'],
        nachname: ['nachname','name','familienname','ausbilder-nachname','ausbilder nachname'],
        vorname: ['vorname','vname','ausbilder-vorname','ausbilder vorname'],
        telefon: ['telefon','tel','phone','ausbilder-tel'],
        email: ['email','e-mail','mail','ausbilder-email'],
        mobil: ['mobil','handy','mobiltelefon','ausbilder-mobil'],
        funktion: ['funktion','rolle','position','tätigkeit','taetigkeit','ausbilder-funktion']
      };
      const bestMatch = (key) => {
        const pats = patterns[key] || [];
        for (const f of fields) {
          const fl = f.toLowerCase().trim();
          if (pats.includes(fl)) return f;
        }
        for (const f of fields) {
          const fl = f.toLowerCase().trim();
          for (const p of pats) { if (fl.includes(p) || p.includes(fl)) return f; }
        }
        return '';
      };
      const mapFields = ['betriebsnummer','betriebsname','betrieb_ort','nachname','vorname','telefon','email','mobil','funktion'];
      const autoMap = {};
      mapFields.forEach(k => autoMap[k] = bestMatch(k));

      const preview = document.getElementById('ausbilderImportPreview');
      if (!preview) return;
      preview.innerHTML = `<div class="card" style="margin-top:12px">
        <div class="card-header">Ausbilder-Import: Spaltenzuordnung</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${mapFields.map(k => `<div class="form-group" style="margin:0"><label style="font-size:11px">${k.replace(/_/g,' ')}</label><select class="form-control" id="aumap_${k}" style="font-size:12px"><option value="">– Nicht zuordnen –</option>${fields.map(f=>`<option value="${esc(f)}" ${autoMap[k]===f?'selected':''}>${esc(f)}</option>`).join('')}</select></div>`).join('')}
        </div>
        <div style="overflow:auto;max-height:160px;border:1px solid var(--clr-sand);border-radius:var(--radius);margin-bottom:8px">
          <table class="data-table"><thead><tr>${fields.slice(0,8).map(f=>`<th style="font-size:10px">${esc(f)}</th>`).join('')}</tr></thead><tbody>
          ${data.slice(0,5).map(row=>`<tr>${fields.slice(0,8).map(f=>`<td style="font-size:11px">${esc((row[f]||'').toString().substring(0,30))}</td>`).join('')}</tr>`).join('')}
          </tbody></table>
        </div>
        <div style="font-size:11px;color:var(--clr-text-light);margin-bottom:8px">${data.length} Zeilen erkannt</div>
        <button class="btn btn-primary" onclick="ImportHandler.doImportAusbilder(window._ausbilderImportData)">Ausbilder importieren</button>
        <button class="btn btn-secondary" onclick="document.getElementById('ausbilderImportPreview').innerHTML=''">Abbrechen</button>
      </div>`;
      window._ausbilderImportData = data;
    };

    if (ext === 'csv' || ext === 'txt') {
      const reader = new FileReader();
      reader.onload = e => {
        const result = Papa.parse(e.target.result, { header: true, skipEmptyLines: true, encoding: 'UTF-8' });
        process(result.data, result.meta.fields || []);
      };
      reader.readAsText(file, 'UTF-8');
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const fields = data.length ? Object.keys(data[0]) : [];
        process(data, fields);
      };
      reader.readAsArrayBuffer(file);
    }
  },

  doImportAusbilder(data) {
    try {
    if (!data) return;
    const gm = f => document.getElementById('aumap_' + f)?.value || '';
    const bnrCol = gm('betriebsnummer');
    const bnameCol = gm('betriebsname');
    const bortCol = gm('betrieb_ort');
    const nachCol = gm('nachname');
    const vorCol = gm('vorname');
    const telCol = gm('telefon');
    const emailCol = gm('email');
    const mobilCol = gm('mobil');
    const funkCol = gm('funktion');

    if (!nachCol && !vorCol) return App.toast('Mindestens Nachname oder Vorname muss zugeordnet sein', 'error');
    if (!bnrCol && !bnameCol) return App.toast('Betriebsnummer oder Betriebsname muss zugeordnet sein', 'error');

    App.showLoading('Importiere Ausbilder...');
    let imported = 0, updated = 0, skipped = 0, noMatch = 0;

    data.forEach(row => {
      const nachname = (row[nachCol] || '').trim();
      const vorname = (row[vorCol] || '').trim();
      if (!nachname && !vorname) { skipped++; return; }

      // Find Betrieb
      const bnr = (row[bnrCol] || '').toString().trim();
      const bname = (row[bnameCol] || '').trim();
      const bort = (row[bortCol] || '').trim();

      let betriebId = null;
      if (bnr) betriebId = App.scalar('SELECT id FROM betriebe WHERE betriebsnummer=?', [bnr]);
      if (!betriebId && bname) {
        if (bort) betriebId = App.scalar('SELECT id FROM betriebe WHERE name=? AND ort=?', [bname, bort]);
        if (!betriebId) betriebId = App.scalar('SELECT id FROM betriebe WHERE name=?', [bname]);
      }
      if (!betriebId) { noMatch++; return; }

      const telefon = (row[telCol] || '').trim();
      const email = (row[emailCol] || '').trim();
      const mobil = (row[mobilCol] || '').trim();
      const funktion = (row[funkCol] || '').trim();

      // Duplikat-Prüfung
      const existing = App.query('SELECT * FROM ausbilder WHERE betrieb_id=? AND nachname=? AND vorname=?', [betriebId, nachname, vorname])[0];
      if (existing) {
        // Update if new data
        const changes = [];
        if (telefon && telefon !== existing.telefon) changes.push(['telefon', telefon]);
        if (email && email !== existing.email) changes.push(['email', email]);
        if (mobil && mobil !== existing.mobil) changes.push(['mobil', mobil]);
        if (funktion && funktion !== existing.funktion) changes.push(['funktion', funktion]);
        if (changes.length) {
          changes.forEach(([f, v]) => App.run(`UPDATE ausbilder SET ${f}=? WHERE id=?`, [v, existing.id]));
          updated++;
        } else { skipped++; }
        return;
      }

      App.run('INSERT INTO ausbilder (betrieb_id,nachname,vorname,telefon,email,mobil,funktion) VALUES (?,?,?,?,?,?,?)',
        [betriebId, nachname, vorname, telefon, email, mobil, funktion]);
      imported++;
    });

    App.hideLoading();
    let parts = [];
    if (imported) parts.push(`<strong>${imported}</strong> Ausbilder importiert`);
    if (updated) parts.push(`<strong>${updated}</strong> Ausbilder aktualisiert`);
    if (skipped) parts.push(`${skipped} unverändert/übersprungen`);
    if (noMatch) parts.push(`${noMatch} Betriebe nicht gefunden`);

    this._logImportHistorie({ typ: 'ausbilder', zeilen: (data || []).length, neu: imported,
      aktualisiert: typeof updated !== 'undefined' ? updated : 0,
      uebersprungen: typeof skipped !== 'undefined' ? skipped : 0, fehler: 0, details: [] });
    App.openModal('Ausbilder-Import abgeschlossen', `
      <div style="font-size:14px;line-height:2">${parts.map(s => `<div>${s}</div>`).join('')}</div>
    `, `<button class="btn btn-primary" onclick="App.closeModal();Views.importView()">OK</button>`);
    const preview = document.getElementById('ausbilderImportPreview');
    if (preview) preview.innerHTML = '';
    } catch(e) {
      console.error('doImportAusbilder:', e);
      App.toast('Import fehlgeschlagen: ' + (e.message || e), 'error');
    } finally {
      App.hideLoading();
    }
  },

  deleteAllJahrgang() {
    const jg = SchuelerView.filters.jahrgang;
    if (!jg) return App.toast('Bitte zuerst einen Jahrgang im Filter wählen', 'warning');
    const jgName = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jg]);
    const count = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=?', [jg]) || 0;
    if (!count) return App.toast('Keine Schüler zum Löschen', 'warning');
    if (!confirm(`Wirklich ALLE ${count} Schüler im Jahrgang "${jgName}" löschen?\n\nDies löscht auch zugehörige Kontrollergebnisse und Wiedervorlagen.\n\nDanach kann die CSV neu importiert werden.`)) return;
    // Über die zentralen Kaskaden löschen: die frühere Aufzählung ließ
    // kw_status, Snapshots, Phasen, Bemerkungen und Dateien verwaist zurück –
    // diese verfälschten anschließend die Mängelcode-Statistik im Jahresbericht.
    App.query('SELECT id FROM kontrolltermine WHERE jahrgang_id=?', [jg]).forEach(t => App.deleteTerminKaskade(t.id));
    App.query('SELECT id FROM schueler WHERE jahrgang_id=?', [jg]).forEach(x => App.deleteSchuelerKaskade(x.id));
    App.query('SELECT id FROM klassen WHERE jahrgang_id=?', [jg]).forEach(k => App.deleteKlasseKaskade(k.id));
    App.toast(`${count} Schüler + zugehörige Daten gelöscht. CSV kann neu importiert werden.`, 'success');
    try { SchuelerView.render(); } catch(e) {}
  },
};
