const ImportHandler = {
  handleFile(file) {
    if (!file) return;
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
          this.showMapping(data, fields);
        } catch (err) {
          App.toast('Excel-Fehler: ' + err.message, 'error');
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
          this.showMapping(results.data, results.meta.fields);
        },
        error: (err) => App.toast('CSV-Fehler: ' + err.message, 'error')
      });
    }
  },

  showMapping(data, fields) {
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

    function bestMatch(fieldKey, columns) {
      const patterns = fieldDefs[fieldKey]?.[1] || [];
      for (const col of columns) { const cl = col.toLowerCase().trim(); if (patterns.includes(cl)) return col; }
      for (const col of columns) { const cl = col.toLowerCase().trim(); for (const p of patterns) { if (cl.includes(p) || p.includes(cl)) return col; } }
      return '';
    }

    const matchCount = fieldKeys.filter(f => bestMatch(f, fields)).length;
    const preview = document.getElementById('importPreview');
    preview.innerHTML = `
      <div style="margin-top:16px">
        <h4 style="font-family:var(--font-display);margin-bottom:4px">${data.length} Datensätze erkannt – Spalten zuordnen:</h4>
        <p style="font-size:12px;margin-bottom:12px;color:${matchCount >= 8 ? 'var(--clr-green)' : 'var(--clr-amber)'}">
          <strong>${matchCount} von ${fieldKeys.length}</strong> Spalten automatisch erkannt
          ${matchCount >= fieldKeys.length ? ' – alle Felder zugeordnet ✓' : ' – bitte restliche prüfen'}
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${fieldKeys.map(f => {
            const matched = bestMatch(f, fields);
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
          <strong style="font-size:13px;color:var(--clr-forest-dark)">🤖 Vollautomatische Zuordnung:</strong>
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
          <summary style="cursor:pointer;font-size:12px;color:var(--clr-forest);font-weight:600;padding:4px 0">🔍 Vorschau: So werden die Daten interpretiert (erste 3)</summary>
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

  async doImport(data) {
    if (!data) return;
    App.showLoading('Importiere Schülerdaten…');
    // Disable dirty-tracking during bulk import (full-write at end)
    App._bulkImport = true;
    if (App.autoSaveTimer) clearTimeout(App.autoSaveTimer);
    const getMap = f => document.getElementById('map_' + f)?.value || '';
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
    function parseD(t) {
      if (!t) return null;
      let m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) return new Date(+m[3], m[2]-1, +m[1]);
      m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return new Date(+m[1], m[2]-1, +m[3]);
      const d = new Date(t); return isNaN(d) ? null : d;
    }

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
        // Update contact data if we have more info now
        if (email && !b.email) App.run('UPDATE betriebe SET email=? WHERE id=?', [email, b.id]);
        if (tel && !b.telefon) App.run('UPDATE betriebe SET telefon=? WHERE id=?', [tel, b.id]);
        if (bVorname && !b.vorname) App.run('UPDATE betriebe SET vorname=? WHERE id=?', [bVorname, b.id]);
        if (zusatz && !b.zusatzbezeichnung) App.run('UPDATE betriebe SET zusatzbezeichnung=? WHERE id=?', [zusatz, b.id]);
        return b.id;
      }
      // Create new
      App.run('INSERT INTO betriebe (betriebsnummer,name,vorname,zusatzbezeichnung,firma,ansprechpartner,strasse,plz,ort,telefon,fax,email) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [bnr, name, bVorname, zusatz, zusatz, bVorname, strasse, plz, ort, tel, fax, email]);
      const n = App.query('SELECT id FROM betriebe WHERE rowid=last_insert_rowid()');
      return n.length ? n[0].id : null;
    }

    // ═══ MAIN IMPORT LOOP ═══
    let jgCounter = {}; // Track which jahrgang gets most students
    let noKlasseCount = 0;
    data.forEach(row => {
      const nachname = (row[getMap('nachname')]||'').trim();
      const vorname = (row[getMap('vorname')]||'').trim();
      if (!nachname || !vorname) { skipped++; return; }

      const betrieb   = buildBetrieb(row);
      const betriebId = getOrCreateBetrieb(row);
      const berufCode = (row[getMap('beruf_code')]||'').trim();
      const abegRaw   = (row[getMap('ausbildungsbeginn')]||'').trim();
      const aendRaw   = (row[getMap('ausbildungsende')]||'').trim();
      // Convert DD.MM.YYYY to ISO YYYY-MM-DD for correct Date parsing everywhere
      const abeg = (() => { const d = parseD(abegRaw); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : abegRaw; })();
      const aend = (() => { const d = parseD(aendRaw); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : aendRaw; })();
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
      if (!existingId && nachname && vorname) existingId = App.scalar('SELECT id FROM schueler WHERE nachname=? AND vorname=? AND jahrgang_id=?', [nachname,vorname,jgId]);

      if (existingId) {
        // Check if data changed → update
        const ex = App.query('SELECT * FROM schueler WHERE id=?', [existingId])[0];
        const changes = [];
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
          if (ex.status !== bavStatus) changes.push(['status', bavStatus, ex.status]);
          if (bavAktiv === 0 && ex.aktiv === 1) {
            const today = new Date().toISOString().slice(0,10);
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

        if (changes.length) {
          changes.forEach(([field, newVal]) => {
            App.run(`UPDATE schueler SET ${field}=? WHERE id=?`, [newVal, existingId]);
          });
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
    });

    // ── AUTO-SWITCH to the Jahrgang with most imported students ──
    if (imported > 0) {
      const mostUsedJgId = Object.entries(jgCounter).sort((a,b) => b[1]-a[1])[0]?.[0];
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
    if (stats.frNotFound.size) parts.push(`⚠️ Unbekannte Beruf-Codes: ${[...stats.frNotFound].join(', ')}`);
    if (stats.bavEnde) parts.push(`⚠️ <strong>${stats.bavEnde}</strong> Auszubildende als inaktiv markiert (BAV-Status: ENDE)`);
    if (stats.bavReaktiviert) parts.push(`✅ <strong>${stats.bavReaktiviert}</strong> Auszubildende reaktiviert (BAV-Status wieder aktiv)`);
    if (noKlasseCount > 0) parts.push(`⚠️ ${noKlasseCount} Schüler ohne Klassenzuordnung (fehlende Daten: Schule/Beruf/AV-Beginn)`);

    // Re-enable dirty-tracking
    App._bulkImport = false;
    // Full-write: export entire in-memory DB to disk (no merge-replay needed)
    if (App.dbFileHandle) {
      try { await App.fullSave(); } catch(e) { console.warn('Post-import save:', e); }
    }

    App.hideLoading();
    // Log import in einstellungen
    const history = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='import_history'") || '[]');
    history.unshift({ datum: new Date().toISOString(), importiert: imported, uebersprungen: skipped, zeilen: data.length });
    if (history.length > 20) history.length = 20;
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('import_history',?)", [JSON.stringify(history)]);

    App.openModal('Import abgeschlossen', `
      <div style="font-size:14px;line-height:2">${parts.map(s => `<div>✓ ${s}</div>`).join('')}</div>
      ${stats.klassen.size ? `<div style="margin-top:12px;padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;max-height:200px;overflow-y:auto">
        <strong>Erstellte Klassen:</strong><br>${[...stats.klassen].map(k => `• ${k}`).join('<br>')}</div>` : ''}
    `, `<button class="btn btn-primary" onclick="App.closeModal();Views.importView()">OK</button>`);
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
        <div class="form-group"><label>📞 Telefon</label><input class="form-control" id="mSTelefon" placeholder="Mobil/Festnetz"></div>
        <div class="form-group"><label>📧 E-Mail</label><input class="form-control" id="mSEmail" placeholder="azubi@email.de"></div>
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

    App.openModal(`${ampel.icon} ${s.nachname}, ${s.vorname}`, `
      <!-- Quick-Info Bar -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;font-size:11px">
        <span style="padding:3px 8px;background:var(--clr-blue-light);border-radius:10px">${keCount} Kontrollen</span>
        ${wvCount ? `<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:10px;color:var(--clr-red)">${wvCount} offene WV</span>` : ''}
        <span style="padding:3px 8px;background:${fehlGesamt>=77?'var(--clr-red-light)':'var(--clr-warm)'};border-radius:10px">${fehlGesamt} Fehltage</span>
        ${klasse ? `<span style="padding:3px 8px;background:var(--clr-green-light);border-radius:10px">${esc(klasse.schule)}</span>` : ''}
        ${s.landesfachklasse ? `<span style="padding:3px 8px;background:#e8d5f5;border-radius:10px;color:#7b2fa0">LFK: ${esc(s.landesfachklasse)}</span>` : ''}
        ${betrieb?.email ? `<span style="padding:3px 8px;background:var(--clr-warm);border-radius:10px">📧 ${esc(betrieb.email)}</span>` : ''}
      </div>

      <div class="form-row">
        <div class="form-group"><label>Nachname *</label><input class="form-control" id="mSNach" value="${esc(s.nachname)}"></div>
        <div class="form-group"><label>Vorname *</label><input class="form-control" id="mSVor" value="${esc(s.vorname)}"></div>
      </div>
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
        <div class="form-group"><label>Klasse → Schule</label><select class="form-control" id="mSKlasse">
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
        <div class="form-group"><label>Zuständiges Amt</label><select class="form-control" id="mSAmt">
          <option value="">–</option>${Object.entries(App.AEMTER).map(([code,name])=>`<option value="${code}" ${s.zustaendiges_amt===code?'selected':''}>${code} ${esc(name)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Ausbildungsbeginn</label><input type="date" class="form-control" id="mSBeginn" value="${s.ausbildungsbeginn||''}"></div>
        <div class="form-group"><label>Ausbildungsende</label><input type="date" class="form-control" id="mSEnde" value="${s.ausbildungsende||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>🏫 Landesfachklasse</label><input class="form-control" id="mSLFK" value="${esc(s.landesfachklasse||'')}" placeholder="Nur bei abweichender Berufsschule (Gemüse, Obst, Baumschule, Stauden)" style="font-size:11px"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>📞 Telefon</label><input class="form-control" id="mSTelefon" value="${esc(s.telefon||'')}" placeholder="Mobil/Festnetz"></div>
        <div class="form-group"><label>📧 E-Mail</label><input class="form-control" id="mSEmail" value="${esc(s.email||'')}" placeholder="azubi@email.de"></div>
      </div>

      <hr style="margin:12px 0;border-color:var(--clr-sand)">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--clr-forest)">Status & AP-Zulassung</div>
      <div class="form-row">
        <div class="form-group"><label>Status</label><select class="form-control" id="mSStatus">
          ${Object.entries(statusLabels).map(([v,l])=>`<option value="${v}" ${(s.status||'aktiv')===v?'selected':''}>${l}</option>`).join('')}
        </select></div>
        <div class="form-group" style="display:flex;flex-direction:column;gap:6px;padding-top:20px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="mSAPZu" ${s.ap_zugelassen?'checked':''} style="width:18px;height:18px;accent-color:var(--clr-forest)"> AP zugelassen
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="mSAPBe" ${s.ap_bestanden?'checked':''} style="width:18px;height:18px;accent-color:var(--clr-green)"> AP bestanden
          </label>
        </div>
      </div>
      ${(s.status !== 'aktiv' && s.status) ? `<div class="form-row">
        <div class="form-group"><label>Inaktiv seit</label><input type="date" class="form-control" id="mSInaktivDatum" value="${s.inaktiv_datum||''}"></div>
        <div class="form-group"><label>Grund</label><input class="form-control" id="mSInaktivGrund" value="${esc(s.inaktiv_grund||'')}"></div>
      </div>` : '<input type="hidden" id="mSInaktivDatum" value=""><input type="hidden" id="mSInaktivGrund" value="">'}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        ${s.aktiv ? `<button class="btn btn-danger btn-sm" onclick="ImportHandler.setInaktiv(${id})">Inaktiv setzen</button>` : `<button class="btn btn-success btn-sm" onclick="ImportHandler.setAktiv(${id})">Reaktivieren</button>`}
        <button class="btn btn-primary" onclick="ImportHandler.updateSchueler(${id})">Speichern</button>`);
  },
  updateSchueler(id) {
    const n = document.getElementById('mSNach').value.trim();
    const v = document.getElementById('mSVor').value.trim();
    if (!n || !v) return App.toast('Name und Vorname sind Pflichtfelder', 'error');
    const status = document.getElementById('mSStatus').value;
    const aktiv = (status === 'aktiv' || status === 'ap_zugelassen') ? 1 : 0;
    App.run(`UPDATE schueler SET nachname=?,vorname=?,ausbildungsstaette=?,fachrichtung_id=?,klasse_id=?,
      betrieb_id=?,jahrgang_id=?,ibykus_id=?,ausbildungsbeginn=?,ausbildungsende=?,
      telefon=?,email=?,zustaendiges_amt=?,landesfachklasse=?,
      status=?,aktiv=?,ap_zugelassen=?,ap_bestanden=?,inaktiv_grund=?,inaktiv_datum=? WHERE id=?`,
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
       document.getElementById('mSInaktivDatum')?.value || '', id]);
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    // Also refresh Azubi-Tab if visible under Stammdaten
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler aktualisiert', 'success');
  },
  setInaktiv(id) {
    const today = new Date().toISOString().split('T')[0];
    App.run("UPDATE schueler SET aktiv=0, status='ap_bestanden', inaktiv_datum=? WHERE id=?", [today, id]);
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler auf inaktiv gesetzt', 'success');
  },
  setAktiv(id) {
    App.run("UPDATE schueler SET aktiv=1, status='aktiv', inaktiv_datum='', inaktiv_grund='' WHERE id=?", [id]);
    App.closeModal();
    try { SchuelerView.render(); } catch(e) {}
    const sc = document.getElementById('stammdatenContent');
    if (sc && sc.innerHTML.includes('data-table')) StammdatenTab.azubis(sc);
    App.toast('Schüler reaktiviert', 'success');
  },
  deleteSchueler(id) {
    if (!confirm('Schüler wirklich löschen?')) return;
    App.run('DELETE FROM schueler WHERE id=?', [id]);
    try { SchuelerView.render(); } catch(e) {}
  },
  // ═══════════════════════════════════════════
  //  LANDESFACHKLASSE-IMPORT
  // ═══════════════════════════════════════════
  handleLFKFile(file) {
    if (!file) return;
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
        } catch (err) { App.toast('Excel-Fehler: ' + err.message, 'error'); }
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
        error: (err) => App.toast('CSV-Fehler: ' + err.message, 'error')
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
    if (!data) return;
    const gm = f => document.getElementById('lfkmap_' + f)?.value || '';
    const nrCol = gm('nr');
    const beschCol = gm('beschreibung');
    const lfkCol = gm('landesfachklasse');
    if (!nrCol && !lfkCol) return App.toast('Bitte mindestens Nr./BAV-Ident und Landesfachklasse zuordnen', 'error');

    App.showLoading('Importiere Landesfachklassen…');
    let updated = 0, skipped = 0, notFound = 0, cleared = 0;

    data.forEach(row => {
      const nr = (row[nrCol] || '').toString().trim();
      const beschreibung = (row[beschCol] || '').trim();
      const lfk = (row[lfkCol] || '').trim();

      if (!nr) { skipped++; return; }

      // Landesfachklasse nur speichern wenn sie von der regulären Klasse abweicht
      let lfkValue = '';
      if (lfk && beschreibung) {
        // Normalisiere: "Berufsschule XY" → extrahiere nur den Schulnamen
        const normBeschr = beschreibung.replace(/^Berufsschule\s+/i, '').trim().toLowerCase();
        const normLfk = lfk.replace(/^Berufsschule\s+/i, '').trim().toLowerCase();
        if (normBeschr !== normLfk) {
          lfkValue = lfk.replace(/^Berufsschule\s+/i, '').trim();
        }
      } else if (lfk && !beschreibung) {
        lfkValue = lfk.replace(/^Berufsschule\s+/i, '').trim();
      }

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
    if (notFound) parts.push(`⚠️ ${notFound} Schüler nicht gefunden (Nr./BAV-Ident stimmt nicht überein)`);

    App.openModal('LFK-Import abgeschlossen', `
      <div style="font-size:14px;line-height:2">${parts.map(s => `<div>✓ ${s}</div>`).join('')}</div>
    `, `<button class="btn btn-primary" onclick="App.closeModal();Views.importView()">OK</button>`);
    document.getElementById('lfkImportPreview').innerHTML = '';
  },

  deleteAllJahrgang() {
    const jg = SchuelerView.filters.jahrgang;
    if (!jg) return App.toast('Bitte zuerst einen Jahrgang im Filter wählen', 'warning');
    const jgName = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jg]);
    const count = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=?', [jg]) || 0;
    if (!count) return App.toast('Keine Schüler zum Löschen', 'warning');
    if (!confirm(`Wirklich ALLE ${count} Schüler im Jahrgang "${jgName}" löschen?\n\nDies löscht auch zugehörige Kontrollergebnisse und Wiedervorlagen.\n\nDanach kann die CSV neu importiert werden.`)) return;
    // Delete related data
    App.run(`DELETE FROM kw_maengel WHERE kontrollergebnis_id IN (SELECT ke.id FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE kt.jahrgang_id=?)`, [jg]);
    App.run(`DELETE FROM wiedervorlage_notizen WHERE wiedervorlage_id IN (SELECT w.id FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE s.jahrgang_id=?)`, [jg]);
    App.run(`DELETE FROM wiedervorlagen WHERE schueler_id IN (SELECT id FROM schueler WHERE jahrgang_id=?)`, [jg]);
    App.run(`DELETE FROM kontrollergebnisse WHERE kontrolltermin_id IN (SELECT id FROM kontrolltermine WHERE jahrgang_id=?)`, [jg]);
    App.run(`DELETE FROM kontrolltermin_klassen WHERE kontrolltermin_id IN (SELECT id FROM kontrolltermine WHERE jahrgang_id=?)`, [jg]);
    App.run('DELETE FROM kontrolltermine WHERE jahrgang_id=?', [jg]);
    App.run('DELETE FROM klassen WHERE jahrgang_id=?', [jg]);
    App.run('DELETE FROM schueler WHERE jahrgang_id=?', [jg]);
    App.toast(`${count} Schüler + zugehörige Daten gelöscht. CSV kann neu importiert werden.`, 'success');
    try { SchuelerView.render(); } catch(e) {}
  },
};
