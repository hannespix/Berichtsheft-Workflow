// ╔══════════════════════════════════════════════════════════════╗
// ║  VIEWS                                                       ║
// ╚══════════════════════════════════════════════════════════════╝

const Views = {

  // ════════════════════════════════════════════
  //  DASHBOARD
  // ════════════════════════════════════════════
  _updateKontrollstatus() {
    const slider = document.getElementById('kontrollMonateSlider');
    const label = document.getElementById('kontrollMonateLabel');
    const countEl = document.getElementById('kontrollStatusCount');
    const tableEl = document.getElementById('kontrollStatusTable');
    if (!slider || !tableEl) return;
    const monate = parseInt(slider.value);
    const gf = App.gf('schueler');

    if (monate === 0) {
      // Noch NIE kontrolliert
      label.textContent = 'noch nie';
      const rows = App.query(`SELECT s.id, s.nachname, s.vorname, COALESCE(b.name, s.ausbildungsstaette) as betrieb,
        CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
        j.bezeichnung as jahrgang
        FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
        LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
        WHERE s.aktiv=1 AND s.id NOT IN (SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE ergebnis != '') ${gf}
        ORDER BY s.nachname LIMIT 30`);
      const total = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.id NOT IN (SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE ergebnis != '') ${gf}`) || 0;
      countEl.textContent = total + ' Schüler noch nie kontrolliert';
      this._renderKontrollstatusTable(tableEl, rows, total);
    } else {
      // Letzte Kontrolle > X Monate her
      label.textContent = monate + (monate === 1 ? ' Monat' : ' Monaten');
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - monate);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const rows = App.query(`SELECT s.id, s.nachname, s.vorname, COALESCE(b.name, s.ausbildungsstaette) as betrieb,
        CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
        j.bezeichnung as jahrgang,
        (SELECT MAX(kt.geplant_datum) FROM kontrollergebnisse ke2 JOIN kontrolltermine kt ON ke2.kontrolltermin_id=kt.id WHERE ke2.schueler_id=s.id AND ke2.ergebnis != '') as letzte_kontrolle
        FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
        LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
        WHERE s.aktiv=1 ${gf}
        AND (s.id NOT IN (SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE ergebnis != '')
          OR s.id IN (SELECT ke3.schueler_id FROM kontrollergebnisse ke3 JOIN kontrolltermine kt3 ON ke3.kontrolltermin_id=kt3.id
            WHERE ke3.ergebnis != '' GROUP BY ke3.schueler_id HAVING MAX(kt3.geplant_datum) < ?))
        ORDER BY letzte_kontrolle ASC, s.nachname LIMIT 30`, [cutoffStr]);
      const total = rows.length >= 30 ? '30+' : rows.length;
      countEl.textContent = total + ' Schüler';
      this._renderKontrollstatusTable(tableEl, rows, typeof total === 'number' ? total : 30, true);
    }
  },

  _renderKontrollstatusTable(el, rows, total, showDate) {
    if (!rows.length) {
      el.innerHTML = '<div style="padding:12px;text-align:center;color:var(--clr-green);font-size:13px">✓ Alle Schüler im Zeitraum kontrolliert!</div>';
      return;
    }
    el.innerHTML = `<table class="data-table"><thead><tr>
      <th>Name</th><th>Betrieb</th><th>FR</th><th>Jahrgang</th>${showDate ? '<th>Letzte Kontrolle</th>' : ''}
    </tr></thead><tbody>
      ${rows.map(s => `<tr>
        <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}</td>
        <td>${esc(s.betrieb || '–')}</td>
        <td><small>${esc(s.fachrichtung || '–')}</small></td>
        <td>${esc(s.jahrgang || '–')}</td>
        ${showDate ? `<td>${s.letzte_kontrolle ? formatDate(s.letzte_kontrolle) : '<span style="color:var(--clr-red)">nie</span>'}</td>` : ''}
      </tr>`).join('')}
    </tbody></table>
    ${total > 30 ? `<div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">Zeigt max. 30 von ${total}</div>` : ''}`;
  },

  dashboard() {
    const today = new Date().toISOString().split('T')[0];
    const jf = App.jgWhere('s.jahrgang_id');
    const jfkt = App.jgWhere('kt.jahrgang_id');

    const totalSchueler = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1${jf.where}`, jf.params) || 0;
    const kontrolliertIds = App.query(`SELECT DISTINCT ke.schueler_id FROM kontrollergebnisse ke JOIN schueler s ON ke.schueler_id=s.id WHERE ke.ergebnis != ''${jf.where}`, jf.params);
    const kontrolliert = kontrolliertIds.length;
    const offeneWV = App.scalar(`SELECT COUNT(*) FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.status='offen'${jf.where}`, jf.params) || 0;
    const ueberfaellig = App.scalar(`SELECT COUNT(*) FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.status='offen' AND w.frist_datum < ?${jf.where}`, [today, ...jf.params]) || 0;


    const naechsteTermine = App.query(`SELECT kt.*, kt.id as termin_id
      FROM kontrolltermine kt
      WHERE kt.status='geplant' AND kt.geplant_datum >= ?${jfkt.where}
      ORDER BY kt.geplant_datum LIMIT 5`, [today, ...jfkt.params]);
    App.preloadTerminKlassen(naechsteTermine.map(t => t.id));

    const ueberfaelligeWV = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette
      FROM wiedervorlagen w
      JOIN schueler s ON w.schueler_id=s.id
      WHERE w.status='offen' AND w.frist_datum < ?${jf.where}
      ORDER BY w.frist_datum LIMIT 10`, [today, ...jf.params]);

    // Betrieb-Ranking: Betriebe mit den meisten Mängeln
    const betriebRanking = App.query(`SELECT COALESCE(b.name, s.ausbildungsstaette) as betrieb, s.betrieb_id,
      COUNT(DISTINCT s.id) as azubi_count,
      COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN ke.id END) as maengel_count,
      COUNT(DISTINCT CASE WHEN w.status IN ('offen','ueberfaellig') THEN w.id END) as offene_wv
      FROM schueler s
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN kontrollergebnisse ke ON ke.schueler_id=s.id
      LEFT JOIN wiedervorlagen w ON w.schueler_id=s.id
      WHERE s.aktiv=1${jf.where}
      GROUP BY COALESCE(b.id, s.ausbildungsstaette)
      HAVING maengel_count > 0
      ORDER BY maengel_count DESC, offene_wv DESC
      LIMIT 15`, jf.params);

    // Morgen-Briefing data
    const naechste7Tage = App.query(`SELECT COUNT(*) as c FROM kontrolltermine kt WHERE kt.status='geplant' AND kt.geplant_datum BETWEEN ? AND ?${jfkt.where}`, [today, new Date(Date.now()+7*86400000).toISOString().split('T')[0], ...jfkt.params])[0]?.c || 0;
    const bald_ueberfaellig = App.query(`SELECT COUNT(*) as c FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.status='offen' AND w.frist_datum BETWEEN ? AND ?${jf.where}`, [today, new Date(Date.now()+3*86400000).toISOString().split('T')[0], ...jf.params])[0]?.c || 0;
    // Datenpflege
    const ohneBetrieb = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.betrieb_id IS NULL AND s.ausbildungsstaette != '' AND s.aktiv=1${jf.where}`, jf.params) || 0;
    const gfSch = App.gf('schulen');
    const ohneEmail = App.scalar(`SELECT COUNT(*) FROM berufsschulen bs WHERE (bs.email = '' OR bs.email IS NULL)${gfSch}`) || 0;
    const gfBet = App.gf('betriebe');
    const betriebOhneEmail = App.scalar(`SELECT COUNT(*) FROM betriebe b WHERE b.email = '' AND (SELECT COUNT(*) FROM schueler sq WHERE sq.betrieb_id=b.id AND sq.aktiv=1) > 0${gfBet}`) || 0;

    const mc = document.getElementById('mainContent');
    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Dashboard</h2>
        <p>Gesamtübersicht</p>
      </div>
      ${App.filterBadgeHtml()}

      <!-- Morgen-Briefing -->
      ${(naechste7Tage || bald_ueberfaellig || ueberfaellig) ? `
      <div class="card" style="margin-bottom:20px;border-left:4px solid var(--clr-forest);padding:14px 18px">
        <strong style="font-size:14px;color:var(--clr-forest-dark)">📋 Was steht an?</strong>
        <div class="dash-briefing" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:13px">
          ${naechste7Tage ? `<span style="padding:5px 12px;background:var(--clr-blue-light);border-radius:var(--radius);cursor:pointer" onclick="App.navigate('planung')">📅 <strong>${naechste7Tage}</strong> Termin${naechste7Tage>1?'e':''} in den nächsten 7 Tagen</span>` : ''}
          ${ueberfaellig ? `<span style="padding:5px 12px;background:var(--clr-red-light);border-radius:var(--radius);cursor:pointer" onclick="App.navigate('wiedervorlagen')">🔴 <strong>${ueberfaellig}</strong> Wiedervorlage${ueberfaellig>1?'n':''} überfällig!</span>` : ''}
          ${bald_ueberfaellig ? `<span style="padding:5px 12px;background:var(--clr-amber-light);border-radius:var(--radius);cursor:pointer" onclick="App.navigate('wiedervorlagen')">⚠ <strong>${bald_ueberfaellig}</strong> WV laufen in 3 Tagen ab</span>` : ''}
        </div>
      </div>` : ''}

      <!-- Stat Cards -->
      <div class="grid-4" style="margin-bottom:20px">
        <div class="stat-card stat-info" style="cursor:pointer" onclick="App.navigate('import')" title="Klick → Azubi-Import / Stammdaten">
          <div class="stat-label">Schüler gesamt</div>
          <div class="stat-value">${totalSchueler}</div>
          <div class="stat-sub">Aktive Auszubildende →</div>
        </div>
        <div class="stat-card stat-success" style="cursor:pointer" onclick="App.navigate('berichte')" title="Klick → Berichte & Export">
          <div class="stat-label">Kontrolliert</div>
          <div class="stat-value">${kontrolliert}</div>
          <div class="stat-sub">${totalSchueler ? Math.round(kontrolliert/totalSchueler*100) : 0}% Abdeckung → Berichte</div>
        </div>
        <div class="stat-card stat-warning" style="cursor:pointer" onclick="App.navigate('wiedervorlagen')" title="Klick → Wiedervorlagen anzeigen">
          <div class="stat-label">Offene Wiedervorlagen</div>
          <div class="stat-value">${offeneWV}</div>
          <div class="stat-sub">Ausstehend →</div>
        </div>
        <div class="stat-card stat-danger" style="cursor:pointer" onclick="App.navigate('wiedervorlagen')" title="Klick → Überfällige Wiedervorlagen anzeigen">
          <div class="stat-label">Überfällig</div>
          <div class="stat-value">${ueberfaellig}</div>
          <div class="stat-sub">Frist abgelaufen →</div>
        </div>
      </div>

      <!-- Datenpflege-Hinweise -->
      ${(ohneBetrieb || ohneEmail || betriebOhneEmail) ? `
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;font-size:12px">
        ${ohneBetrieb ? `<span style="padding:4px 10px;background:var(--clr-amber-light);border-radius:10px;cursor:pointer" onclick="App.navigate('stammdaten');setTimeout(()=>StammdatenTab.show('betriebe'),100)">🔗 ${ohneBetrieb} Schüler ohne Betrieb-Verknüpfung</span>` : ''}
        ${ohneEmail ? `<span style="padding:4px 10px;background:var(--clr-amber-light);border-radius:10px;cursor:pointer" onclick="App.navigate('stammdaten');setTimeout(()=>StammdatenTab.show('schulen'),100)">📧 ${ohneEmail} Schulen ohne E-Mail</span>` : ''}
        ${betriebOhneEmail ? `<span style="padding:4px 10px;background:var(--clr-amber-light);border-radius:10px;cursor:pointer" onclick="App.navigate('stammdaten');setTimeout(()=>StammdatenTab.show('betriebe'),100)">📧 ${betriebOhneEmail} Betriebe ohne E-Mail</span>` : ''}
      </div>` : ''}

      <!-- Termine + Wiedervorlagen Side-by-Side -->
      <div class="grid-2" style="margin-bottom:20px">
        <div class="card">
          <div class="card-header">
            Nächste Kontrolltermine
            <button class="btn btn-sm btn-secondary" onclick="App.navigate('planung')">Alle anzeigen</button>
          </div>
          ${naechsteTermine.length ? `<table class="data-table"><thead><tr><th>Datum</th><th>Schule</th><th>Fachrichtung / AJ</th><th>Prüfer</th><th></th></tr></thead><tbody>
            ${naechsteTermine.map(t => {
              const klassen = App.getTerminKlassen(t.id);
              const schule = klassen.length ? klassen[0].schule : '–';
              const ort = klassen.length ? klassen[0].schule_ort : '';
              const frAj = App.formatTerminFrAj(t.id);
              const schuelerCount = App.getTerminSchueler(t.id).length;
              return `<tr>
              <td data-sort="${t.geplant_datum}">${t.typ === 'einsendung' ? '📬' : ''} ${formatDate(t.geplant_datum)} <span style="font-size:10px;color:var(--clr-sage)">KW${getKW(t.geplant_datum)}</span></td>              <td>${klassen.length ? esc(schule) + (ort ? ` <span style="color:var(--clr-text-light)">(${esc(ort)})</span>` : '') : '<em style="color:var(--clr-text-light)">Einsendung</em>'}</td>
              <td>${esc(frAj)}</td>
              <td>${esc(t.pruefer)}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-primary" onclick="App.navigate('kontrolle');setTimeout(()=>{document.getElementById('selKontrolltermin').value='${t.id}';KontrolleHandler.loadTermin(${t.id})},100)" title="Kontrolle starten (${schuelerCount} Schüler)" style="font-size:11px;padding:2px 8px">▶ Starten</button>
              </td>
            </tr>`;}).join('')}
          </tbody></table>` : '<div class="empty-state"><p>Keine anstehenden Termine</p></div>'}
        </div>

        <div class="card">
          <div class="card-header">
            Überfällige Wiedervorlagen
            <button class="btn btn-sm btn-secondary" onclick="App.navigate('wiedervorlagen')">Alle anzeigen</button>
          </div>
          ${ueberfaelligeWV.length ? `<table class="data-table"><thead><tr><th>Schüler</th><th>Betrieb</th><th>Frist</th><th>Tage über</th></tr></thead><tbody>
            ${ueberfaelligeWV.map(w => {
              const diff = Math.floor((new Date(today) - new Date(w.frist_datum)) / 86400000);
              return `<tr>
                <td><strong>${esc(w.nachname)}</strong>, ${esc(w.vorname)}</td>
                <td>${esc(w.ausbildungsstaette)}</td>
                <td data-sort="${w.frist_datum}">${formatDate(w.frist_datum)}</td>
                <td data-sort="${diff}"><span class="badge-status badge-overdue">${diff} Tage</span></td>
              </tr>`;
            }).join('')}
          </tbody></table>` : '<div class="empty-state"><p>Keine überfälligen Wiedervorlagen</p></div>'}
        </div>
      </div>

      <!-- Kontrollstatus + Betriebe Side-by-Side -->
      <div class="grid-2" style="margin-bottom:20px">
        <!-- Kontrollstatus-Übersicht -->
        <div class="card" style="border-left:3px solid var(--clr-amber)">
          <div class="card-header">📋 Kontrollstatus</div>
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
            <label style="font-size:12px;white-space:nowrap">Nicht kontrolliert seit:
              <strong id="kontrollMonateLabel">–</strong>
            </label>
            <input type="range" id="kontrollMonateSlider" min="0" max="18" step="1" value="0" style="flex:1;min-width:100px;accent-color:var(--clr-amber)" oninput="Views._updateKontrollstatus()">
            <span id="kontrollStatusCount" style="font-size:11px;font-weight:600;color:var(--clr-amber)"></span>
          </div>
          <div id="kontrollStatusTable" class="scroll-subtle" style="max-height:50vh;overflow-y:auto"></div>
        </div>

        <!-- Betrieb-Ranking (erweitert) -->
        ${betriebRanking.length ? `<div class="card">
          <div class="card-header">🏢 Betriebe mit Mängeln</div>
          <table class="data-table"><thead><tr><th>Betrieb</th><th>Azubis</th><th>Beanstandungen</th><th>Offene WV</th></tr></thead><tbody>
            ${betriebRanking.map(b => '<tr>'
              + '<td><strong>' + esc(b.betrieb) + '</strong></td>'
              + '<td>' + (b.betrieb_id ? '<a href="#" onclick="StammdatenTab.showBetriebAzubis('+b.betrieb_id+');return false" style="color:var(--clr-forest);text-decoration:underline">' + b.azubi_count + '</a>' : b.azubi_count) + '</td>'
              + '<td>' + (b.maengel_count > 0 ? '<span class="badge-status badge-overdue">' + b.maengel_count + '</span>' : b.maengel_count) + '</td>'
              + '<td>' + (b.offene_wv ? '<span class="badge-status badge-open">' + b.offene_wv + '</span>' : '–') + '</td>'
              + '</tr>').join('')}
          </tbody></table>
        </div>` : '<div class="card"><div class="card-header">🏢 Betriebe</div><div class="empty-state"><p>Keine Beanstandungen</p></div></div>'}
      </div>

      <!-- ═══════ STATISTIKEN ═══════ -->
      ${(() => {
        const gf = App.gf('schueler');
        const total = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1${gf}`) || 0;
        if (!total) return '';

        // ── Helper: CSS bar ──
        const bar = (val, max, total, color, label, onclick) => {
          const pct = total > 0 ? Math.round(val/total*100) : 0;
          const w = max > 0 ? Math.max(2, Math.round(val/max*100)) : 0;
          return `<div class="dash-bar" style="display:grid;grid-template-columns:200px 1fr 44px 36px;align-items:center;gap:6px;margin-bottom:3px;font-size:12px;cursor:${onclick?'pointer':'default'}" ${onclick?'onclick="'+onclick+'"':''}>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(label)}">${esc(label)}</span>
            <div style="background:var(--clr-sand);border-radius:3px;height:16px;overflow:hidden">
              <div style="width:${w}%;background:${color};height:100%;border-radius:3px;min-width:${val?'2px':'0'}"></div>
            </div>
            <span style="text-align:right;font-weight:600">${val}</span>
            <span style="text-align:right;color:var(--clr-text-light);font-size:10px">${pct}%</span>
          </div>`;
        };

        // ── 1) Azubis je Schule ──
        const schulen = App.query(`SELECT bs.id, bs.name, bs.ort, COUNT(s.id) as cnt
          FROM schueler s JOIN klassen k ON s.klasse_id=k.id JOIN berufsschulen bs ON k.berufsschule_id=bs.id
          WHERE s.aktiv=1${gf} GROUP BY bs.id ORDER BY cnt DESC`);
        const maxSchule = schulen.length ? schulen[0].cnt : 0;

        // ── 2) Azubis je Fachrichtung + Geschlecht ──
        const frs = App.query(`SELECT fr.id, fr.bezeichnung, fr.typ, COUNT(s.id) as cnt
          FROM schueler s JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
          WHERE s.aktiv=1${gf} GROUP BY fr.id ORDER BY cnt DESC`);
        const maxFR = frs.length ? frs[0].cnt : 0;

        // ── 3) Azubis je Amt ──
        const aemter = App.query(`SELECT s.zustaendiges_amt as code, COUNT(s.id) as cnt
          FROM schueler s WHERE s.aktiv=1 AND s.zustaendiges_amt != ''${gf}
          GROUP BY s.zustaendiges_amt ORDER BY cnt DESC`);
        const maxAmt = aemter.length ? aemter[0].cnt : 0;

        // ── 4) Azubis je Jahrgang (with kontrollergebnis summary) ──
        const jgs = App.query(`SELECT j.id, j.bezeichnung, j.pruefungstermin, j.typ,
          COUNT(DISTINCT s.id) as cnt,
          COUNT(DISTINCT CASE WHEN ke.ergebnis='in_ordnung' THEN s.id END) as ok_cnt,
          COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN s.id END) as issue_cnt
          FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
          LEFT JOIN kontrollergebnisse ke ON ke.schueler_id=s.id AND ke.ergebnis != ''
          WHERE s.aktiv=1${gf} GROUP BY j.id ORDER BY j.jahr DESC, j.typ`);
        const maxJG = jgs.length ? Math.max(...jgs.map(j=>j.cnt)) : 0;

        // ── 5) Verkürzer ──
        const verkuerzer = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1${gf}
          AND (julianday(s.ausbildungsende) - julianday(s.ausbildungsbeginn)) < 365*2.8
          AND s.ausbildungsbeginn != '' AND s.ausbildungsende != ''`) || 0;

        // ── 6) Mängel-Codes ──
        const codeLabels = {A:'Unterschr. Azubi',B:'Unterschr. Ausb.',C:'BS-Themen',D:'Wetter',E:'Inhaltl. lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'};
        const maengelCodes = App.query(`SELECT maengel_codes FROM kw_status ks JOIN schueler s ON ks.schueler_id=s.id WHERE ks.maengel_codes != '' AND ks.maengel_codes != 'H' AND s.aktiv=1${gf}`);
        const codeCounts = {};
        maengelCodes.forEach(r => r.maengel_codes.split(',').forEach(c => { c = c.trim(); if (c && c !== 'H') codeCounts[c] = (codeCounts[c]||0) + 1; }));
        const codeEntries = Object.entries(codeCounts).sort((a,b) => b[1]-a[1]);
        const maxCode = codeEntries.length ? codeEntries[0][1] : 0;
        const totalCodes = codeEntries.reduce((s, [, c]) => s + c, 0);

        // ── 7) Top Betriebe (meiste Azubis) ──
        const topBetriebe = App.query(`SELECT COALESCE(b.name, s.ausbildungsstaette) as name, b.ort, b.id as bid, COUNT(s.id) as cnt
          FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id
          WHERE s.aktiv=1${gf} GROUP BY COALESCE(b.id, s.ausbildungsstaette) ORDER BY cnt DESC LIMIT 10`);
        const maxBetrieb = topBetriebe.length ? topBetriebe[0].cnt : 0;
        const totalBetriebe = App.scalar(`SELECT COUNT(DISTINCT COALESCE(betrieb_id, ausbildungsstaette)) FROM schueler s WHERE s.aktiv=1${gf}`) || 0;

        // ── 8) Nächste Prüfungstermine ──
        const pruefTermine = App.query(`SELECT j.bezeichnung, j.pruefungstermin, j.typ, COUNT(s.id) as cnt
          FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
          WHERE s.aktiv=1 AND j.pruefungstermin >= ?${gf}
          GROUP BY j.id ORDER BY j.pruefungstermin`, [today]);

        return `
      <div style="margin-bottom:20px">
        <h3 style="font-size:16px;color:var(--clr-forest-dark);margin-bottom:12px;border-bottom:2px solid var(--clr-forest);padding-bottom:6px">📊 Statistiken</h3>

        <div class="grid-2" style="margin-bottom:16px">
          <!-- Azubis je Schule -->
          <div class="card">
            <div class="card-header">🏫 Azubis je Berufsschule</div>
            ${schulen.map(s => bar(s.cnt, maxSchule, total, 'var(--clr-leaf)', s.name + (s.ort?' ('+s.ort+')':''), `StammdatenTab.showSchuleKlassen(${s.id})`)).join('')}
            ${!schulen.length ? '<div style="padding:8px;color:var(--clr-text-light);font-size:12px">Keine Daten</div>' : ''}
          </div>

          <!-- Azubis je Fachrichtung -->
          <div class="card">
            <div class="card-header">🌿 Azubis je Fachrichtung</div>
            ${frs.map(f => {
              const color = f.typ === 'Fachwerker' ? 'var(--clr-amber)' : 'var(--clr-forest)';
              return bar(f.cnt, maxFR, total, color, (f.typ==='Fachwerker'?'FW ':'') + f.bezeichnung, '');
            }).join('')}
            ${!frs.length ? '<div style="padding:8px;color:var(--clr-text-light);font-size:12px">Keine Daten</div>' : ''}
          </div>
        </div>

        <div class="grid-2" style="margin-bottom:16px">
          <!-- Azubis je Amt -->
          <div class="card">
            <div class="card-header">🏛 Azubis je zuständiges Amt</div>
            ${aemter.map(a => {
              const color = a.code === '93' ? 'var(--clr-forest)' : 'var(--clr-sage)';
              return bar(a.cnt, maxAmt, total, color, App.amtLabel(a.code), '');
            }).join('')}
            ${!aemter.length ? '<div style="padding:8px;color:var(--clr-text-light);font-size:12px">Keine Daten (Amt noch nicht importiert?)</div>' : ''}
          </div>

          <!-- Azubis je Jahrgang -->
          <div class="card">
            <div class="card-header">📅 Azubis je Jahrgang</div>
            ${jgs.map(j => {
              const pruef = j.pruefungstermin ? formatDate(j.pruefungstermin) : '';
              return `<div class="dash-jg-row" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px">
                <span style="min-width:60px;font-weight:600">${esc(j.bezeichnung)}</span>
                <div style="flex:1;background:var(--clr-sand);border-radius:3px;height:16px;overflow:hidden;display:flex">
                  <div style="width:${j.cnt?Math.round((j.ok_cnt||0)/j.cnt*100):0}%;background:var(--clr-green);height:100%" title="${j.ok_cnt||0} in Ordnung"></div>
                  <div style="width:${j.cnt?Math.round((j.issue_cnt||0)/j.cnt*100):0}%;background:var(--clr-red);height:100%" title="${j.issue_cnt||0} mit Mängeln"></div>
                </div>
                <span style="min-width:30px;text-align:right;font-weight:600">${j.cnt}</span>
                <span style="min-width:50px;font-size:10px;color:var(--clr-text-light)">${pruef?'AP '+pruef:''}</span>
              </div>`;
            }).join('')}
            <div style="margin-top:6px;font-size:10px;color:var(--clr-text-light)">
              <span style="display:inline-block;width:10px;height:10px;background:var(--clr-green);border-radius:2px;vertical-align:middle"></span> In Ordnung
              <span style="display:inline-block;width:10px;height:10px;background:var(--clr-red);border-radius:2px;vertical-align:middle;margin-left:8px"></span> Mängel
              <span style="display:inline-block;width:10px;height:10px;background:var(--clr-sand);border-radius:2px;vertical-align:middle;margin-left:8px"></span> Noch nicht kontrolliert
            </div>
          </div>
        </div>

        <div class="grid-3" style="margin-bottom:16px">
          <!-- Kennzahlen -->
          <div class="card" style="text-align:center">
            <div class="card-header">🔢 Kennzahlen</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
              <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
                <div style="font-size:24px;font-weight:700;color:var(--clr-forest)">${total}</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Azubis gesamt</div>
              </div>
              <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
                <div style="font-size:24px;font-weight:700;color:var(--clr-sage)">${verkuerzer}</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Verkürzer (${total?Math.round(verkuerzer/total*100):0}%)</div>
              </div>
              <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
                <div style="font-size:24px;font-weight:700;color:var(--clr-forest)">${schulen.length}</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Berufsschulen</div>
              </div>
              <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
                <div style="font-size:24px;font-weight:700;color:var(--clr-sage)">${totalBetriebe}</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Betriebe</div>
              </div>
            </div>
          </div>

          <!-- Mängel-Verteilung -->
          <div class="card">
            <div class="card-header">⚠ Häufigste Mängel-Codes</div>
            ${codeEntries.length ? codeEntries.map(([code, cnt]) => {
              const color = 'ABFG'.includes(code) ? 'var(--clr-red)' : 'CDEH'.includes(code) ? 'var(--clr-amber)' : 'var(--clr-sage)';
              return bar(cnt, maxCode, totalCodes, color, code + ' ' + (codeLabels[code]||''), '');
            }).join('') : '<div style="padding:8px;color:var(--clr-text-light);font-size:12px">Keine Mängel erfasst</div>'}
          </div>

          <!-- Nächste Prüfungstermine -->
          <div class="card">
            <div class="card-header">🎓 Anstehende Prüfungen</div>
            ${pruefTermine.length ? pruefTermine.map(p => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--clr-sand);font-size:12px">
                <span><strong>${esc(p.bezeichnung)}</strong> <span style="color:var(--clr-text-light)">(${p.typ})</span></span>
                <span style="font-weight:600">${formatDate(p.pruefungstermin)}</span>
                <span style="color:var(--clr-sage);font-size:11px">${p.cnt} Azubis</span>
              </div>
            `).join('') : '<div style="padding:8px;color:var(--clr-text-light);font-size:12px">Keine anstehenden Prüfungen</div>'}
          </div>
        </div>

        <!-- Top Betriebe -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">🏢 Betriebe mit den meisten Azubis (Top 10)</div>
          <div class="dash-betriebe-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
            ${topBetriebe.map(b => bar(b.cnt, maxBetrieb, total, 'var(--clr-leaf)', b.name + (b.ort?' ('+b.ort+')':''), b.bid ? 'StammdatenTab.showBetriebAzubis('+b.bid+')' : '')).join('')}
          </div>
        </div>

        <!-- ═══ CHART.JS VISUALISIERUNGEN ═══ -->
        <h3 style="font-size:16px;color:var(--clr-forest-dark);margin:20px 0 12px;border-bottom:2px solid var(--clr-forest);padding-bottom:6px">📈 Diagramme</h3>

        <div class="grid-3" style="margin-bottom:16px">
          <div class="card dash-chart-card" style="text-align:center">
            <div class="card-header">🍩 Kontrollfortschritt</div>
            <div class="dash-chart-wrap dash-chart-wrap-sm"><canvas id="chartKontrollfortschritt" style="cursor:pointer"></canvas></div>
            <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick → Berichte / Kontrolle</div>
          </div>
          <div class="card dash-chart-card" style="text-align:center">
            <div class="card-header">👫 Geschlechterquote</div>
            <div class="dash-chart-wrap dash-chart-wrap-sm"><canvas id="chartGeschlecht" style="cursor:pointer"></canvas></div>
            <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick → Azubi-Liste filtern</div>
          </div>
          <div class="card dash-chart-card" style="text-align:center">
            <div class="card-header">🗺 Regionale Verteilung</div>
            <div class="dash-chart-wrap dash-chart-wrap-sm"><canvas id="chartRegionen" style="cursor:pointer"></canvas></div>
            <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick → Amt-Filter setzen</div>
          </div>
        </div>

        <div class="grid-2" style="margin-bottom:16px">
          <div class="card dash-chart-card" style="text-align:center">
            <div class="card-header">🎓 Schulabschlüsse</div>
            <div class="dash-chart-wrap dash-chart-wrap-sm"><canvas id="chartSchulabschluss" style="cursor:pointer"></canvas></div>
            <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick → Azubi-Liste filtern</div>
          </div>
          <div class="card dash-chart-card" style="text-align:center">
            <div class="card-header">📋 Prüfungserfolg</div>
            <div class="dash-chart-wrap dash-chart-wrap-sm"><canvas id="chartPruefungserfolg" style="cursor:pointer"></canvas></div>
            <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick → Azubi-Liste filtern</div>
          </div>
        </div>

        <div class="grid-2" style="margin-bottom:16px">
          <div class="card dash-chart-card">
            <div class="card-header">🕸 Mängelverteilung</div>
            <div class="dash-chart-wrap dash-chart-wrap-md"><canvas id="chartMaengelRadar"></canvas></div>
          </div>
        </div>

        <div class="card dash-chart-card" style="margin-bottom:16px">
          <div class="card-header">🌿 Fachrichtungen: Gärtner vs. Fachwerker</div>
          <div class="dash-chart-wrap" style="height:${Math.max(140, Math.min(400, frs.length * 30))}px"><canvas id="chartFachrichtungen" style="cursor:pointer"></canvas></div>
          <div style="font-size:9px;color:var(--clr-text-light);margin-top:4px">Klick auf Balken → Fachrichtung filtern</div>
        </div>

      </div>`;
      })()}
    </div>`;
    // Init kontrollstatus slider + charts (can't use <script> in innerHTML)
    setTimeout(() => {
      this._updateKontrollstatus();
      this._renderDashboardCharts();
    }, 80);
  },

  // ── Chart.js Dashboard Rendering ──
  _chartInstances: {},

  _destroyCharts() {
    Object.values(this._chartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
    this._chartInstances = {};
  },

  _renderDashboardCharts() {
    if (typeof Chart === 'undefined') return;
    this._destroyCharts();

    const gf = App.gf('schueler');
    const total = App.scalar('SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1' + gf) || 0;
    if (!total) return;

    // Color palette
    const C = {
      forest: '#2d5016', leaf: '#4a7c1f', sage: '#7a9a5a', amber: '#d4a017',
      red: '#c0392b', green: '#27ae60', blue: '#2980b9', sand: '#e8e0d0',
      warm: '#faf6f0', purple: '#8e44ad', teal: '#16a085', pink: '#e74c8c',
      orange: '#e67e22', navy: '#2c3e50',
      palette: ['#2d5016','#4a7c1f','#7a9a5a','#d4a017','#c0392b','#2980b9','#8e44ad','#16a085','#e67e22','#e74c8c','#2c3e50','#95a5a6']
    };

    const isMobile = window.innerWidth < 768;
    const chartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: { legend: { position: isMobile ? 'bottom' : 'bottom', labels: { font: { size: isMobile ? 10 : 11, family: "'Nunito Sans'" }, padding: isMobile ? 4 : 8, boxWidth: isMobile ? 10 : 12 } } }
    };

    // ── 1) Kontrollfortschritt Donut ──
    try {
      const okCnt = App.scalar('SELECT COUNT(DISTINCT s.id) FROM schueler s JOIN kontrollergebnisse ke ON ke.schueler_id=s.id WHERE ke.ergebnis="in_ordnung" AND s.aktiv=1' + gf) || 0;
      const issueCnt = App.scalar('SELECT COUNT(DISTINCT s.id) FROM schueler s JOIN kontrollergebnisse ke ON ke.schueler_id=s.id WHERE ke.ergebnis != "" AND ke.ergebnis != "in_ordnung" AND s.aktiv=1' + gf) || 0;
      const openCnt = total - okCnt - issueCnt;
      const ctx1 = document.getElementById('chartKontrollfortschritt');
      if (ctx1) {
        this._chartInstances.kontroll = new Chart(ctx1, {
          type: 'doughnut',
          data: {
            labels: ['In Ordnung (' + okCnt + ')', 'Mit Mängeln (' + issueCnt + ')', 'Noch offen (' + openCnt + ')'],
            datasets: [{ data: [okCnt, issueCnt, openCnt], backgroundColor: [C.green, C.red, C.sand], borderWidth: 2, borderColor: C.warm }]
          },
          options: { ...chartOpts, cutout: '55%',
            plugins: { ...chartOpts.plugins, tooltip: { callbacks: { label: function(ctx) { return ctx.label + ' (' + Math.round(ctx.parsed/total*100) + '%)'; } } } },
            onClick: (evt, elems) => {
              if (!elems.length) return;
              const idx = elems[0].index;
              if (idx === 0) App.drillDown("s.id IN (SELECT ke2.schueler_id FROM kontrollergebnisse ke2 WHERE ke2.ergebnis='in_ordnung')", '✅ In Ordnung');
              else if (idx === 1) App.drillDown("s.id IN (SELECT ke2.schueler_id FROM kontrollergebnisse ke2 WHERE ke2.ergebnis!='' AND ke2.ergebnis!='in_ordnung')", '❌ Mit Mängeln');
              else App.drillDown("s.id NOT IN (SELECT ke2.schueler_id FROM kontrollergebnisse ke2 WHERE ke2.ergebnis!='')", '⏳ Noch offen');
            }
          }
        });
      }
    } catch(e) { console.warn('Chart kontroll:', e); }

    // ── 2) Geschlechterquote Donut ──
    try {
      const mCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.geschlecht='m'" + gf) || 0;
      const wCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.geschlecht='w'" + gf) || 0;
      const dCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.geschlecht='d'" + gf) || 0;
      const unkn = total - mCnt - wCnt - dCnt;
      const ctx2 = document.getElementById('chartGeschlecht');
      if (ctx2) {
        const labels = [], data = [], colors = [];
        if (mCnt) { labels.push('Männlich (' + mCnt + ')'); data.push(mCnt); colors.push(C.blue); }
        if (wCnt) { labels.push('Weiblich (' + wCnt + ')'); data.push(wCnt); colors.push(C.pink); }
        if (dCnt) { labels.push('Divers (' + dCnt + ')'); data.push(dCnt); colors.push(C.purple); }
        if (unkn) { labels.push('Unbekannt (' + unkn + ')'); data.push(unkn); colors.push(C.sand); }
        const gLabels = labels; // capture for onClick
        const gValues = [mCnt ? 'm' : null, wCnt ? 'w' : null, dCnt ? 'd' : null, unkn ? '' : null].filter(v => v !== null);
        this._chartInstances.geschlecht = new Chart(ctx2, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: C.warm }] },
          options: { ...chartOpts, cutout: '55%', onClick: (evt, elems) => {
            if (!elems.length) return;
            const val = gValues[elems[0].index];
            const lbl = val === 'm' ? '♂ Männlich' : val === 'w' ? '♀ Weiblich' : val === 'd' ? '⚧ Divers' : '? Unbekannt';
            if (val === '') App.drillDown("s.geschlecht='' OR s.geschlecht IS NULL", lbl);
            else App.drillDown("s.geschlecht='" + val + "'", lbl);
          } }
        });
      }
    } catch(e) { console.warn('Chart geschlecht:', e); }

    // ── 3) Regionale Verteilung Donut ──
    try {
      const aemter = App.query("SELECT s.zustaendiges_amt as code, COUNT(s.id) as cnt FROM schueler s WHERE s.aktiv=1 AND s.zustaendiges_amt != ''" + gf + " GROUP BY s.zustaendiges_amt ORDER BY cnt DESC");
      const ctx3 = document.getElementById('chartRegionen');
      if (ctx3 && aemter.length) {
        const top6 = aemter.slice(0, 6);
        const rest = aemter.slice(6).reduce((s, a) => s + a.cnt, 0);
        const labels = top6.map(a => App.amtLabel(a.code) + ' (' + a.cnt + ')');
        const data = top6.map(a => a.cnt);
        if (rest > 0) { labels.push('Übrige (' + rest + ')'); data.push(rest); }
        this._chartInstances.regionen = new Chart(ctx3, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: C.palette.slice(0, data.length), borderWidth: 2, borderColor: C.warm }] },
          options: { ...chartOpts, cutout: '50%', onClick: (evt, elems) => {
            if (!elems.length) return;
            const idx = elems[0].index;
            if (idx < top6.length) {
              App.drillDown("s.zustaendiges_amt='" + top6[idx].code + "'", '🏛 ' + App.amtLabel(top6[idx].code));
            }
          } }
        });
      } else if (ctx3) {
        ctx3.parentElement.querySelector('.card-header').insertAdjacentHTML('afterend', '<p style="color:var(--clr-text-light);font-size:12px;padding:20px">Keine Amt-Daten vorhanden</p>');
      }
    } catch(e) { console.warn('Chart regionen:', e); }

    // ── 4) Mängel-Radar (Polar Area) ──
    try {
      const codeLabels = {A:'Unterschr. Azubi',B:'Unterschr. Ausb.',C:'BS-Themen',D:'Wetter',E:'Inhaltl. lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'};
      const mRows = App.query("SELECT maengel_codes FROM kw_status ks JOIN schueler s ON ks.schueler_id=s.id WHERE ks.maengel_codes != '' AND ks.maengel_codes != 'H' AND s.aktiv=1" + gf);
      const counts = {};
      mRows.forEach(r => r.maengel_codes.split(',').forEach(c => { c = c.trim(); if (c && c !== 'H') counts[c] = (counts[c]||0) + 1; }));
      const codes = 'ABCDEFGI'.split(''); // H excluded (Fehltage = kein Mangel)
      const ctx4 = document.getElementById('chartMaengelRadar');
      if (ctx4 && Object.keys(counts).length) {
        this._chartInstances.maengel = new Chart(ctx4, {
          type: 'polarArea',
          data: {
            labels: codes.map(c => c + ' ' + (codeLabels[c]||'')),
            datasets: [{ data: codes.map(c => counts[c] || 0),
              backgroundColor: ['rgba(192,57,43,0.6)','rgba(192,57,43,0.5)','rgba(212,160,23,0.5)','rgba(212,160,23,0.4)','rgba(192,57,43,0.4)','rgba(192,57,43,0.7)','rgba(212,160,23,0.5)','rgba(122,154,90,0.5)','rgba(122,154,90,0.4)'],
              borderWidth: 1, borderColor: '#fff' }]
          },
          options: { ...chartOpts, scales: { r: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } } },
            plugins: { ...chartOpts.plugins, legend: { display: false } } }
        });
      }
    } catch(e) { console.warn('Chart maengel:', e); }

    // ── 5) Schulabschlüsse Donut ──
    try {
      const saLabels = {'1':'ohne Hauptschulabschluss','2':'Hauptschulabschluss','3':'Realschulabschluss','4':'Hochschul-/Fachhochschulreife','5':'Ausland (nicht zuordenbar)'};
      const saColors = {'1':C.red,'2':C.amber,'3':C.blue,'4':C.forest,'5':C.purple};
      const saData = App.query("SELECT s.schulabschluss as sa, COUNT(*) as cnt FROM schueler s WHERE s.aktiv=1 AND s.schulabschluss != ''" + gf + " GROUP BY s.schulabschluss ORDER BY s.schulabschluss");
      const ctxSA = document.getElementById('chartSchulabschluss');
      if (ctxSA && saData.length) {
        const labels = [], data = [], colors = [];
        saData.forEach(r => {
          labels.push((saLabels[r.sa]||'Sonstige') + ' (' + r.cnt + ')');
          data.push(r.cnt);
          colors.push(saColors[r.sa] || C.sand);
        });
        const saKeys = saData.map(r => r.sa);
        this._chartInstances.schulabschluss = new Chart(ctxSA, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: C.warm }] },
          options: { ...chartOpts, cutout: '55%', onClick: (evt, elems) => {
            if (!elems.length) return;
            const sa = saKeys[elems[0].index];
            App.drillDown("s.schulabschluss='" + sa + "'", '🎓 ' + (saLabels[sa] || 'Code ' + sa));
          } }
        });
      }
    } catch(e) { console.warn('Chart schulabschluss:', e); }

    // ── 5b) Prüfungserfolg Donut ──
    try {
      const bestanden = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.pruefungserfolg='bestanden'" + gf) || 0;
      const nichtBest = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.pruefungserfolg='nicht_bestanden'" + gf) || 0;
      const wdh1Best = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.pruefungserfolg_wdh1='bestanden'" + gf) || 0;
      const wdh1Fail = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.pruefungserfolg_wdh1='nicht_bestanden'" + gf) || 0;
      const wdh2Best = App.scalar("SELECT COUNT(*) FROM schueler s WHERE s.aktiv=1 AND s.pruefungserfolg_wdh2='bestanden'" + gf) || 0;
      const nochOffen = total - bestanden - nichtBest - wdh1Best - wdh1Fail - wdh2Best;
      const ctxPE = document.getElementById('chartPruefungserfolg');
      if (ctxPE && (bestanden + nichtBest + wdh1Best + wdh1Fail + wdh2Best > 0)) {
        const labels = [], data = [], colors = [];
        if (bestanden) { labels.push('Bestanden (' + bestanden + ')'); data.push(bestanden); colors.push(C.green); }
        if (wdh1Best) { labels.push('WDH1 bestanden (' + wdh1Best + ')'); data.push(wdh1Best); colors.push(C.teal); }
        if (wdh2Best) { labels.push('WDH2 bestanden (' + wdh2Best + ')'); data.push(wdh2Best); colors.push(C.blue); }
        if (nichtBest) { labels.push('Nicht bestanden (' + nichtBest + ')'); data.push(nichtBest); colors.push(C.red); }
        if (wdh1Fail) { labels.push('WDH1 nicht best. (' + wdh1Fail + ')'); data.push(wdh1Fail); colors.push(C.orange); }
        if (nochOffen > 0) { labels.push('Noch offen (' + nochOffen + ')'); data.push(nochOffen); colors.push(C.sand); }
        const peFilters = [];
        if (bestanden) peFilters.push({ where: "s.pruefungserfolg='bestanden'", label: '✅ Prüfung bestanden' });
        if (wdh1Best) peFilters.push({ where: "s.pruefungserfolg_wdh1='bestanden'", label: '✅ WDH1 bestanden' });
        if (wdh2Best) peFilters.push({ where: "s.pruefungserfolg_wdh2='bestanden'", label: '✅ WDH2 bestanden' });
        if (nichtBest) peFilters.push({ where: "s.pruefungserfolg='nicht_bestanden'", label: '❌ Prüfung nicht bestanden' });
        if (wdh1Fail) peFilters.push({ where: "s.pruefungserfolg_wdh1='nicht_bestanden'", label: '❌ WDH1 nicht bestanden' });
        if (nochOffen > 0) peFilters.push({ where: "s.pruefungserfolg='' OR s.pruefungserfolg IS NULL", label: '⏳ Prüfung noch offen' });
        this._chartInstances.pruefungserfolg = new Chart(ctxPE, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: C.warm }] },
          options: { ...chartOpts, cutout: '55%', onClick: (evt, elems) => {
            if (!elems.length) return;
            const f = peFilters[elems[0].index];
            if (f) App.drillDown(f.where, f.label);
          } }
        });
      } else if (ctxPE) {
        ctxPE.parentElement.innerHTML = '<div style="padding:20px;color:var(--clr-text-light);font-size:12px;text-align:center">Noch keine Prüfungsergebnisse vorhanden.<br>Daten werden beim nächsten IBYKUS-Import übernommen.</div>';
      }
    } catch(e) { console.warn('Chart pruefungserfolg:', e); }

    // ── 6) Fachrichtungen Horizontal Bar ──
    try {
      const frs = App.query("SELECT fr.id, fr.bezeichnung, fr.typ, COUNT(s.id) as cnt FROM schueler s JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE s.aktiv=1" + gf + " GROUP BY fr.id ORDER BY cnt DESC");
      const ctx6 = document.getElementById('chartFachrichtungen');
      if (ctx6 && frs.length) {
        this._chartInstances.fachrichtungen = new Chart(ctx6, {
          type: 'bar',
          data: {
            labels: frs.map(f => (f.typ === 'Fachwerker' ? 'FW ' : '') + f.bezeichnung),
            datasets: [{
              label: 'Azubis',
              data: frs.map(f => f.cnt),
              backgroundColor: frs.map(f => f.typ === 'Fachwerker' ? 'rgba(212,160,23,0.7)' : 'rgba(45,80,22,0.7)'),
              borderColor: frs.map(f => f.typ === 'Fachwerker' ? C.amber : C.forest),
              borderWidth: 1, borderRadius: 3
            }]
          },
          options: { ...chartOpts, indexAxis: 'y',
            scales: {
              x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 } } },
              y: { grid: { display: false }, ticks: { font: { size: 11, family: "'Nunito Sans'" } } }
            },
            plugins: { ...chartOpts.plugins, legend: { display: false } },
            onClick: (evt, elems) => {
              if (!elems.length) return;
              const fr = frs[elems[0].index];
              if (fr) {
                App.drillDown("s.fachrichtung_id=" + fr.id, '🌿 ' + (fr.typ === 'Fachwerker' ? 'FW: ' : '') + fr.bezeichnung);
              }
            }
          }
        });
      }
    } catch(e) { console.warn('Chart fachrichtungen:', e); }
  },

  // ════════════════════════════════════════════
  //  STAMMDATEN
  // ════════════════════════════════════════════
  stammdaten() {
    const mc = document.getElementById('mainContent');
    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Stammdaten</h2>
        <p>Azubis, Betriebe, Berufsschulen, Klassen und Prüfer verwalten</p>
      </div>
      ${App.filterBadgeHtml()}
      <div class="tabs">
        <button class="tab-btn active" onclick="StammdatenTab.show('azubis',this)">Azubis</button>
        <button class="tab-btn" onclick="StammdatenTab.show('jahrgaenge',this)">Jahrgänge</button>
        <button class="tab-btn" onclick="StammdatenTab.show('schulen',this)">Berufsschulen</button>
        <button class="tab-btn" onclick="StammdatenTab.show('klassen',this)">Klassen</button>
        <button class="tab-btn" onclick="StammdatenTab.show('betriebe',this)">Betriebe</button>
        <button class="tab-btn" onclick="StammdatenTab.show('blockplan',this)">Blockpläne</button>
        <button class="tab-btn" onclick="StammdatenTab.show('pruefer',this)">Prüfer</button>
      </div>
      <div id="stammdatenContent"></div>
    </div>`;
    StammdatenTab.show('azubis', document.querySelector('.tab-btn.active'));
  },

  // ════════════════════════════════════════════
  //  IMPORT
  // ════════════════════════════════════════════
  importView() {
    const mc = document.getElementById('mainContent');
    // Initialize SchuelerView state if needed
    if (!SchuelerView._initialized) SchuelerView.init();

    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Schüler & Import</h2>
        <p>Auszubildende verwalten, filtern und bearbeiten</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="cursor:pointer" onclick="document.getElementById('csvSection').style.display=document.getElementById('csvSection').style.display==='none'?'':'none'">
          CSV-Import ▾
        </div>
        <div id="csvSection" style="display:none">

          <!-- IBYKUS Anleitung -->
          <div style="background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius);padding:14px 18px;margin-bottom:16px">
            <div style="display:flex;align-items:start;gap:10px">
              <span style="font-size:20px;line-height:1">📋</span>
              <div style="font-size:13px;color:var(--clr-text)">
                <strong style="color:var(--clr-forest-dark)">Anleitung: Daten aus IBYKUS exportieren</strong>
                <ol style="margin:8px 0 0 0;padding-left:20px;line-height:1.7">
                  <li>In <strong>IBYKUS Azubi</strong> unter <em>Auswertungen → Berufsbildungsstatistik</em> die Suchmaske öffnen</li>
                  <li>Filter setzen: <strong>Status = "Nicht Ende"</strong> und die gewünschten Fachrichtungen auswählen</li>
                  <li>Suchergebnisse <strong>mit Kopfzeile</strong> in Excel überführen und als <code>.xlsx</code> speichern</li>
                  <li>Die gespeicherte Excel-Datei hier importieren (Drag & Drop oder Klick)</li>
                </ol>
                <div style="margin-top:8px;padding:8px 12px;background:rgba(45,80,22,0.08);border-radius:6px;font-size:12px;color:var(--clr-sage)">
                  💡 <strong>Gut zu wissen:</strong> Der Import in eine bestehende Datenbank aktualisiert bestehende Ausbildungsverhältnisse automatisch (anhand BAV-Ident oder Name+Jahrgang) und fügt neue BAVs hinzu. Kontrolldaten und Wiedervorlagen werden dabei <strong>nicht</strong> zurückgesetzt oder verändert.
                </div>
              </div>
            </div>
          </div>

          <div class="drop-zone" id="dropZone" onclick="document.getElementById('csvFileInput').click()"
               ondragover="event.preventDefault();this.classList.add('dragover')"
               ondragleave="this.classList.remove('dragover')"
               ondrop="event.preventDefault();this.classList.remove('dragover');ImportHandler.handleFile(event.dataTransfer.files[0])">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>CSV- oder Excel-Datei hierher ziehen oder klicken (.csv, .xlsx, .xls)</p>
            <input type="file" id="csvFileInput" accept=".csv,.txt,.xlsx,.xls" style="display:none" onchange="ImportHandler.handleFile(this.files[0])">
          </div>
          <div id="importPreview"></div>
        </div>
      </div>

      <div id="schuelerViewContainer"></div>
    </div>`;
    try { SchuelerView.render(); } catch(e) {}
  },
  // ════════════════════════════════════════════
  //  KONTROLLPLANUNG
  // ════════════════════════════════════════════
  planung() {
    const jfkt = App.jgWhere('kt.jahrgang_id');
    let termine = App.query(`SELECT kt.*
      FROM kontrolltermine kt
      WHERE 1=1${jfkt.where}
      ORDER BY kt.geplant_datum DESC`, jfkt.params);
    App.preloadTerminKlassen(termine.map(t => t.id));

    const mc = document.getElementById('mainContent');
    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Kontrollplanung</h2>
        <p>Termine für Berichtsheftdurchsichten planen und verwalten</p>
      </div>
      ${App.filterBadgeHtml()}
      <div class="toolbar">
        <div class="toolbar-left">
          <select class="form-control" style="width:auto" onchange="PlanungHandler.filterStatus(this.value)" id="planFilter">
            <option value="geplant" selected>Geplante Termine</option>
            <option value="durchgefuehrt">Durchgeführte</option>
            <option value="all">Alle anzeigen</option>
          </select>
          <button class="btn btn-primary" onclick="PlanungHandler.addTermin()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Neuer Termin
          </button>
          <button class="btn btn-secondary" onclick="PlanungHandler.jahresplanAssistent()">
            📅 Jahresplanung
          </button>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-sm btn-secondary" id="planViewTbl" onclick="document.getElementById('planTable').style.display='';document.getElementById('planCalendar').style.display='none';this.style.fontWeight='700';document.getElementById('planViewCal').style.fontWeight='400'" style="font-weight:700">📋 Tabelle</button>
          <button class="btn btn-sm btn-secondary" id="planViewCal" onclick="document.getElementById('planCalendar').style.display='';document.getElementById('planTable').style.display='none';this.style.fontWeight='700';document.getElementById('planViewTbl').style.fontWeight='400'">📅 Kalender</button>
          <button class="btn btn-secondary" onclick="PlanungHandler.exportICS()">ICS-Export</button>
        </div>
      </div>

      <!-- Kalender-Ansicht -->
      <div id="planCalendar" style="display:none;margin-bottom:16px">
        ${(() => {
          // Build 6 months from now
          const now = new Date();
          const months = [];
          for (let i = -1; i < 5; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            months.push(d);
          }
          return months.map(month => {
            const year = month.getFullYear(), m = month.getMonth();
            const daysInMonth = new Date(year, m + 1, 0).getDate();
            const firstDay = (new Date(year, m, 1).getDay() + 6) % 7; // Mon=0
            const monthName = month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            // Find termine in this month
            const mStart = `${year}-${String(m+1).padStart(2,'0')}-01`;
            const mEnd = `${year}-${String(m+1).padStart(2,'0')}-${daysInMonth}`;
            const mTermine = termine.filter(t => t.geplant_datum >= mStart && t.geplant_datum <= mEnd);
            const terminDays = {};
            mTermine.forEach(t => {
              const day = parseInt(t.geplant_datum.split('-')[2]);
              const kl = App.getTerminKlassen(t.id);
              terminDays[day] = { t, label: kl.map(k => k.klassenbezeichnung).join('+'), status: t.status, pruefer: t.pruefer };
            });

            let cells = '';
            for (let i = 0; i < firstDay; i++) cells += '<div></div>';
            for (let d = 1; d <= daysInMonth; d++) {
              const td = terminDays[d];
              const isToday = d === now.getDate() && m === now.getMonth() && year === now.getFullYear();
              const bg = td ? (td.status === 'durchgefuehrt' ? 'var(--clr-green-light)' : 'var(--clr-blue-light)') : '';
              const border = isToday ? '2px solid var(--clr-forest)' : td ? '1px solid var(--clr-sage-light)' : '';
              cells += `<div style="min-height:32px;padding:2px 4px;border-radius:4px;font-size:11px;cursor:${td?'pointer':'default'};background:${bg};border:${border}" ${td ? `onclick="PlanungHandler.editTermin(${td.t.id})" title="${esc(td.label)} – ${esc(td.pruefer)}"` : ''}>
                <div style="font-weight:${isToday?'700':'400'};color:${td?'var(--clr-forest-dark)':'var(--clr-text-light)'}">${d}</div>
                ${td ? `<div style="font-size:9px;color:var(--clr-forest);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(td.label)}</div>` : ''}
              </div>`;
            }
            return `<div class="card" style="margin-bottom:8px">
              <div class="card-header" style="padding:8px 12px;font-size:13px">${monthName}</div>
              <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;padding:4px 8px 8px">
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Mo</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Di</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Mi</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Do</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Fr</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">Sa</div>
                <div style="font-size:9px;text-align:center;color:var(--clr-text-light);font-weight:600">So</div>
                ${cells}
              </div>
            </div>`;
          }).join('');
        })()}
      </div>

      <div id="planTable" class="card">
        ${termine.length ? `<table class="data-table"><thead><tr><th>Datum</th><th>Schule</th><th>Klasse(n)</th><th>Fachrichtung</th><th>Jahrgang</th><th>Schüler</th><th>Prüfer</th><th>Status</th><th>Aktionen</th></tr></thead><tbody id="planTableBody">
          ${termine.map(t => {
            const klassen = App.getTerminKlassen(t.id);
            const schule = klassen.length ? klassen[0].schule : '–';
            const ort = klassen.length ? klassen[0].schule_ort : '';
            const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
            const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ') || '–';
            const jgStr = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].join(', ') || '–';
            const schuelerCount = App.getTerminSchuelerCount(t.id);
            return `<tr data-status="${t.status}">
            <td data-sort="${t.geplant_datum}"><strong>${formatDate(t.geplant_datum)}</strong> <span style="font-size:10px;color:var(--clr-sage)">KW${getKW(t.geplant_datum)}</span></td>
            <td>${esc(schule)}${ort ? ` <small>(${esc(ort)})</small>` : ''}</td>
            <td>${esc(klassenStr)}</td>
            <td>${esc(frStr)}</td>
            <td data-sort="${esc(jgStr)}"><span class="badge-status badge-planned">${esc(jgStr)}</span></td>
            <td data-sort="${schuelerCount}">${schuelerCount}</td>
            <td>${esc(t.pruefer)}</td>
            <td data-sort="${t.status}">${statusBadge(t.status)}</td>
            <td class="btn-group" style="flex-wrap:wrap">
              ${t.status === 'geplant' ? `<button class="btn btn-sm btn-success" onclick="App.navigate('kontrolle');setTimeout(()=>KontrolleHandler.startKontrolle(${t.id}),100)">Starten</button>` : ''}
              <button class="btn btn-sm btn-secondary" onclick="Workflows.emailSchule(${t.id})" title="E-Mail an Schule (Terminankündigung)">📧 Schule</button>
              <button class="btn btn-sm btn-secondary" onclick="Workflows.seriendruckBetriebe(${t.id})" title="Betriebe anschreiben (Brief/CSV)">📄 Betriebe</button>
              <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.exportTerminPDF(${t.id})" title="Alle Durchsichtsbögen als PDF">📄 PDF</button>
              <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.printUebersicht(${t.id})" title="Übersichtsliste drucken">🖨️</button>
              <button class="btn-icon btn-sm" onclick="PlanungHandler.editTermin(${t.id})" title="Bearbeiten">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button class="btn-icon btn-sm" onclick="PlanungHandler.deleteTermin(${t.id})" title="Löschen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </td>
          </tr>`;}).join('')}
        </tbody></table>` : '<div class="empty-state"><h3>Keine Termine geplant</h3><p>Legen Sie einen neuen Kontrolltermin an.</p></div>'}
      </div>
    </div>`;
    // Apply default filter
    PlanungHandler.filterStatus(document.getElementById('planFilter')?.value || 'geplant');
  },

  // ════════════════════════════════════════════
  //  KONTROLLE DURCHFÜHREN
  // ════════════════════════════════════════════
  kontrolle() {
    const mc = document.getElementById('mainContent');
    const jfkt = App.jgWhere('kt.jahrgang_id');
    const termine = App.query(`SELECT kt.*
      FROM kontrolltermine kt
      WHERE 1=1${jfkt.where}
      ORDER BY kt.geplant_datum DESC`, jfkt.params);
    App.preloadTerminKlassen(termine.map(t => t.id));

    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Kontrolle durchführen</h2>
        <p>Berichtsheftdurchsicht dokumentieren</p>
      </div>
      ${App.filterBadgeHtml()}
      <div class="card">
        <div class="card-header">Kontrolltermin auswählen</div>
        <div class="form-group">
          <select class="form-control" id="selKontrolltermin" onchange="KontrolleHandler.loadTermin(this.value)">
            <option value="">– Bitte wählen –</option>
            ${termine.map(t => {
              const klassenStr = App.formatTerminKlassen(t.id);
              const klassen = App.getTerminKlassen(t.id);
              const schule = klassen.length ? klassen[0].schule : '?';
              const frAj = App.formatTerminFrAj(t.id);
              const isEins = t.typ === 'einsendung';
              const schuelerCount = isEins ? App.getTerminSchueler(t.id).length : 0;
              const label = isEins ? `📬 Einsendung (${schuelerCount} Schüler)` : `${esc(schule)} – ${esc(frAj)}`;
              return `<option value="${t.id}">KW${getKW(t.geplant_datum)} ${formatDate(t.geplant_datum)} – ${label} (${t.status})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
      <div id="kontrolleContent"></div>
    </div>`;
  },

  // ════════════════════════════════════════════
  //  WIEDERVORLAGEN
  // ════════════════════════════════════════════
  wiedervorlagen() {
    const today = new Date().toISOString().split('T')[0];

    // Update overdue status (silent – don't create dirty-ops, this is a local view optimization)
    try { App.db.run("UPDATE wiedervorlagen SET status='ueberfaellig' WHERE status='offen' AND frist_datum < ?", [today]); } catch(e) {}

    const jf = App.jgWhere('s.jahrgang_id');
    const wvs = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette,
      ke.ergebnis as ke_ergebnis, ke.kontrolltermin_id, j.bezeichnung as jahrgang
      FROM wiedervorlagen w
      JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE 1=1${jf.where}
      ORDER BY CASE w.status WHEN 'ueberfaellig' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, w.frist_datum`, jf.params);

    const mc = document.getElementById('mainContent');
    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Wiedervorlagen</h2>
        <p>Nachverfolgung mangelhafter Berichtshefte</p>
      </div>
      ${App.filterBadgeHtml()}
      <div class="toolbar">
        <div class="toolbar-left">
          <select class="form-control" style="width:auto" onchange="WiedervorlagenHandler.filter(this.value)" id="wvFilter">
            <option value="all" selected>Alle anzeigen</option>
            <option value="offen">Nur offene</option>
            <option value="ueberfaellig">Nur überfällige</option>
            <option value="erledigt">Nur erledigte</option>
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-secondary" onclick="WiedervorlagenHandler.exportICS()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
            ICS-Export
          </button>
        </div>
      </div>
      <div class="card">
        <!-- Bulk Action Bar -->
        <div id="bulkBarWV" style="display:none;padding:8px 12px;background:var(--clr-forest);color:white;border-radius:var(--radius);margin-bottom:8px;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
          <strong><span id="bulkCountWV">0</span> ausgewählt</strong>
          <span style="opacity:0.4">│</span>
          <button class="btn btn-sm" style="background:var(--clr-green);color:white;border:none" onclick="BulkWV.erledigtSelected()">✓ Als erledigt markieren</button>
          <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkWV.extendFrist()">Frist verlängern</button>
          <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="BulkWV.deleteSelected()">Löschen</button>
          <span style="margin-left:auto;opacity:0.6;cursor:pointer" onclick="BulkWV.deselectAll()">✕ Abwählen</span>
        </div>
        ${wvs.length ? `<table class="data-table"><thead><tr>
          <th style="width:30px"><input type="checkbox" id="chkAllWV" onchange="BulkWV.toggleAll(this.checked)"></th>
          <th>Schüler</th><th>Betrieb</th><th>Art</th><th>Frist</th><th>Status</th><th>Aktionen</th>
        </tr></thead><tbody id="wvTableBody">
          ${wvs.map(w => `<tr data-status="${w.status}">
            <td><input type="checkbox" class="chk-wv" value="${w.id}" onchange="BulkWV.updateBar()"></td>
            <td><strong>${esc(w.nachname)}</strong>, ${esc(w.vorname)}</td>
            <td>${esc(w.ausbildungsstaette)}</td>
            <td data-sort="${w.art}"><small>${wvArtLabel(w.art)}</small></td>
            <td data-sort="${w.frist_datum}">${formatDate(w.frist_datum)}</td>
            <td data-sort="${w.status}">${wvStatusBadge(w.status)}</td>
            <td class="btn-group" style="flex-wrap:wrap">
              ${w.status !== 'erledigt' ? '<button class="btn btn-sm" style="background:var(--clr-warm);color:var(--clr-forest);border:1.5px solid var(--clr-sage);font-weight:600;font-size:11px" onclick="WiedervorlagenHandler.erledigen(' + w.id + ')" title="Durchsicht öffnen und als in Ordnung markieren">→ Durchsicht</button>' : ''}
              ${w.kontrolltermin_id ? '<button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(' + w.kontrolltermin_id + ',' + w.schueler_id + ')" title="Durchsichtsbogen PDF">📄</button>' : ''}
              ${w.status !== 'erledigt' ? `<button class="btn btn-sm btn-secondary" onclick="Workflows.emailBetriebWV(${w.id})" title="E-Mail an Betrieb">📧</button>` : ''}
              <button class="btn-icon btn-sm" onclick="WiedervorlagenHandler.details(${w.id})" title="Details + History">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              </button>
            </td>
          </tr>`).join('')}
        </tbody></table>` : '<div class="empty-state"><h3>Keine Wiedervorlagen</h3><p>Wiedervorlagen werden automatisch bei mangelhaften Kontrollergebnissen erstellt.</p></div>'}
      </div>
    </div>`;
    // Apply initial filter
    WiedervorlagenHandler.filter(document.getElementById('wvFilter')?.value || 'all');
  },

  // ════════════════════════════════════════════
  //  BERICHTE
  // ════════════════════════════════════════════
  berichte() {
    const mc = document.getElementById('mainContent');
    const jfkt = App.jgWhere('kt.jahrgang_id');
    const termine = App.query(`SELECT kt.*,
      (SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=kt.id AND ergebnis != '') as kontrolliert
      FROM kontrolltermine kt
      WHERE kt.status='durchgefuehrt'${jfkt.where}
      ORDER BY kt.geplant_datum DESC`, jfkt.params);
    App.preloadTerminKlassen(termine.map(t => t.id));

    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Berichte & Export</h2>
        <p>Durchsichtsbögen, Klassenübersichten und Statistiken exportieren</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header">📄 Durchsichtsbögen exportieren (pro Kontrolltermin)</div>
        ${termine.length ? `<table class="data-table"><thead><tr><th>Datum</th><th>Schule</th><th>Klasse(n)</th><th>Kontrolliert</th><th>Export</th></tr></thead><tbody>
          ${termine.map(t => {
            const klassen = App.getTerminKlassen(t.id);
            const schule = klassen.length ? klassen[0].schule : '–';
            const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
            return `<tr>
            <td>${formatDate(t.geplant_datum)} <span style="font-size:10px;color:var(--clr-sage)">KW${getKW(t.geplant_datum)}</span></td>
            <td>${esc(schule)}</td>
            <td>${esc(klassenStr)}</td>
            <td>${t.kontrolliert} Schüler</td>
            <td>
              <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.printUebersicht(${t.id})" title="Übersichtsliste drucken">🖨️</button>
              <button class="btn btn-sm btn-primary" onclick="PlanungHandler.exportTerminPDF(${t.id})">📄 Alle Bögen (PDF)</button>
              <button class="btn btn-sm btn-secondary" onclick="BerichteHandler.gesamtpaket(${t.id})" title="PDFs + Seriendruck + E-Mail in einem Schritt">📦 Gesamtpaket</button>
            </td>
          </tr>`;}).join('')}
        </tbody></table>` : '<p style="font-size:13px;color:var(--clr-text-light);padding:8px">Keine durchgeführten Kontrolltermine im aktuellen Jahrgang.</p>'}
      </div>

      <div class="grid-3" style="margin-bottom:16px">
        <div class="card" style="cursor:pointer" onclick="BerichteHandler.exportKlasse()">
          <div class="card-header">Klassenübersicht (PDF)</div>
          <p style="font-size:13px;color:var(--clr-text-light)">Ergebnisse einer Klasse als Tabellen-PDF.</p>
        </div>
        <div class="card" style="cursor:pointer" onclick="BerichteHandler.exportEinzel()">
          <div class="card-header">Einzelner Durchsichtsbogen</div>
          <p style="font-size:13px;color:var(--clr-text-light)">Einen einzelnen Schüler-Bogen als PDF.</p>
        </div>
        <div class="card" style="cursor:pointer" onclick="BerichteHandler.exportStatistik()">
          <div class="card-header">Statistik (CSV)</div>
          <p style="font-size:13px;color:var(--clr-text-light)">Zusammenfassung pro Schule/Jahrgang.</p>
        </div>
      </div>
      <div class="card" style="cursor:pointer;border-left:4px solid var(--clr-forest)" onclick="BerichteHandler.jahresbericht()">
        <div class="card-header">📊 Jahresbericht generieren</div>
        <p style="font-size:13px;color:var(--clr-text-light)">Gesamtstatistik als PDF: Anzahl kontrolliert, Mängelquote, Top-Codes, Betrieb-Ranking, Vergleich pro Schule.</p>
      </div>
    </div>`;
  },

  // ════════════════════════════════════════════
  //  EINSTELLUNGEN
  // ════════════════════════════════════════════
  einstellungen() {
    const mc = document.getElementById('mainContent');
    // DB stats
    const tables = ['schueler','betriebe','klassen','berufsschulen','kontrolltermine','kontrollergebnisse','wiedervorlagen','kw_status','durchsicht_snapshots','pruefer'];
    const stats = tables.map(t => {
      try { return { name: t, count: App.scalar(`SELECT COUNT(*) FROM ${t}`) || 0 }; }
      catch(e) { return { name: t, count: '–' }; }
    });
    const totalRows = stats.reduce((s,r) => s + (typeof r.count === 'number' ? r.count : 0), 0);
    const integrity = (() => { try { return App.query("PRAGMA integrity_check")[0]?.integrity_check || 'ok'; } catch(e) { return 'error'; } })();

    // Settings
    const emailFreisprechung = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='email_freisprechung'") || '';
    const rpAdresseP = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_persoenlich'") || '';
    const rpAdressePost = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_post'") || '';
    const isDark = document.body.classList.contains('dark-mode');

    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Einstellungen</h2>
        <p>Datenbank-Statistik, Kontaktdaten und Darstellung</p>
      </div>

      <div class="grid-2">
        <!-- DB Stats -->
        <div class="card">
          <div class="card-header">📊 Datenbank-Statistik</div>
          <div style="display:grid;grid-template-columns:1fr auto;gap:2px 16px;font-size:13px;padding:4px 0">
            ${stats.map(s => `<span>${s.name}</span><strong>${s.count}</strong>`).join('')}
            <span style="border-top:1px solid var(--clr-sand);padding-top:4px;margin-top:4px;font-weight:600">Gesamt</span>
            <strong style="border-top:1px solid var(--clr-sand);padding-top:4px;margin-top:4px">${totalRows}</strong>
          </div>
          <div style="margin-top:8px;font-size:11px;color:${integrity==='ok'?'var(--clr-green)':'var(--clr-red)'}">
            Integrität: ${integrity === 'ok' ? '✓ OK' : '✗ ' + integrity}
          </div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn btn-sm btn-secondary" onclick="App.saveDatabase();App.toast('Gespeichert','success')">💾 Jetzt speichern</button>
            <button class="btn btn-sm btn-secondary" onclick="App.reloadFromFile&&App.reloadFromFile();App.toast('Neu geladen','success')">🔄 Neu laden</button>
          </div>
        </div>

        <!-- Darstellung -->
        <div class="card">
          <div class="card-header">🎨 Darstellung</div>
          <div style="padding:8px 0">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;margin-bottom:12px">
              <input type="checkbox" ${isDark?'checked':''} onchange="document.body.classList.toggle('dark-mode',this.checked);try{App.uSet('dark',this.checked?'1':'0')}catch(e){}" style="width:20px;height:20px;accent-color:var(--clr-forest)">
              🌙 Dark Mode
            </label>
            <p style="font-size:12px;color:var(--clr-text-light)">Tastenkürzel: <strong>F1</strong> oder <strong>?</strong> für Hilfe, <strong>Ctrl+K</strong> für Suche</p>
          </div>
        </div>
      </div>

      <!-- Sichtbare Menüpunkte -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">📌 Sichtbare Menüpunkte</div>
        <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
          Menüpunkte ein-/ausblenden. Weniger genutzte Funktionen können ausgeblendet werden, um die Sidebar übersichtlich zu halten.
        </p>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${Object.entries(App.SIDEBAR_FEATURES).map(([key, cfg]) => {
            const vis = App._getSidebarVisibility();
            const isOn = vis[key] !== undefined ? vis[key] : cfg.default;
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius);cursor:pointer;font-size:13px">
              <input type="checkbox" ${isOn ? 'checked' : ''} onchange="App._toggleSidebarFeature('${key}',this.checked)" style="accent-color:var(--clr-forest);width:18px;height:18px">
              ${esc(cfg.label)}
            </label>`;
          }).join('')}
        </div>
      </div>

      <!-- Kontaktdaten für E-Mails und PDFs -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">📧 Kontaktdaten (für E-Mails & PDFs)</div>
        <div class="form-group"><label>E-Mail Freisprechung</label>
          <input class="form-control" id="setEmailFreispr" value="${esc(emailFreisprechung)}" placeholder="Freisprechung.GB@rpf.bwl.de">
        </div>
        <div class="form-group"><label>RP-Adresse (persönlich, für Wiedervorlagen)</label>
          <textarea class="form-control" id="setRPPers" rows="2" style="font-size:12px">${esc(rpAdresseP)}</textarea>
        </div>
        <div class="form-group"><label>RP-Adresse (Post, für Serienbriefe)</label>
          <textarea class="form-control" id="setRPPost" rows="2" style="font-size:12px">${esc(rpAdressePost)}</textarea>
        </div>
        <button class="btn btn-primary" onclick="Views.saveEinstellungen()">Einstellungen speichern</button>
      </div>

      <!-- Textbausteine für Bemerkungen + Sonstiges -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">📝 Textbausteine für Bemerkungen</div>
        <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
          Diese Textbausteine erscheinen als klickbare Auswahl im Bemerkungsfeld und im „I – Sonstiges"-Modal.
        </p>
        <div id="textbausteineList"></div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input class="form-control" id="newTextbaustein" placeholder="Neuen Textbaustein eingeben…" style="flex:1;font-size:12px"
            onkeydown="if(event.key==='Enter'){Views.addTextbaustein();event.preventDefault()}">
          <button class="btn btn-sm btn-primary" onclick="Views.addTextbaustein()">+ Hinzufügen</button>
        </div>
      </div>

      <!-- LLM API für Blockplan-Analyse -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">🤖 KI-Einstellungen (für Blockplan-Analyse)</div>
        <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
          PDF-Seiten werden als Bild an ein Vision-Model gesendet – die KI sieht die Tabelle exakt wie ein Mensch.
        </p>
        <details style="margin-bottom:8px">
          <summary style="cursor:pointer;font-size:11px;color:var(--clr-forest);font-weight:600">Modell-Empfehlungen anzeigen</summary>
          <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px;margin-top:4px;line-height:1.8">
            <strong>⭐ GPT-5.4</strong> (OpenAI) – Beste Tabellen-Erkennung, 10M+ Pixel Vision, ~$0.01/Analyse<br>
            <strong>Claude Sonnet 4</strong> (Anthropic) – Sehr gute Vision, zuverlässig, ~$0.01/Analyse<br>
            <strong>Gemini 2.5 Flash</strong> (Google) – Kostenlos mit Rate-Limit, gute Vision<br>
            <strong>llava</strong> (Ollama) – Komplett lokal/kostenlos, mittlere Qualität<br>
            <em>Tipp: Das Modell ist frei wählbar – tippen Sie einfach einen neueren Modellnamen ein wenn verfügbar.</em>
          </div>
        </details>
        <div class="form-row">
          <div class="form-group"><label>Anbieter</label>
            <select class="form-control" id="setLLMProvider" onchange="document.getElementById('setLLMModel').value={'claude':'claude-sonnet-4-20250514','openai':'gpt-5.4','gemini':'gemini-2.5-flash','ollama':'llava'}[this.value]||''">
              <option value="claude" ${(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_provider'")||'claude')==='claude'?'selected':''}>Anthropic (Claude Sonnet 4)</option>
              <option value="openai" ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_provider'")==='openai'?'selected':''}>OpenAI (GPT-5.4) ⭐ Empfohlen</option>
              <option value="gemini" ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_provider'")==='gemini'?'selected':''}>Google (Gemini 2.5 Flash) – Kostenlos</option>
              <option value="ollama" ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_provider'")==='ollama'?'selected':''}>Ollama (llava) – Lokal</option>
            </select>
          </div>
          <div class="form-group"><label>Modell</label>
            <input class="form-control" id="setLLMModel" value="${esc(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_model'")||'claude-sonnet-4-20250514')}" placeholder="z.B. claude-sonnet-4-20250514">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>API-Key</label>
            <input class="form-control" id="setLLMKey" type="password" value="${esc(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_api_key'")||'')}" placeholder="sk-... oder eigener Key">
          </div>
          <div class="form-group"><label>Ollama URL (nur bei Ollama)</label>
            <input class="form-control" id="setLLMUrl" value="${esc(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_url'")||'http://localhost:11434')}" placeholder="http://localhost:11434">
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="Views.testLLM()">🧪 Verbindung testen</button>
        <button class="btn btn-sm btn-primary" onclick="Views.saveLLMSettings()" style="margin-left:6px">Speichern</button>
        <span id="llmTestResult" style="margin-left:8px;font-size:12px"></span>
      </div>

      <!-- Word-Vorlage für Serienbriefe -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">📝 Word-Vorlage für Serienbriefe an Betriebe</div>
        <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
          Laden Sie eine .docx-Datei hoch, die als Vorlage für Serienbriefe an Betriebe verwendet wird. Verwenden Sie geschweifte Klammern für Platzhalter.
        </p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <input type="file" id="wordTemplateUpload" accept=".docx" style="display:none" onchange="Views.uploadWordTemplate(this.files[0])">
          <button class="btn btn-sm btn-secondary" onclick="document.getElementById('wordTemplateUpload').click()">📎 Vorlage hochladen (.docx)</button>
          ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template_name'") ? `<span style="font-size:12px;color:var(--clr-green)">✓ ${esc(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='word_template_name'") || '')}</span>
          <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:var(--clr-red-light);color:var(--clr-red);border:1px solid var(--clr-red)" onclick="App.run(&quot;DELETE FROM einstellungen WHERE schluessel IN ('word_template','word_template_name')&quot;);Views.einstellungen()">✕ Entfernen</button>` : '<span style="font-size:12px;color:var(--clr-text-light)">Keine Vorlage hinterlegt (Standard-PDF wird verwendet)</span>'}
        </div>
        <details>
          <summary style="cursor:pointer;font-size:12px;color:var(--clr-forest);font-weight:600">Verfügbare Platzhalter anzeigen</summary>
          <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);margin-top:6px;font-size:12px;font-family:monospace;line-height:2">
            <div><code>{betrieb_name}</code> – Betriebsname (Nachname)</div>
            <div><code>{betrieb_vorname}</code> – Betriebsvorname</div>
            <div><code>{betrieb_zusatzbezeichnung}</code> – Zusatzbezeichnung</div>
            <div><code>{betrieb_firma}</code> – Firmenbezeichnung (= Zusatz falls vorhanden)</div>
            <div><code>{betrieb_ansprechpartner}</code> – Ansprechpartner</div>
            <div><code>{betrieb_strasse}</code> – Straße</div>
            <div><code>{betrieb_plz}</code> – PLZ</div>
            <div><code>{betrieb_ort}</code> – Ort</div>
            <div><code>{azubi_namen}</code> – Alle Azubi-Namen (kommagetrennt)</div>
            <div><code>{azubi_anzahl}</code> – Anzahl Azubis</div>
            <div><code>{kontrolldatum}</code> – Datum der Kontrolle</div>
            <div><code>{schule}</code> – Name der Berufsschule</div>
            <div><code>{klassen}</code> – Klassenbezeichnungen</div>
            <div><code>{fachrichtung}</code> – Fachrichtung(en)</div>
            <div><code>{pruefer}</code> – Prüfer-Name(n)</div>
            <div><code>{rp_adresse}</code> – RP-Postadresse</div>
            <div><code>{datum_heute}</code> – Heutiges Datum</div>
            <div><code>{maengel_liste}</code> – Auflistung der Mängel pro Azubi (KW + Codes)</div>
            <div><code>{ergebnis_details}</code> – Ergebnis pro Azubi (Name + Ergebnis)</div>
            <div><code>{betrieb_email}</code> – E-Mail-Adresse des Betriebs</div>
            <div><code>{frist_datum}</code> – Wiedervorlage-Frist</div>
          </div>
        </details>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px" onclick="Views.downloadSampleTemplate()">📄 Beispiel-Vorlage herunterladen</button>
      </div>

      <!-- Import-History -->
      ${(() => {
        const history = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='import_history'") || '[]');
        if (!history.length) return '';
        return `<div class="card" style="margin-top:16px">
          <div class="card-header">📥 Import-Verlauf (letzte ${history.length})</div>
          <table class="data-table"><thead><tr><th>Datum</th><th>Importiert</th><th>Übersprungen</th><th>CSV-Zeilen</th></tr></thead><tbody>
            ${history.map(h => `<tr>
              <td>${new Date(h.datum).toLocaleString('de-DE')}</td>
              <td><strong>${h.importiert}</strong></td>
              <td>${h.uebersprungen}</td>
              <td>${h.zeilen}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>`;
      })()}

      <!-- Betrieb-Duplikate -->
      ${(() => {
        const dupes = App.query(`SELECT b1.id as id1, b1.name as name1, b2.id as id2, b2.name as name2
          FROM betriebe b1, betriebe b2
          WHERE b1.id < b2.id AND (
            b1.name = b2.name
            OR (length(b1.name) > 5 AND b2.name LIKE '%' || b1.name || '%')
            OR (length(b2.name) > 5 AND b1.name LIKE '%' || b2.name || '%')
          ) LIMIT 10`);
        if (!dupes.length) return '';
        return `<div class="card" style="margin-top:16px;border-left:4px solid var(--clr-amber)">
          <div class="card-header">🔍 Mögliche Betrieb-Duplikate (${dupes.length})</div>
          <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Diese Betriebe könnten identisch sein. Prüfen und ggf. unter Stammdaten → Betriebe zusammenführen.</div>
          <table class="data-table"><thead><tr><th>Betrieb A</th><th>Betrieb B</th><th>Aktion</th></tr></thead><tbody>
            ${dupes.map(d => `<tr>
              <td>${esc(d.name1)} <span style="color:var(--clr-text-light);font-size:10px">#${d.id1}</span></td>
              <td>${esc(d.name2)} <span style="color:var(--clr-text-light);font-size:10px">#${d.id2}</span></td>
              <td><button class="btn btn-sm btn-secondary" onclick="Views.mergeBetriebe(${d.id1},${d.id2},'${esc(d.name1).replace(/'/g,"\\'")}','${esc(d.name2).replace(/'/g,"\\'")}')" style="font-size:10px">Zusammenführen</button></td>
            </tr>`).join('')}
          </tbody></table>
        </div>`;
      })()}
    </div>`;
    setTimeout(() => this.renderTextbausteine(), 50);
  },

  saveEinstellungen() {
    const sets = [
      ['email_freisprechung', document.getElementById('setEmailFreispr').value.trim()],
      ['rp_adresse_persoenlich', document.getElementById('setRPPers').value.trim()],
      ['rp_adresse_post', document.getElementById('setRPPost').value.trim()],
    ];
    sets.forEach(([k,v]) => {
      App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES (?,?)", [k,v]);
    });
    App.toast('Einstellungen gespeichert', 'success');
  },

  // ── Textbausteine CRUD ──
  renderTextbausteine() {
    const el = document.getElementById('textbausteineList');
    if (!el) return;
    const items = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');
    if (!items.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light);padding:6px">Noch keine Textbausteine definiert.</div>';
      return;
    }
    el.innerHTML = items.map((text, i) => `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--clr-sand)">
        <span style="flex:1;font-size:12px">${esc(text)}</span>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 6px" onclick="Views.editTextbaustein(${i})">✏️</button>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--clr-red)" onclick="Views.removeTextbaustein(${i})">✕</button>
      </div>
    `).join('');
  },

  addTextbaustein() {
    const input = document.getElementById('newTextbaustein');
    const text = input?.value?.trim();
    if (!text) return;
    const items = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');
    items.push(text);
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)", [JSON.stringify(items)]);
    input.value = '';
    this.renderTextbausteine();
    App.toast('Textbaustein hinzugefügt', 'success');
  },

  editTextbaustein(idx) {
    const items = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');
    const newText = prompt('Textbaustein bearbeiten:', items[idx]);
    if (newText === null) return;
    if (!newText.trim()) { this.removeTextbaustein(idx); return; }
    items[idx] = newText.trim();
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)", [JSON.stringify(items)]);
    this.renderTextbausteine();
  },

  removeTextbaustein(idx) {
    const items = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');
    items.splice(idx, 1);
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)", [JSON.stringify(items)]);
    this.renderTextbausteine();
    App.toast('Textbaustein entfernt', 'success');
  },

  saveLLMSettings() {
    [['llm_provider', document.getElementById('setLLMProvider').value],
     ['llm_model', document.getElementById('setLLMModel').value.trim()],
     ['llm_api_key', document.getElementById('setLLMKey').value.trim()],
     ['llm_url', document.getElementById('setLLMUrl').value.trim()]
    ].forEach(([k,v]) => App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES (?,?)", [k,v]));
    App.toast('KI-Einstellungen gespeichert', 'success');
  },

  async testLLM() {
    const res = document.getElementById('llmTestResult');
    res.innerHTML = '⏳ Teste…';
    try {
      const reply = await LLMHelper.call('Antworte nur mit dem Wort OK.');
      res.innerHTML = reply.includes('OK') ? '<span style="color:var(--clr-green)">✓ Verbindung OK</span>' : `<span style="color:var(--clr-amber)">⚠ Antwort: ${reply.substring(0,50)}</span>`;
    } catch(e) {
      res.innerHTML = `<span style="color:var(--clr-red)">✗ ${e.message}</span>`;
    }
  },

  uploadWordTemplate(file) {
    if (!file || !file.name.endsWith('.docx')) return App.toast('Bitte eine .docx-Datei auswählen', 'error');
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('word_template',?)", [base64]);
      App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('word_template_name',?)", [file.name]);
      App.toast(`Vorlage "${file.name}" gespeichert`, 'success');
      Views.einstellungen();
    };
    reader.readAsDataURL(file);
  },

  downloadSampleTemplate() {
    try {
      // Build minimal valid .docx via OOXML
      const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
      const R1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      const R2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const par = (t, b, s, j) => {
        let pp = '';
        if (j) pp += '<w:jc w:val="' + j + '"/>';
        if (s) pp += '<w:rPr><w:sz w:val="' + s + '"/><w:szCs w:val="' + s + '"/></w:rPr>';
        const ppr = pp ? '<w:pPr>' + pp + '</w:pPr>' : '';
        let rpr = '';
        if (b) rpr = '<w:rPr><w:b/><w:bCs/></w:rPr>';
        else if (s) rpr = '<w:rPr><w:sz w:val="' + s + '"/><w:szCs w:val="' + s + '"/></w:rPr>';
        const txt = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<w:p>' + ppr + '<w:r>' + rpr + '<w:t xml:space="preserve">' + txt + '</w:t></w:r></w:p>';
      };

      const lines = [
        par('{rp_adresse}', false, '16'),
        par(''),
        par('{betrieb_zusatzbezeichnung}'),
        par('{betrieb_vorname} {betrieb_name}'),
        par('{betrieb_strasse}'),
        par('{betrieb_plz} {betrieb_ort}'),
        par(''),
        par('Freiburg, {datum_heute}', false, null, 'right'),
        par(''),
        par('Berichtsheftkontrolle am {kontrolldatum}', true),
        par(''),
        par('Sehr geehrte Damen und Herren,'),
        par(''),
        par('am {kontrolldatum} findet an der {schule} die Berichtsheftkontrolle statt.'),
        par('Klasse(n): {klassen} ({fachrichtung})'),
        par(''),
        par('Folgende Ihrer Auszubildenden sind betroffen:'),
        par('{azubi_namen}'),
        par(''),
        par('Ergebnis (nach Kontrolle):'),
        par('{ergebnis_details}'),
        par(''),
        par('Bitte stellen Sie sicher, dass die Berichtshefte vollstaendig gefuehrt und unterschrieben vorliegen.'),
        par(''),
        par('Mit freundlichen Gruessen'),
        par(''),
        par('{pruefer}'),
        par('Regierungspraesidium Freiburg'),
      ];

      const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="' + W + '"><w:body>' + lines.join('\n') + '</w:body></w:document>';

      const z = new PizZip();
      z.file('[Content_Types].xml', CT);
      z.file('_rels/.rels', R1);
      z.file('word/_rels/document.xml.rels', R2);
      z.file('word/document.xml', doc);
      const blob = z.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      saveAs(blob, 'BHK_Seriendruck_Vorlage.docx');
      App.toast('Word-Vorlage heruntergeladen', 'success');
    } catch(e) {
      console.error('Template:', e);
      // Fallback: download as plain text
      const text = 'Regierungspräsidium Freiburg\n{rp_adresse}\n\n{betrieb_zusatzbezeichnung}\n{betrieb_vorname} {betrieb_name}\n{betrieb_strasse}\n{betrieb_plz} {betrieb_ort}\n\nFreiburg, {datum_heute}\n\nBerichtsheftkontrolle am {kontrolldatum}\n\nSehr geehrte Damen und Herren,\n\nam {kontrolldatum} findet an der {schule} die Berichtsheftkontrolle statt.\nKlasse(n): {klassen} ({fachrichtung})\n\nFolgende Ihrer Auszubildenden sind betroffen:\n{azubi_namen}\n\nErgebnis:\n{ergebnis_details}\n\nMit freundlichen Grüßen\n{pruefer}';
      const blob = new Blob([text], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'BHK_Seriendruck_Vorlage.docx';
      a.click();
      App.toast('Vorlage heruntergeladen (Fallback) – bitte in Word öffnen und Formatierung anpassen', 'info');
    }
  },

  mergeBetriebe(keepId, removeId, keepName, removeName) {
    if (!confirm(`Betriebe zusammenführen?\n\nBehalten: "${keepName}" (#${keepId})\nLöschen: "${removeName}" (#${removeId})\n\nAlle Schüler von #${removeId} werden auf #${keepId} umgehängt.`)) return;
    // Move all schueler references
    App.run('UPDATE schueler SET betrieb_id=? WHERE betrieb_id=?', [keepId, removeId]);
    // Merge contact data (fill gaps in keeper from removed)
    const keep = App.query('SELECT * FROM betriebe WHERE id=?', [keepId])[0];
    const rem = App.query('SELECT * FROM betriebe WHERE id=?', [removeId])[0];
    if (rem) {
      ['email','telefon','strasse','plz','ort','ansprechpartner','firma'].forEach(f => {
        if (!keep[f] && rem[f]) App.run(`UPDATE betriebe SET ${f}=? WHERE id=?`, [rem[f], keepId]);
      });
    }
    App.run('DELETE FROM betriebe WHERE id=?', [removeId]);
    App.toast(`Betriebe zusammengeführt → ${keepName}`, 'success');
    Views.einstellungen();
  },

  // ════════════════════════════════════════════
  //  NACHERFASSUNG (Schnellerfassung vergangener Kontrollen)
  // ════════════════════════════════════════════
  nacherfassung() {
    const mc = document.getElementById('mainContent');
    const schulen = App.query("SELECT DISTINCT bs.* FROM berufsschulen bs WHERE 1=1" + App.gf('schulen') + " ORDER BY bs.name");
    const jahrgaenge = App.query("SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ");
    const aemter = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE aktiv=1 AND zustaendiges_amt != '' ORDER BY zustaendiges_amt");

    mc.innerHTML = `<div class="fade-in" style="padding-top:28px">
      <div class="page-header">
        <h2>⏱️ Nacherfassung</h2>
        <p>Vergangene Berichtsheftdurchsichten schnell nacherfassen</p>
      </div>
      ${App.filterBadgeHtml()}

      <div class="card" style="margin-bottom:16px">
        <div class="card-header">1. Termin & Filter wählen</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Datum der Durchsicht</label>
            <input type="date" class="form-control" id="neTerminDatum" value="${new Date().toISOString().split('T')[0]}" style="width:160px">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Prüfer</label>
            <select class="form-control" id="neTerminPruefer" style="width:auto">
              ${App.query('SELECT name FROM pruefer WHERE aktiv=1').map(p => `<option>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Schule</label>
            <select class="form-control" id="neSchule" style="width:auto" onchange="NacherfassungHandler.loadKlassen()">
              <option value="">– Schule wählen –</option>
              ${schulen.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Klasse</label>
            <select class="form-control" id="neKlasse" style="width:auto" onchange="NacherfassungHandler.loadSchueler()">
              <option value="">– alle Klassen –</option>
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Jahrgang (AP)</label>
            <select class="form-control" id="neJahrgang" style="width:auto" onchange="NacherfassungHandler.loadSchueler()">
              <option value="">Alle</option>
              ${jahrgaenge.map(j => `<option value="${j.id}">${esc(j.bezeichnung)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px">Amt</label>
            <select class="form-control" id="neAmt" style="width:auto" onchange="NacherfassungHandler.loadSchueler()">
              <option value="">Alle</option>
              ${aemter.map(a => `<option value="${esc(a.zustaendiges_amt)}">${App.amtLabel(a.zustaendiges_amt)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="neSchuelerArea"></div>

      <!-- Nicht erfasste Schüler -->
      <div class="card" style="margin-top:16px" id="neNichtErfasst">
        <div class="card-header" style="cursor:pointer" onclick="document.getElementById('neNichtErfasstBody').style.display=document.getElementById('neNichtErfasstBody').style.display==='none'?'':'none'">
          📋 Noch nicht kontrollierte Schüler <span id="neNichtErfasstCount" style="font-size:11px;color:var(--clr-amber)"></span>
          <span style="float:right;color:var(--clr-text-light)">▾</span>
        </div>
        <div id="neNichtErfasstBody" style="display:none"></div>
      </div>
    </div>`;
    NacherfassungHandler._updateNichtErfasst();
  },

  // ════════════════════════════════════════════
  //  HILFE
  // ════════════════════════════════════════════
  hilfe() {
    const c = document.getElementById('mainContent');
    const version = '1.0';
    const buildDate = '20.03.2026';
    c.innerHTML = `
    <div class="fade-in" style="padding-top:28px">
    <div style="max-width:900px;margin:0 auto">
      <h2 style="font-size:22px;margin-bottom:4px">📖 Hilfe – Berichtsheftkontrolle</h2>
      <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:16px">Version ${version} · Stand: ${buildDate} · Regierungspräsidium Freiburg, Abt. 3, Ref. 31</p>

      <div style="display:grid;grid-template-columns:240px 1fr;gap:16px;align-items:start">
        <!-- Navigation -->
        <div class="card" id="helpNav" style="position:sticky;top:8px;padding:8px 0;font-size:13px">
          <div style="padding:4px 16px;font-weight:700;color:var(--clr-forest-dark);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Inhalt</div>
          ${['Schnellstart','Ordnerstruktur','Startbildschirm','Dashboard','Stammdaten','IBYKUS-Import','Kontrollplanung','Kontrolldurchführung','KW-Raster','Wiedervorlagen','Berichte & Export','Jahresbericht PDF','Globale Filter','Globale Suche','Multi-User & Sync','Datensicherung','Tastenkürzel','Nacherfassung (Altdaten)','Wartung & Administration','Weiterentwicklung','KI-gestützte Entwicklung','Zeitersparnis & Arbeitserleichterung','Datenschutz & Rechtskonformität','FAQ'].map((t,i) => `<a href="#" class="help-nav-link" data-section="${i}" onclick="document.getElementById('help_${i}').scrollIntoView({behavior:'smooth',block:'start'});return false" style="display:block;padding:4px 16px;color:var(--clr-text);text-decoration:none;border-left:3px solid transparent;transition:background 0.15s,border-color 0.15s">${t}</a>`).join('')}
        </div>

        <!-- Content -->
        <div style="font-size:13px;line-height:1.7">

          <div id="help_0" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">🚀 Schnellstart</div>
            <p>Die Berichtsheftkontrolle ist ein Browser-Tool zur Planung, Durchführung und Nachverfolgung von Berichtsheft-Durchsichten für Gärtner-Ausbildungsberufe. Die gesamte Anwendung läuft lokal im Browser – es werden keine Daten an externe Server gesendet.</p>
            <p style="margin-top:8px"><strong>Typischer Workflow:</strong></p>
            <p>1. <strong>IBYKUS-Import</strong> → Azubi-Daten aus dem BAV-System importieren</p>
            <p>2. <strong>Kontrollplanung</strong> → Termine anlegen und Klassen zuweisen</p>
            <p>3. <strong>Kontrolldurchführung</strong> → KW-Raster ausfüllen, Ergebnisse vergeben</p>
            <p>4. <strong>Nachverfolgung</strong> → Wiedervorlagen bearbeiten, Berichte exportieren</p>
          </div>

          <div id="help_1" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📁 Ordnerstruktur</div>
            <p>Die App erstellt beim ersten Start automatisch diese Struktur im gewählten Arbeitsordner:</p>
            <div style="background:var(--clr-sand-light);padding:12px;border-radius:var(--radius);font-family:monospace;font-size:12px;margin:8px 0">
              Berichtsheftkontrolle/<br>
              ├── berichtsheftkontrolle.html &nbsp;&nbsp;← <em>Die App</em><br>
              ├── <strong>Datenbanken/</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← <em>Alle .sqlite-Dateien</em><br>
              │&nbsp;&nbsp; └── berichtsheftkontrolle.sqlite<br>
              └── <strong>_bhk/</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← <em>App-Daten (nicht anfassen!)</em><br>
              &nbsp;&nbsp;&nbsp;&nbsp;├── sync_berichtsheftkontrolle &nbsp;← <em>Sync-Marker</em><br>
              &nbsp;&nbsp;&nbsp;&nbsp;├── pos-Hannes_Pix.json &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← <em>Prüfer-Positionen</em><br>
              &nbsp;&nbsp;&nbsp;&nbsp;└── backups/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← <em>Automatische Backups</em>
            </div>
            <p><strong>Datenbanken/</strong> kann mehrere .sqlite-Dateien enthalten (z.B. für verschiedene Jahre). Bei Start wird die zuletzt geöffnete automatisch geladen.</p>
          </div>

          <div id="help_2" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">🏠 Startbildschirm</div>
            <p>Beim Öffnen der HTML-Datei wird der Startbildschirm angezeigt:</p>
            <p>• <strong>Erneut verbinden</strong> – Lädt die zuletzt geöffnete Datenbank (1 Klick, Chrome fragt einmal nach Berechtigung)</p>
            <p>• <strong>Arbeitsordner auswählen</strong> – Ordner wählen, dann eine der gefundenen Datenbanken öffnen</p>
            <p>• <strong>Neue Datenbank erstellen</strong> – Leere DB mit wählbarem Namen anlegen</p>
            <p>• <strong>Demo-Modus</strong> – Testdaten im Arbeitsspeicher, ohne Speicherung</p>
            <p style="margin-top:8px;color:var(--clr-amber)">⚠️ Nur <strong>Google Chrome</strong> und <strong>Microsoft Edge</strong> werden unterstützt (File System Access API).</p>
          </div>

          <div id="help_3" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📊 Dashboard</div>
            <p>Das Dashboard zeigt eine Übersicht aller wichtigen Kennzahlen:</p>
            <p>• <strong>Kontrollstatus-Slider</strong> – Zeigt Azubis die seit X Monaten nicht kontrolliert wurden. Slider auf 0 = noch nie kontrolliert.</p>
            <p>• <strong>Anstehende Prüfungstermine</strong> – Liste der nächsten Abschlussprüfungen mit Azubi-Anzahl.</p>
            <p>• <strong>Top-Betriebe</strong> – Betriebe mit den meisten Azubis (Top 10).</p>
            <p>• <strong>Diagramme</strong>:</p>
            <p>&nbsp;&nbsp;🍩 Kontrollfortschritt – OK / Beanstandet / Offen</p>
            <p>&nbsp;&nbsp;👫 Geschlechterquote – Männlich / Weiblich / Divers</p>
            <p>&nbsp;&nbsp;🗺 Regionale Verteilung – Nach zuständigem Amt</p>
            <p>&nbsp;&nbsp;🎓 Schulabschlüsse – Vor der Ausbildung (Codes 1-5)</p>
            <p>&nbsp;&nbsp;📋 Prüfungserfolg – Bestanden / Nicht bestanden / WDH</p>
            <p>&nbsp;&nbsp;🌿 Fachrichtungen – Gärtner vs. Fachwerker (Balkendiagramm)</p>
            <p>&nbsp;&nbsp;🕸 Mängelverteilung – Häufigkeit der Mängelcodes A-I</p>
            <p style="margin-top:6px">Alle Diagramme reagieren auf die <strong>globalen Filter</strong> (Jahrgang, Berufsgruppe, Amt, BAV-Status).</p>
          </div>

          <div id="help_4" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📋 Stammdaten</div>
            <p>Die Stammdaten-Verwaltung hat mehrere Tabs:</p>
            <p><strong>Azubis</strong> – Durchsuchbare Liste aller aktiven Azubis mit Ampel-Status, Betrieb, Kontrollen-Historie und Pagination (50 pro Seite). Filterbar nach Jahrgang und Schule.</p>
            <p><strong>Jahrgänge</strong> – Abschlussjahrgänge verwalten. Bezeichnung = Prüfungszeitraum der Abschlussprüfung: <strong>S</strong> = Sommer, <strong>W</strong> = Winter, <strong>F</strong> = Frühjahr, <strong>H</strong> = Herbst. Beispiel: S2027 = Sommerprüfung 2027, H2026 = Herbstprüfung 2026.</p>
            <p><strong>Schulen</strong> – Berufsschulen mit Kontaktdaten, E-Mail-CC und Ansprechpartnern.</p>
            <p><strong>Betriebe</strong> – Ausbildungsbetriebe mit Adresse, Kontakt und Azubi-Zuordnung.</p>
            <p><strong>Fachrichtungen</strong> – Gärtner-Fachrichtungen und Fachwerker-Berufe.</p>
            <p><strong>Klassen</strong> – Automatisch generierte Klassen (Schule + Jahrgang + Fachrichtung + Lehrjahr).</p>
            <p><strong>Prüfer</strong> – Liste der Ausbildungsberater (Hannes Pix, Christoph Zilz, Eva Dronia).</p>
          </div>

          <div id="help_5" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">📥 IBYKUS-Import</div>
            <p>Der Import ist die zentrale Datenpflege. CSV-Dateien aus dem BAV-System (IBYKUS) werden eingelesen.</p>
            <p style="margin-top:8px"><strong>Workflow:</strong></p>
            <p>1. In IBYKUS: Export als CSV (Semikolon-getrennt, UTF-8)</p>
            <p>2. Im Tool: <em>Import → Datei auswählen</em></p>
            <p>3. Spalten werden automatisch zugeordnet (27 Felder erkannt)</p>
            <p>4. Vorschau prüfen → <em>Import starten</em></p>
            <p style="margin-top:8px"><strong>Was wird importiert:</strong></p>
            <p>• Azubi-Stammdaten (Name, Betrieb, Fachrichtung, AV-Beginn/-Ende)</p>
            <p>• Kontaktdaten (Telefon, E-Mail)</p>
            <p>• Geschlecht (1=m, 2=w, 3=d)</p>
            <p>• Schulabschluss (1=ohne HS, 2=HS, 3=Realschule, 4=Abitur, 5=Ausland)</p>
            <p>• Prüfungserfolg + WDH1/WDH2 (1=bestanden, 2=nicht bestanden)</p>
            <p>• BAV-Status (BESTAET, ENDE etc.)</p>
            <p>• Zwischenprüfung (z.B. H2026 = Herbst 2026, F2027 = Frühjahr 2027)</p>
            <p>• Zuständiges Amt, Betriebsnummer, BAV-Ident</p>
            <p style="margin-top:8px"><strong>Automatismen:</strong></p>
            <p>• Schulen, Klassen und Jahrgänge werden <strong>automatisch angelegt</strong></p>
            <p>• Bei Re-Import: bestehende Azubis werden <strong>aktualisiert</strong> (nicht dupliziert)</p>
            <p>• Fachrichtung wird aus dem Beruf-Code ermittelt (z.B. 010=GaLaBau, 036=Baumschule)</p>
          </div>

          <div id="help_6" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📅 Kontrollplanung</div>
            <p>Unter <em>Planung</em> werden Kontrolltermine angelegt und Klassen zugewiesen.</p>
            <p>• <strong>Neuer Termin</strong> → Datum, Ort, Prüfer, Typ (Vor-Ort / Einsendung) wählen</p>
            <p>• <strong>Klassen zuweisen</strong> → Mehrere Klassen pro Termin möglich</p>
            <p>• <strong>Status</strong> → Geplant → Durchgeführt → Abgeschlossen</p>
            <p>• <strong>Blockplan</strong> → Übersicht welche Klassen wann in der Schule sind (für Terminplanung)</p>
          </div>

          <div id="help_7" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">🔍 Kontrolldurchführung</div>
            <p>Das Herzstück der App. Unter <em>Kontrolle</em> wird die eigentliche Berichtsheft-Durchsicht dokumentiert.</p>
            <p style="margin-top:8px"><strong>Workflow pro Azubi:</strong></p>
            <p>1. Termin auswählen → Schülerliste erscheint</p>
            <p>2. Schüler anklicken → Einzelansicht öffnet sich</p>
            <p>3. <strong>KW-Raster</strong> ausfüllen (Kalenderwochen mit Mängelcodes A-I markieren)</p>
            <p>4. <strong>Pflichtteile</strong> prüfen (Titelblatt, Fachberichte, Bescheinigungen etc.)</p>
            <p>5. <strong>Ergebnis</strong> vergeben: In Ordnung / Nachholung / E-Mail / Vorlage RP / Post</p>
            <p>6. Weiter zum nächsten Schüler (◀ ▶ Buttons oder Tastatur)</p>
            <p style="margin-top:8px"><strong>Übersichtsliste:</strong></p>
            <p>Zeigt alle Schüler eines Termins mit Ampel-Status, Fortschrittsbalken und Zulassungsstatus. Durchsichten können als <strong>Snapshot archiviert</strong> werden.</p>
          </div>

          <div id="help_8" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📊 KW-Raster (Kalenderwochen)</div>
            <p>Das KW-Raster zeigt alle Kalenderwochen eines Ausbildungsjahres. Pro KW können Mängelcodes vergeben werden:</p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;margin:8px 0">
              <strong>A</strong><span>Unterschrift Azubi fehlt</span>
              <strong>B</strong><span>Unterschrift Ausbilder fehlt</span>
              <strong>C</strong><span>Berufsschulthemen fehlen</span>
              <strong>D</strong><span>Wetter fehlt / unvollständig</span>
              <strong>E</strong><span>Inhaltlich lückenhaft</span>
              <strong>F</strong><span>Berichte fehlen komplett</span>
              <strong>G</strong><span>Datum/KW-Angabe fehlt</span>
              <strong>H</strong><span>Fehltage nicht dokumentiert</span>
              <strong>I</strong><span>Sonstiges (mit Bemerkung)</span>
            </div>
            <p>• <strong>Graue KWs</strong> = inaktiv (vor AV-Beginn oder nach AV-Ende)</p>
            <p>• <strong>Klick</strong> auf KW → Mängelcodes auswählen</p>
            <p>• <strong>Fehltage</strong> werden als Prozent der Arbeitstage berechnet</p>
          </div>

          <div id="help_9" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">🔔 Wiedervorlagen</div>
            <p>Wiedervorlagen sind Aufgaben die nach einer Kontrolle nachverfolgt werden müssen.</p>
            <p>• <strong>Automatisch</strong> erstellt bei Ergebnis ≠ "In Ordnung"</p>
            <p>• <strong>Manuell</strong> erstellbar pro Schüler</p>
            <p>• <strong>Status:</strong> Offen → Überfällig (nach Frist) → Erledigt</p>
            <p>• <strong>Notizen</strong> können pro Wiedervorlage hinzugefügt werden</p>
            <p>• <strong>Filtervarianten:</strong> Alle / Offen / Überfällig / Erledigt</p>
          </div>

          <div id="help_10" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📄 Berichte & Export</div>
            <p>Verschiedene Exportmöglichkeiten:</p>
            <p>• <strong>Jahresbericht (PDF)</strong> – Gesamtstatistik mit Mängel-Ranking, Schul-Übersicht, Fachrichtungen, Betrieb-Ranking und detaillierter Berufsschul-Statistik nach Fachrichtung und Amt</p>
            <p>• <strong>Kontrollbogen (PDF)</strong> – Einzelner Durchsichtsbogen pro Schüler</p>
            <p>• <strong>Word Mail-Merge</strong> – Serienbriefe über eigene .docx-Vorlage mit Platzhaltern</p>
            <p>• <strong>CSV-Export</strong> – Tabellenexport für Excel</p>
            <p>• <strong>Snapshot-Archiv</strong> – Durchsichtsergebnisse als PDF archivieren</p>
          </div>

          <div id="help_11" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📊 Jahresbericht (PDF)</div>
            <p>Der Jahresbericht wird unter <em>Berichte → Jahresbericht generieren</em> erstellt und enthält:</p>
            <p><strong>Seite 1 – Zusammenfassung:</strong></p>
            <p>• Kennzahlen (Azubis, Kontrolliert, In Ordnung, Beanstandungen, Termine, Wiedervorlagen)</p>
            <p>• Häufigste Mängelcodes als Balkendiagramm</p>
            <p>• Ergebnisse pro Berufsschule (Tabelle)</p>
            <p>• Ergebnisse pro Fachrichtung (Tabelle)</p>
            <p>• Betriebe mit häufigsten Beanstandungen (Top 10)</p>
            <p><strong>Seite 2+ – Berufsschul-Detail:</strong></p>
            <p>• Pro Berufsschule: Zwei-Spalten-Aufschlüsselung</p>
            <p>&nbsp;&nbsp;Links: Fachrichtungen mit Anzahl und %-Anteil</p>
            <p>&nbsp;&nbsp;Rechts: Zuständige Ämter mit Anzahl und %-Anteil</p>
            <p>• Gesamtübersicht nach Amt (alle Schulen zusammengefasst)</p>
          </div>

          <div id="help_12" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-blue)">
            <div class="card-header" style="font-size:15px">🔍 Globale Filter</div>
            <p>Die Filter in der Topbar wirken auf <strong>alle Ansichten</strong> gleichzeitig (Dashboard, Stammdaten, Kontrolle etc.):</p>
            <p>• <strong>📅 Jahrgang</strong> (Mehrfachauswahl) – Abschlussprüfungstermin (z.B. S2027, W2027)</p>
            <p>• <strong>🌿 Berufsgruppe</strong> (Mehrfachauswahl) – z.B. nur GaLaBau + Baumschule</p>
            <p>• <strong>🏛 Zuständiges Amt</strong> (Mehrfachauswahl) – z.B. nur 93 RP Freiburg</p>
            <p>• <strong>📝 Zwischenprüfung</strong> (Mehrfachauswahl) – Zwischenprüfungstermin (z.B. H2026, F2027)</p>
            <p>• <strong>📋 BAV-Status</strong> – Aktive BAV / Alle BAV / Beendete BAV</p>
            <p style="margin-top:6px">Ein aktiver Filter wird als <strong>Badge</strong> unter der Topbar angezeigt. Klick auf ✕ entfernt einzelne Filter, "Alle zurücksetzen" setzt alles zurück.</p>
            <p style="margin-top:8px;font-weight:600;color:var(--clr-forest-dark)">Bezeichnungen Prüfungstermine:</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px">
              <p><strong>Abschlussprüfung (AP)</strong> – Termin des Abschlussjahrgangs:</p>
              <p style="margin-left:12px"><strong>S</strong> = <strong>S</strong>ommer (z.B. <strong>S2027</strong> = Sommerprüfung 2027, ca. Juni)</p>
              <p style="margin-left:12px"><strong>W</strong> = <strong>W</strong>inter (z.B. <strong>W2027</strong> = Winterprüfung 2027, ca. Januar)</p>
              <p style="margin-top:6px"><strong>Zwischenprüfung (ZP)</strong> – Termin der Zwischenprüfung:</p>
              <p style="margin-left:12px"><strong>H</strong> = <strong>H</strong>erbst (z.B. <strong>H2026</strong> = Herbstprüfung 2026, ca. September/Oktober)</p>
              <p style="margin-left:12px"><strong>F</strong> = <strong>F</strong>rühjahr (z.B. <strong>F2027</strong> = Frühjahrsprüfung 2027, ca. März/April)</p>
              <p style="margin-top:6px;color:var(--clr-text-light)">AP und ZP nutzen unterschiedliche Bezeichner (S/W vs. H/F), weil die Prüfungszeiträume verschieden sind. Die Werte stammen aus dem IBYKUS-Export.</p>
            </div>
          </div>

          <div id="help_13" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">🔎 Globale Suche (Ctrl+K)</div>
            <p>Die Suche durchsucht die <strong>gesamte Datenbank</strong> nach:</p>
            <p>• Nachname, Vorname, Betrieb, Schule, Klasse, Jahrgang, Fachrichtung, BAV-Ident, E-Mail, Telefon</p>
            <p>• Suchergebnisse zeigen bis zu 50 Treffer mit Ampel-Status und Betrieb</p>
            <p>• Klick auf einen Treffer öffnet die Einzelansicht in der Kontrolle</p>
            <p>• <strong>Tastatur:</strong> Ctrl+K öffnen, Escape schließen, ↑↓ navigieren, Enter auswählen</p>
          </div>

          <div id="help_14" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">👥 Multi-User & Synchronisation</div>
            <p>Mehrere Prüfer können <strong>gleichzeitig</strong> an derselben Datenbank arbeiten (z.B. auf einem Netzlaufwerk).</p>
            <p><strong>Wie es funktioniert:</strong></p>
            <p>1. Alle öffnen die gleiche HTML-Datei und wählen den gleichen Ordner</p>
            <p>2. Jeder Prüfer meldet sich mit seinem Namen an</p>
            <p>3. Änderungen werden automatisch alle 8 Sekunden synchronisiert</p>
            <p>4. Ein kleiner <strong>Sync-Marker</strong> (_bhk/sync_*) signalisiert Änderungen</p>
            <p><strong>Lock-System:</strong></p>
            <p>• Wenn Prüfer A einen Schüler bearbeitet, sehen andere Prüfer ein 🔒-Symbol</p>
            <p>• Locks werden beim Speichern & Weiterschalten automatisch freigegeben</p>
            <p>• Safety-Timeout nach 15 Minuten</p>
            <p>• Beim Schließen des Browsers werden alle Locks automatisch freigegeben</p>
            <p><strong>Positions-Anzeige:</strong></p>
            <p>• In der Kontrollansicht sehen Sie, welcher Prüfer gerade welchen Schüler bearbeitet</p>
          </div>

          <div id="help_15" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">💾 Datensicherung</div>
            <p><strong>Auto-Save:</strong> Änderungen werden automatisch nach 1,5 Sekunden gespeichert (Debounce). Kein manuelles Speichern nötig.</p>
            <p><strong>Backups:</strong> Automatische Backups werden in _bhk/backups/ erstellt. Alte Backups werden automatisch bereinigt.</p>
            <p><strong>Empfehlung:</strong> Den gesamten Arbeitsordner regelmäßig auf ein Netzlaufwerk oder USB-Stick sichern. Die .sqlite-Datei enthält alle Daten.</p>
          </div>

          <div id="help_16" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">⌨️ Tastenkürzel</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px">
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Ctrl+K</kbd><span>Globale Suche öffnen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Escape</kbd><span>Modal / Suche schließen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">◀ / ▶</kbd><span>Vorheriger / Nächster Schüler (in Kontrolle)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">↑ / ↓</kbd><span>In Suchergebnissen navigieren</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Enter</kbd><span>Auswahl bestätigen</span>
            </div>
          </div>

          <div id="help_17" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-blue)">
            <div class="card-header" style="font-size:15px">⏱️ Nacherfassung (Altdaten übernehmen)</div>
            <p>Beim Umstieg von Papier auf die Berichtsheftkontrolle müssen vergangene Kontrollen nicht komplett nacherfasst werden. Hier ist der pragmatische Ansatz:</p>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">📌 Was lohnt sich nachzuerfassen?</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>🔴 <strong>Priorität 1 – Pflicht (~15 Min.):</strong> Offene Wiedervorlagen! Sonst gehen Fristen verloren. Nur die aktuell offenen WV eintragen (Azubi, Frist, Art).</p>
              <p>🟡 <strong>Priorität 2 – Empfohlen (~30 Min.):</strong> Letztes Kontrollergebnis pro Schüler. Dann funktioniert das Ampel-System und das Dashboard zeigt korrekte Zahlen.</p>
              <p>🟢 <strong>Priorität 3 – Optional (~60 Min.):</strong> KW-Mängelcodes der letzten Durchsicht, wenn der Verlauf bei der nächsten Kontrolle sichtbar sein soll.</p>
              <p>⚪ <strong>Weglassen:</strong> Ältere Durchsichten und Detail-KWs. Der Aufwand übersteigt den Nutzen – diese Daten sind auf den archivierten Papierbögen vorhanden.</p>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">🚀 Vorgehen mit der Schnellerfassung</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Voraussetzung:</strong> In <em>Einstellungen → Sichtbare Menüpunkte</em> die <strong>Nacherfassung</strong> aktivieren.</p>
              <p style="margin-top:6px"><strong>Schritt 1:</strong> Sidebar → <em>Nacherfassung</em> öffnen</p>
              <p><strong>Schritt 2:</strong> Datum der letzten Durchsicht eintragen, Prüfer wählen, Schule auswählen</p>
              <p><strong>Schritt 3:</strong> In der Tabelle für jeden Schüler eintragen:</p>
              <p style="margin-left:16px">• <strong>Ergebnis:</strong> "In Ordnung" oder entsprechendes Mängel-Ergebnis</p>
              <p style="margin-left:16px">• <strong>WV-Frist:</strong> Erscheint automatisch bei Mängeln (+4 Wochen, anpassbar)</p>
              <p style="margin-left:16px">• <strong>Codes:</strong> Optional, z.B. A,F für fehlende Unterschriften + fehlende Berichte</p>
              <p style="margin-left:16px">• <strong>Bemerkung:</strong> Optional, Freitext</p>
              <p><strong>Schritt 4:</strong> "💾 Alle speichern" → Kontrolltermin + Ergebnisse + WV werden angelegt</p>
              <p style="margin-top:6px"><strong>Tipp:</strong> Die aufklappbare Liste <em>"Noch nicht kontrollierte Schüler"</em> zeigt, welche Azubis noch keine Kontrolle in der DB haben – gruppiert nach Schule.</p>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">⏱ Zeitschätzung für die Erstbefüllung</p>
            <div style="margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
              <div style="padding:8px;background:var(--clr-amber-light);border-radius:var(--radius)">
                <div style="font-weight:700">Ohne Schnellerfassung</div>
                <p>20 Schüler: ~45 Min. (Einzelansicht)</p>
                <p>200 Schüler: ~6 Stunden</p>
                <p>600 Schüler: ~2 Tage</p>
              </div>
              <div style="padding:8px;background:var(--clr-green-light);border-radius:var(--radius)">
                <div style="font-weight:700">Mit Schnellerfassung</div>
                <p>20 Schüler: ~10 Min. (Tabelle)</p>
                <p>200 Schüler: ~1,5 Stunden</p>
                <p>600 Schüler: ~4 Stunden</p>
              </div>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">💡 Wichtig: AP und ZP sind zwei getrennte Felder</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.7">
              <p>Jeder Azubi hat sowohl eine <strong>Abschlussprüfung (AP)</strong> als auch eine <strong>Zwischenprüfung (ZP)</strong>. Beide Werte kommen aus dem IBYKUS-Export und werden als separate Felder gespeichert:</p>
              <p style="margin-top:4px">• <strong>AP</strong> (S2027, W2027): Bestimmt den Abschlussjahrgang → Klassen- und Termin-Zuordnung</p>
              <p>• <strong>ZP</strong> (H2026, F2027): Wird im ZP-Filter und in der Anzeige verwendet</p>
              <p style="margin-top:4px">Im Jahrgänge-Filter kann <strong>entweder</strong> nach AP oder nach ZP gefiltert werden (nicht beides gleichzeitig), weil die Zeitpunkte unterschiedlich sind und eine AND-Verknüpfung keine sinnvollen Ergebnisse liefert.</p>
              <p style="margin-top:4px">Beim IBYKUS-Import werden AP und ZP <strong>nie vermischt</strong>. Wenn sich Werte in IBYKUS ändern (z.B. Verschiebung der AP), werden sie beim nächsten Import automatisch aktualisiert.</p>
            </div>
          </div>

          <div id="help_18" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">🔧 Wartung & Administration</div>
            <p><strong>Architektur:</strong> Die gesamte Anwendung ist eine einzige HTML-Datei (~5 MB). Kein Server, kein Build-Prozess, keine Installation. Alle Abhängigkeiten (sql.js, Chart.js, jsPDF, PapaParse, SheetJS, PizZip, docxtemplater, FileSaver, pdf.js) sind direkt in die HTML-Datei eingebettet – es werden keine externen Ressourcen geladen.</p>
            <p style="margin-top:8px"><strong>Update-Prozess:</strong></p>
            <p>1. Neue Version der HTML-Datei in den Arbeitsordner kopieren (alte überschreiben)</p>
            <p>2. Browser-Tab mit F5 neu laden – fertig</p>
            <p>3. Datenbank und Einstellungen bleiben erhalten (liegen in <code>Datenbanken/</code> und <code>_bhk/</code>)</p>
            <p style="margin-top:8px"><strong>Backups:</strong></p>
            <p>• Automatische Backups in <code>_bhk/backups/</code> (werden regelmäßig bereinigt)</p>
            <p>• Manuelle Sicherung: Die .sqlite-Datei aus <code>Datenbanken/</code> kopieren</p>
            <p>• Für Disaster Recovery: gesamten Arbeitsordner sichern</p>
            <p style="margin-top:8px"><strong>Netzlaufwerk-Tipps:</strong></p>
            <p>• Ordner auf einem gemeinsamen Netzlaufwerk (z.B. Z:\\Berichtsheftkontrolle\\) ablegen</p>
            <p>• Jeder öffnet die HTML-Datei lokal im Browser und wählt den gleichen Ordner</p>
            <p>• Sync-Marker in <code>_bhk/sync_*</code> darf nicht gelöscht werden</p>
            <p>• Bei Sync-Problemen: alle Browser schließen, <code>_bhk/sync_*</code> löschen, neu starten</p>
            <p style="margin-top:8px"><strong>Datenbank-Wartung:</strong></p>
            <p>• <em>Einstellungen → Betriebe zusammenführen</em>: Duplikate bei Betriebsnamen bereinigen</p>
            <p>• <em>IBYKUS Re-Import</em>: Bestehende Daten werden aktualisiert, nicht dupliziert (über BAV-Ident)</p>
            <p>• Inaktive Azubis (BAV-Status "Ende") bleiben in der DB, werden aber per Filter ausgeblendet</p>
          </div>

          <div id="help_19" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-blue)">
            <div class="card-header" style="font-size:15px">💻 Weiterentwicklung (direkte Code-Änderungen)</div>
            <p>Die HTML-Datei kann mit jedem Texteditor bearbeitet werden. Empfohlen: <strong>Visual Studio Code</strong> (kostenlos).</p>
            <p style="margin-top:8px"><strong>Struktur der Datei (~15.000 Zeilen):</strong></p>
            <div style="background:var(--clr-sand-light);padding:10px;border-radius:var(--radius);font-family:monospace;font-size:11px;margin:8px 0;line-height:1.6">
              Zeile 1–1100 &nbsp;&nbsp;&nbsp;CSS-Styles (Farben, Layout, responsive)<br>
              Zeile 1100–1400 &nbsp;HTML (Topbar, Sidebar, Filter, Modals)<br>
              Zeile 1400–1900 &nbsp;App-Kern (Filter, Sync, DB-Management)<br>
              Zeile 1900–2200 &nbsp;Schema (CREATE TABLE, Migrationen)<br>
              Zeile 2200–4500 &nbsp;App-Logik (Startup, Sync, Import, Backup)<br>
              Zeile 4500–6500 &nbsp;Views (Dashboard, Stammdaten, Hilfe)<br>
              Zeile 6500–8500 &nbsp;Handler (StammdatenTab, PlanungHandler)<br>
              Zeile 8500–11000 &nbsp;KontrolleHandler (KW-Grid, Einzelansicht)<br>
              Zeile 11000–13000 &nbsp;PDF-Export, Word-Export, CSV<br>
              Zeile 13000–15000 &nbsp;GlobalSearch, Keyboard, Init
            </div>
            <p style="margin-top:8px"><strong>Einfache Änderungen (ohne Programmierkenntnisse):</strong></p>
            <p>• <em>Textbausteine ändern</em>: In Einstellungen → Textbausteine bearbeiten (kein Code nötig)</p>
            <p>• <em>Farben anpassen</em>: CSS-Variablen am Anfang der Datei (Zeile 20–55) suchen, z.B. <code>--clr-forest: #2d5016</code></p>
            <p>• <em>Mängelcodes A-I ändern</em>: Nach <code>codeLabels</code> suchen → Labels anpassen</p>
            <p>• <em>Neues Amt hinzufügen</em>: Nach <code>AEMTER:</code> suchen → Eintrag ergänzen</p>
            <p>• <em>Prüfer hinzufügen</em>: Über die App: Stammdaten → Prüfer-Tab</p>
            <p style="margin-top:8px"><strong>Mittlere Änderungen (Grundkenntnisse HTML/JS):</strong></p>
            <p>• <em>Neues Feld im Schema</em>: 1) CREATE TABLE erweitern, 2) ALTER TABLE Migration ergänzen, 3) Import-Mapping hinzufügen, 4) In Ansichten anzeigen</p>
            <p>• <em>Neuen Filter hinzufügen</em>: gf()-Funktion erweitern, Button in Filter-Panel, Update-Funktion</p>
            <p>• <em>Neuen View (Seite) hinzufügen</em>: 1) Sidebar-Button, 2) In validViews aufnehmen, 3) Views.neuerView() Funktion, 4) In renderCurrentView registrieren</p>
            <p style="margin-top:8px"><strong>Testen:</strong></p>
            <p>• HTML-Datei im Browser öffnen → Demo-Modus starten → Änderungen sofort sichtbar</p>
            <p>• Browser-Konsole (F12 → Console) zeigt Fehler an</p>
            <p>• Nach Änderungen: Braces zählen! <code>{</code> und <code>}</code> müssen gleich oft vorkommen</p>
          </div>

          <div id="help_20" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">🤖 KI-gestützte Entwicklung (Beispiel-Prompts)</div>
            <p>Diese Anwendung wurde mit Hilfe von <strong>Claude</strong> (Anthropic) entwickelt. Für Änderungen und Erweiterungen können generative KI-Tools sehr effektiv genutzt werden.</p>
            <p style="margin-top:8px"><strong>Vorgehen:</strong></p>
            <p>1. Die HTML-Datei als Projektdatei in Claude, ChatGPT oder Cursor laden</p>
            <p>2. Änderungswunsch als Prompt formulieren (siehe Beispiele unten)</p>
            <p>3. Geänderte Datei herunterladen und im Arbeitsordner ersetzen</p>
            <p>4. Im Browser testen (F5), bei Fehlern: Screenshot + Fehlermeldung an die KI senden</p>
            <p style="margin-top:10px"><strong>Empfohlene Tools:</strong></p>
            <p>• <strong>Claude.ai</strong> (Projects-Funktion): HTML als Projekt-Datei hochladen, alle Änderungen im Chat iterieren</p>
            <p>• <strong>Cursor IDE</strong>: Lokaler Editor mit eingebauter KI – ideal für größere Änderungen</p>
            <p>• <strong>ChatGPT</strong>: Für einzelne Code-Snippets und Erklärungen</p>

            <p style="margin-top:12px;font-weight:700;color:var(--clr-forest-dark)">📝 Beispiel-Prompts:</p>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">🔄 Neues Import-Feld hinzufügen</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Füge ein neues Feld 'Ausbildereignung' zum IBYKUS-Import hinzu. Die IBYKUS-Spalte heißt 'Ausbildereignung'. Der Wert soll in der schueler-Tabelle gespeichert und im Stammdaten-Tab angezeigt werden. Bitte Schema, Migration, Import-Mapping und Anzeige anpassen."</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">📊 Neues Dashboard-Chart</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Erstelle ein neues Balkendiagramm im Dashboard das die Anzahl der Kontrollen pro Monat der letzten 12 Monate zeigt. Es soll auf die globalen Filter reagieren und der Klick auf einen Balken soll per DrillDown die Azubi-Liste filtern."</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">📄 PDF-Export erweitern</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Erweitere den Jahresbericht-PDF um eine Seite mit einer Übersicht der Zwischenprüfungstermine. Pro Termin (z.B. F2025, H2026) soll die Anzahl der Azubis und deren Fachrichtungsverteilung angezeigt werden."</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">🐛 Bug fixen</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Wenn ich auf den Betrieb 'Gärtnerei Müller' in der Suche klicke, öffnet sich das Modal. Wenn ich das Modal schließe, bin ich in den Stammdaten aber ohne den Betrieb im Filter. Bitte den Code so ändern, dass nach dem Schließen des Betrieb-Modals der Betrieb in der Stammdaten-Suche vorausgewählt ist. [Screenshot beifügen]"</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">🎨 Design ändern</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Ändere das Farbschema der App von Grüntönen auf Blautöne. Die Hauptfarbe soll #1a56db sein statt #2d5016. Bitte alle CSS-Variablen im :root Bereich entsprechend anpassen."</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">➕ Neuen View hinzufügen</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Erstelle eine neue Seite 'Statistik' die über die Sidebar erreichbar ist. Sie soll eine Tabelle mit allen Betrieben zeigen, sortiert nach Anzahl der Beanstandungen, mit Ampel-Symbol und der Möglichkeit per Klick die zugehörigen Azubis anzuzeigen."</p>
            </div>

            <div style="margin-top:8px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);border-left:3px solid var(--clr-forest)">
              <p style="font-weight:600;margin-bottom:4px">🔍 Audit durchführen</p>
              <p style="font-size:12px;font-style:italic;color:var(--clr-text-light)">"Führe ein vollständiges Audit der Anwendung durch. Prüfe: Syntax (Braces/Brackets balanced), Schema vs. Migrationen, Import-Mapping Vollständigkeit, Filter-Abdeckung (gf()), CSS-Variablen, Sync-System, alle Views, Dashboard-Charts, und potenzielle Fehlerquellen."</p>
            </div>

            <p style="margin-top:12px"><strong>Tipps für gute Prompts:</strong></p>
            <p>• <strong>Kontext geben</strong>: "Dies ist eine Single-File HTML+SQLite App für Berichtsheftkontrollen"</p>
            <p>• <strong>Spezifisch sein</strong>: Nicht "Mach es besser" sondern "Die Tabelle soll nach Spalte X sortierbar sein"</p>
            <p>• <strong>Screenshots beifügen</strong>: Bei visuellen Problemen immer einen Screenshot mitliefern</p>
            <p>• <strong>Fehlermeldungen kopieren</strong>: Browser-Konsole (F12) öffnen, Fehler kopieren</p>
            <p>• <strong>Iterativ arbeiten</strong>: Kleine Änderungen → testen → nächste Änderung</p>
            <p>• <strong>Audit nach großen Änderungen</strong>: Nach Feature-Batches ein Audit-Prompt ausführen</p>
          </div>

          <div id="help_21" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">⏱️ Zeitersparnis & Arbeitserleichterung</div>
            <p>Die Berichtsheftkontrolle ersetzt einen aufwändigen, papiergestützten Verwaltungsprozess, der bisher mit Excel-Listen, Word-Vorlagen, manuellen E-Mails und physischer Aktenablage durchgeführt wurde.</p>

            <p style="margin-top:12px;font-weight:700;color:var(--clr-forest-dark)">📊 Zeitvergleich pro Durchsicht (ca. 20 Azubis):</p>
            <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px">
              <div style="padding:10px;background:var(--clr-red-light);border-radius:var(--radius);text-align:center">
                <div style="font-size:9px;color:var(--clr-red);font-weight:700;text-transform:uppercase">Papier (bisher)</div>
                <div style="font-size:22px;font-weight:700;color:var(--clr-red)">~4 Std.</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Durchsicht + Verwaltung</div>
              </div>
              <div style="padding:10px;background:var(--clr-amber-light);border-radius:var(--radius);text-align:center">
                <div style="font-size:9px;color:var(--clr-amber);font-weight:700;text-transform:uppercase">MS Office</div>
                <div style="font-size:22px;font-weight:700;color:var(--clr-amber)">~2,5 Std.</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Excel + Word + E-Mail</div>
              </div>
              <div style="padding:10px;background:var(--clr-green-light);border-radius:var(--radius);text-align:center">
                <div style="font-size:9px;color:var(--clr-green);font-weight:700;text-transform:uppercase">Dieses Tool</div>
                <div style="font-size:22px;font-weight:700;color:var(--clr-green)">~1 Std.</div>
                <div style="font-size:10px;color:var(--clr-text-light)">Durchsicht direkt im Tool</div>
              </div>
            </div>

            <p style="margin-top:16px;font-weight:700;color:var(--clr-red)">❌ Bisheriger Workflow (papiergestützt):</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-red-light);border-radius:var(--radius);font-size:12px;line-height:1.7">
              <p><strong>1. Vorbereitung</strong> (~30 Min.): Schülerliste aus IBYKUS exportieren. In Excel-Tabelle manuell übertragen. Durchsichtsbögen einzeln in Word ausfüllen (Name, Betrieb, Schule für jeden Azubi). Bögen ausdrucken.</p>
              <p><strong>2. Durchsicht</strong> (~60 Min.): Berichtshefte prüfen, Ergebnisse handschriftlich auf Papierbogen eintragen. Mängelcodes in Kästchen ankreuzen. Fehltage zählen und notieren.</p>
              <p><strong>3. Nachbereitung</strong> (~90 Min.): Ergebnisse von Papierbögen zurück in Excel übertragen. Bei Mängeln: Wiedervorlage-Termin in Outlook-Kalender eintragen. Erinnerung manuell setzen. Einladungen/Anschreiben einzeln in Word erstellen und per E-Mail versenden. Prüfen ob alle Wiedervorlagen bearbeitet wurden.</p>
              <p><strong>4. Ablage</strong> (~30 Min.): Papierbögen scannen oder kopieren. In E-Akte hochladen oder in Aktenordner abheften. Excel-Liste aktualisieren.</p>
              <p style="margin-top:4px;color:var(--clr-red)"><strong>Fehlerquellen:</strong> Übertragungsfehler (Papier → Excel), vergessene Wiedervorlagen, veraltete Schülerdaten, keine Übersicht über Gesamtstatus, Abstimmungsprobleme bei mehreren Prüfern.</p>
            </div>

            <p style="margin-top:12px;font-weight:700;color:var(--clr-amber)">⚠️ Hypothetischer Workflow mit MS Office + E-Akte:</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-amber-light);border-radius:var(--radius);font-size:12px;line-height:1.7">
              <p><strong>Excel als Stammdaten-Verwaltung:</strong> Mehrere Sheets (Azubis, Betriebe, Kontrollergebnisse, Wiedervorlagen). Keine referenzielle Integrität – Tippfehler in Betriebsnamen führen zu Inkonsistenzen. Keine automatische Verknüpfung IBYKUS → Excel.</p>
              <p><strong>Word-Serienbriefe für Durchsichtsbögen:</strong> Serienbrief-Vorlage pflegen, Datenquelle-Verknüpfung regelmäßig reparieren. Jede Änderung am Bogen-Layout erfordert Word-Kenntnisse. Kein individuelles KW-Raster pro Azubi möglich.</p>
              <p><strong>Outlook für Wiedervorlagen:</strong> Jede Wiedervorlage manuell als Aufgabe/Termin anlegen. Kein Zusammenhang zur Excel-Tabelle – Doppelpflege. Überfällige WV fallen nicht systematisch auf.</p>
              <p><strong>E-Akte für Ablage:</strong> PDF-Bögen einzeln hochladen. Keine automatische Zuordnung zum Azubi. Suche nur über Dateiname möglich.</p>
              <p><strong>Multi-User:</strong> Excel-Dateien auf dem Netzlaufwerk werden von Windows gesperrt (nur ein Benutzer gleichzeitig). Alternativ SharePoint – erfordert IT-Einrichtung und Schulung.</p>
              <p style="margin-top:4px;color:var(--clr-amber)"><strong>Aufwand:</strong> Hoher initialer Einrichtungsaufwand (2-3 Tage). Fragile Verknüpfungen die bei Windows-Updates oder Pfadänderungen brechen. Keine Gesamtübersicht / Dashboard. Kein Ampel-System.</p>
            </div>

            <p style="margin-top:12px;font-weight:700;color:var(--clr-green)">✅ Workflow mit der Berichtsheftkontrolle:</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px;line-height:1.7">
              <p><strong>1. Vorbereitung</strong> (~2 Min.): IBYKUS-CSV importieren → alle Schülerdaten, Betriebe, Schulen, Klassen werden automatisch angelegt und aktualisiert. Kontrolltermin anlegen mit KW-Kalender und Klassenfilter.</p>
              <p><strong>2. Durchsicht</strong> (~45 Min.): Berichtshefte prüfen, Mängelcodes direkt im KW-Raster per Tastatur eingeben. Fehltage mit einem Klick. Pflichtteile als Dropdown. Ergebnis auswählen → Wiedervorlage wird automatisch angelegt mit korrektem Fristdatum.</p>
              <p><strong>3. Nachbereitung</strong> (~10 Min.): PDF-Export aller Durchsichtsbögen mit einem Klick. E-Mail-Vorlagen für Einladungen/Anschreiben automatisch generiert (Betrieb, Schule, Azubi – alles vorausgefüllt). Wiedervorlagen-Übersicht zeigt offene und überfällige WV auf einen Blick.</p>
              <p><strong>4. Ablage</strong> (~2 Min.): PDF-Durchsichtsbögen sind sofort verfügbar. Export als Sammel-PDF oder Einzelbögen. Automatische Archivierung als Snapshot in der Datenbank.</p>
            </div>

            <p style="margin-top:16px;font-weight:700;color:var(--clr-forest-dark)">📋 Konkrete Arbeitserleichterungen:</p>
            <div style="margin-top:6px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>⏱ <strong>Individuelle Durchsichtsbögen</strong> – Werden automatisch aus den Stammdaten generiert. Kein manuelles Ausfüllen von Name, Betrieb, Schule, Klasse mehr. KW-Raster mit 4 Ausbildungsjahren, Fehltage-Berechnung, Pflichtteile – alles auf einem Bogen.</p>
              <p>⏱ <strong>Einladungen und Anschreiben</strong> – Vorausgefüllte E-Mail-Vorlagen mit allen Daten des Azubis und Betriebs. Ein Klick öffnet den E-Mail-Client mit fertigem Text. Word-Serienbriefe für postalischen Versand möglich.</p>
              <p>⏱ <strong>Wiedervorlagen</strong> – Werden automatisch aus dem Kontrollergebnis angelegt. Frist, Art (E-Mail/Post/Persönlich), Zuständigkeit – alles in einem System. Überfällige WV werden rot hervorgehoben. Kein manuelles Nachhalten in Outlook oder Excel mehr.</p>
              <p>⏱ <strong>Pflege der Wiedervorlagen</strong> – Dashboard zeigt auf einen Blick: Wie viele WV sind offen? Wie viele überfällig? Welche Azubis sind betroffen? Welche Betriebe haben die meisten Beanstandungen? Filter nach Jahrgang, Fachrichtung, Amt – sofort.</p>
              <p>⏱ <strong>Ablage der Durchsichtsbögen</strong> – PDF-Export einzeln oder als Sammel-PDF für den gesamten Kontrolltermin. Archiv-Snapshots in der Datenbank. Kein Scannen, kein manuelles Hochladen in die E-Akte.</p>
              <p>⏱ <strong>Abstimmung zwischen Prüfern</strong> – Drei Prüfer arbeiten gleichzeitig an derselben Datenbank. Live-Synchronisation alle 8 Sekunden. Lock-System verhindert Konflikte. Jeder sieht sofort, was die anderen bereits erledigt haben.</p>
              <p>⏱ <strong>Jahresbericht</strong> – Kompletter Jahresbericht als PDF mit Statistiken (Schulen, Fachrichtungen, Ämter, Mängelverteilung) auf Knopfdruck. Früher: tagelange Auswertung der Excel-Tabellen.</p>
              <p>⏱ <strong>Datenqualität</strong> – IBYKUS-Import hält die Stammdaten automatisch aktuell. Keine manuelle Pflege, keine veralteten Adressen, keine doppelten Einträge. Betriebe werden automatisch verknüpft.</p>
            </div>

            <p style="margin-top:16px;font-weight:700;color:var(--clr-forest-dark)">📈 Hochrechnung Zeitersparnis pro Jahr:</p>
            <div style="margin-top:6px;padding:10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>Bei ca. 600 Azubis, ~25 Kontrolltermine/Jahr, 3 Prüfern:</p>
              <p>• <strong>Papier-Workflow:</strong> ~25 × 4 Std. = <strong>100 Stunden</strong>/Jahr (reine Verwaltung, ohne die eigentliche Prüfung)</p>
              <p>• <strong>MS Office:</strong> ~25 × 2,5 Std. = <strong>62 Stunden</strong>/Jahr + hoher Einrichtungsaufwand + Fehlerkorrektur</p>
              <p>• <strong>Berichtsheftkontrolle:</strong> ~25 × 1 Std. = <strong>25 Stunden</strong>/Jahr (inkl. Import, Export, Wiedervorlagen)</p>
              <p style="margin-top:6px;font-weight:700;color:var(--clr-forest)">→ Ersparnis gegenüber Papier: <strong>~75 Stunden/Jahr</strong> (≈ 10 Arbeitstage)</p>
              <p style="font-weight:700;color:var(--clr-forest)">→ Ersparnis gegenüber MS Office: <strong>~37 Stunden/Jahr</strong> (≈ 5 Arbeitstage)</p>
              <p style="margin-top:6px;color:var(--clr-text-light)">Zusätzlich: Weniger Fehler, bessere Übersicht, keine vergessenen Wiedervorlagen, sofortige Auskunftsfähigkeit bei Rückfragen, professionelle Außenwirkung durch einheitliche Durchsichtsbögen.</p>
            </div>
          </div>

          <div id="help_22" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-red)">
            <div class="card-header" style="font-size:15px">🔒 Datenschutz & Rechtskonformität</div>
            <p style="font-weight:600;color:var(--clr-forest-dark)">Zusammenfassung für Führungskräfte und Datenschutzbeauftragte:</p>
            <p style="margin-top:6px">Die Berichtsheftkontrolle ist ein lokales Arbeitsinstrument zur Durchführung der gesetzlich vorgeschriebenen Berichtsheft-Durchsichten. Es ersetzt kein bestehendes System, sondern ergänzt den bestehenden Verwaltungsprozess.</p>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📌 Kernaussagen:</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-green-light);border-radius:var(--radius)">
              <p>✅ <strong>Keine Daten verlassen das Intranet.</strong> Die Anwendung läuft vollständig im Browser auf dem lokalen Rechner. Die Datenbankdatei liegt auf dem Netzlaufwerk des RP Freiburg. Es gibt keinen externen Server, keine Cloud, keinen Datenversand.</p>
              <p style="margin-top:6px">✅ <strong>IBYKUS bleibt das führende System.</strong> Personenbezogene Daten werden ausschließlich aus dem BAV-System IBYKUS importiert. Die Berichtsheftkontrolle ist ein nachgelagertes Arbeitsinstrument – keine Parallelführung, keine Doppelhaltung. Änderungen an Stammdaten erfolgen weiterhin in IBYKUS.</p>
              <p style="margin-top:6px">✅ <strong>Durchsichtsbögen werden archiviert.</strong> Die Ergebnisse jeder Berichtsheft-Durchsicht werden als PDF exportiert und im Verwaltungsvorgang archiviert. Das Tool dient der Erstellung, nicht der alleinigen Aufbewahrung.</p>
              <p style="margin-top:6px">✅ <strong>Keine Softwareinstallation nötig.</strong> Die Anwendung ist eine einzelne HTML-Datei, die im Browser (Chrome/Edge) geöffnet wird. Es muss nichts installiert, konfiguriert oder von der IT freigegeben werden. Keine Adminrechte erforderlich.</p>
              <p style="margin-top:6px">✅ <strong>Datenminimierung.</strong> Es werden nur die für die Durchsicht erforderlichen Daten importiert (Name, Betrieb, Ausbildungszeit, Prüfungsdaten). Keine Sozialversicherungsnummern, keine Bankdaten, keine Gesundheitsdaten.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">🏗️ Technischer Ansatz (nicht-technisch erklärt):</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-sand-light);border-radius:var(--radius)">
              <p><strong>Warum eine HTML-Datei statt einer „richtigen" Software?</strong></p>
              <p style="margin-top:6px">Klassische Software (z.B. ein Windows-Programm oder eine Web-Anwendung) erfordert: Installation durch die IT, einen Server, regelmäßige Updates, Lizenzen und oft eine Ausschreibung. Für ein Arbeitsinstrument mit 3 Nutzern im selben Referat ist dieser Aufwand unverhältnismäßig.</p>
              <p style="margin-top:8px">Die Berichtsheftkontrolle nutzt einen modernen Ansatz: Der Browser (Chrome/Edge) ist die Laufzeitumgebung. Die Datenbank (SQLite) läuft direkt im Browser. Die Datei wird lokal geöffnet – wie ein Excel-Dokument, nur mit mehr Funktionalität.</p>
              <p style="margin-top:8px"><strong>Vorteile dieses Ansatzes:</strong></p>
              <p>• <em>Zero-Install</em>: Kein IT-Aufwand, keine Adminrechte, keine Konfiguration</p>
              <p>• <em>Zero-Cloud</em>: Keine Daten verlassen den Rechner/das Netzlaufwerk</p>
              <p>• <em>Zero-Kosten</em>: Keine Lizenzen, keine laufenden Kosten</p>
              <p>• <em>Sofort einsetzbar</em>: HTML-Datei auf Netzlaufwerk kopieren → im Browser öffnen → arbeiten</p>
              <p>• <em>Zukunftssicher</em>: Basiert auf Web-Standards (HTML, CSS, JavaScript, SQLite) die seit 20+ Jahren stabil sind</p>
              <p>• <em>Wartbar</em>: Eine einzige Datei, keine komplexe Infrastruktur, erweiterbar mit KI-Tools</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📡 Netzwerkverkehr:</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-warm);border-radius:var(--radius)">
              <p><strong>Null.</strong> Alle JavaScript-Bibliotheken (Chart.js, sql.js, jsPDF, PapaParse, SheetJS, PizZip, docxtemplater, FileSaver, pdf.js) sind <strong>direkt in die HTML-Datei eingebettet</strong>. Es findet <strong>keinerlei Netzwerkverkehr</strong> statt – die Anwendung funktioniert vollständig offline.</p>
              <p style="margin-top:6px"><strong>Zu keinem Zeitpunkt</strong> werden Azubi-Namen, Betriebsdaten, Kontrollergebnisse oder andere personenbezogene Daten an externe Server gesendet. Es werden auch keine externen Ressourcen (CDN, Fonts, Analytics) geladen.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">⚖️ Einordnung:</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-blue-light);border-radius:var(--radius)">
              <p>Die Berichtsheftkontrolle ist vergleichbar mit einer <strong>Excel-Tabelle mit erweiterter Funktionalität</strong>. Wie bei Excel liegen die Daten lokal, die Verarbeitung erfolgt auf dem Rechner des Nutzers, und die Ergebnisse werden als Dateien gespeichert.</p>
              <p style="margin-top:6px">Der Unterschied: Statt manueller Tabellenpflege bietet das Tool eine strukturierte Oberfläche mit Plausibilitätsprüfungen, automatischer Synchronisation zwischen Prüfern und PDF-Export – Funktionen, die in Excel nur mit erheblichem Aufwand und fehleranfällig abzubilden wären.</p>
              <p style="margin-top:6px"><strong>Datenschutz-Risikobewertung: niedrig.</strong> Gleiche Datenkategorien wie in bestehenden Excel-Listen der Ausbildungsberater, gleicher Speicherort (Netzlaufwerk), gleiche Zugriffsberechtigungen (Windows-Rechte). Keine neue Datenerhebung, keine neue Datenübermittlung.</p>
            </div>
          </div>

          <div id="help_23" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">❓ FAQ</div>
            <p><strong>Die Charts im Dashboard sind verschwommen?</strong><br>
            Stellen Sie sicher, dass Sie die neueste Version verwenden. Die App setzt <code>devicePixelRatio</code> automatisch für scharfe Darstellung auf HiDPI-Displays.</p>
            <p style="margin-top:8px"><strong>Azubis verschwinden nach dem Import?</strong><br>
            Prüfen Sie den BAV-Status-Filter (📋-Button in der Topbar). Steht er auf "Aktive BAV", werden Azubis mit BAV-Status "Ende" ausgeblendet.</p>
            <p style="margin-top:8px"><strong>Kann ich die Datenbank mit mehreren Personen gleichzeitig nutzen?</strong><br>
            Ja! Legen Sie die Datei auf ein Netzlaufwerk. Jeder öffnet die HTML-Datei im Browser und wählt denselben Ordner. Das Sync-System sorgt für automatische Aktualisierung.</p>
            <p style="margin-top:8px"><strong>Welche Browser werden unterstützt?</strong><br>
            Nur <strong>Google Chrome</strong> und <strong>Microsoft Edge</strong> (Chromium-basiert). Firefox und Safari unterstützen die File System Access API nicht.</p>
            <p style="margin-top:8px"><strong>Wie groß kann die Datenbank werden?</strong><br>
            Problemlos bis 20.000+ Azubis (~30 MB). Die App nutzt SQLite im Browser (sql.js), was bis zu 2 GB unterstützt.</p>
            <p style="margin-top:8px"><strong>Was passiert bei einem Browser-Absturz?</strong><br>
            Auto-Save speichert alle 1,5 Sekunden. Im schlimmsten Fall gehen nur die letzten Sekunden verloren. Zusätzlich werden automatische Backups in _bhk/backups/ angelegt.</p>
            <p style="margin-top:8px"><strong>Kann ich alte Jahrgänge archivieren?</strong><br>
            Ja – erstellen Sie eine neue Datenbank (Startbildschirm → "Neue Datenbank erstellen") und importieren Sie nur die aktuellen Jahrgänge. Die alte DB bleibt im Datenbanken/-Ordner erhalten.</p>
          </div>

          <div class="card" style="margin-bottom:12px;background:var(--clr-sand-light);text-align:center;padding:20px">
            <p style="font-size:12px;color:var(--clr-text-light)">Berichtsheftkontrolle · Regierungspräsidium Freiburg · Abt. 3 · Ref. 31<br>
            Entwickelt für Ausbildungsberater Gärtner<br>
            Bei Fragen: Hannes Pix, Christoph Zilz, Eva Dronia</p>
          </div>

        </div>
      </div>
    </div>
    </div>`;
    // Scroll-spy: highlight active section in nav
    setTimeout(() => {
      const mc = document.getElementById('mainContent');
      const sections = mc.querySelectorAll('[id^="help_"]');
      const links = mc.querySelectorAll('.help-nav-link');
      if (!sections.length || !links.length) return;
      let activeId = 'help_0';
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) activeId = e.target.id; });
        links.forEach(l => {
          l.classList.toggle('active', l.dataset.section === activeId.replace('help_',''));
        });
      }, { root: mc, rootMargin: '-5% 0px -75% 0px', threshold: 0 });
      sections.forEach(s => observer.observe(s));
      links[0]?.classList.add('active');
    }, 120);
  },
};
