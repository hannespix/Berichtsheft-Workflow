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
    const _ak = App._extraFilterSql().overrideAktiv ? '1=1' : 's.aktiv=1';

    if (monate === 0) {
      // Noch NIE kontrolliert
      label.textContent = 'noch nie';
      const rows = App.query(`SELECT s.id, s.nachname, s.vorname, COALESCE(b.name, s.ausbildungsstaette) as betrieb,
        CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
        j.bezeichnung as jahrgang
        FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
        LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
        WHERE ${_ak} AND s.id NOT IN (SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE ergebnis != '') ${gf}
        ORDER BY s.nachname LIMIT 30`);
      const total = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE ${_ak} AND s.id NOT IN (SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE ergebnis != '') ${gf}`) || 0;
      countEl.textContent = total + ' Schüler noch nie kontrolliert';
      this._renderKontrollstatusTable(tableEl, rows, total);
    } else {
      // Letzte Kontrolle > X Monate her
      label.textContent = monate + (monate === 1 ? ' Monat' : ' Monaten');
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - monate);
      const cutoffStr = dateStr(cutoff);
      const rows = App.query(`SELECT s.id, s.nachname, s.vorname, COALESCE(b.name, s.ausbildungsstaette) as betrieb,
        CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
        j.bezeichnung as jahrgang,
        (SELECT MAX(kt.geplant_datum) FROM kontrollergebnisse ke2 JOIN kontrolltermine kt ON ke2.kontrolltermin_id=kt.id WHERE ke2.schueler_id=s.id AND ke2.ergebnis != '') as letzte_kontrolle
        FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
        LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
        WHERE ${_ak} ${gf}
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
    const today = todayStr();
    const jf = App.jgWhere('s.jahrgang_id');
    const jfkt = App.jgWhere('kt.jahrgang_id');
    const aktivClause = App._extraFilterSql().overrideAktiv ? '1=1' : 's.aktiv=1';

    const totalSchueler = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE ${aktivClause}${jf.where}`, jf.params) || 0;
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
      WHERE ${aktivClause}${jf.where}
      GROUP BY COALESCE(b.id, s.ausbildungsstaette)
      HAVING maengel_count > 0
      ORDER BY maengel_count DESC, offene_wv DESC
      LIMIT 15`, jf.params);

    // Morgen-Briefing data
    const naechste7Tage = App.query(`SELECT COUNT(*) as c FROM kontrolltermine kt WHERE kt.status='geplant' AND kt.geplant_datum BETWEEN ? AND ?${jfkt.where}`, [today, addDaysStr(7), ...jfkt.params])[0]?.c || 0;
    const bald_ueberfaellig = App.query(`SELECT COUNT(*) as c FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.status='offen' AND w.frist_datum BETWEEN ? AND ?${jf.where}`, [today, addDaysStr(3), ...jf.params])[0]?.c || 0;
    // Datenpflege
    const ohneBetrieb = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE s.betrieb_id IS NULL AND s.ausbildungsstaette != '' AND ${aktivClause}${jf.where}`, jf.params) || 0;
    const gfSch = App.gf('schulen');
    const ohneEmail = App.scalar(`SELECT COUNT(*) FROM berufsschulen bs WHERE (bs.email = '' OR bs.email IS NULL)${gfSch}`) || 0;
    const gfBet = App.gf('betriebe');
    const betriebOhneEmail = App.scalar(`SELECT COUNT(*) FROM betriebe b WHERE b.email = '' AND (SELECT COUNT(*) FROM schueler sq WHERE sq.betrieb_id=b.id AND ${aktivClause.replace(/\bs\./g,'sq.')}) > 0${gfBet}`) || 0;

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
        const _ak = App._extraFilterSql().overrideAktiv ? '1=1' : 's.aktiv=1';
        const total = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE ${_ak}${gf}`) || 0;
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
          WHERE ${_ak}${gf} GROUP BY bs.id ORDER BY cnt DESC`);
        const maxSchule = schulen.length ? schulen[0].cnt : 0;

        // ── 2) Azubis je Fachrichtung + Geschlecht ──
        const frs = App.query(`SELECT fr.id, fr.bezeichnung, fr.typ, COUNT(s.id) as cnt
          FROM schueler s JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id
          WHERE ${_ak}${gf} GROUP BY fr.id ORDER BY cnt DESC`);
        const maxFR = frs.length ? frs[0].cnt : 0;

        // ── 3) Azubis je Amt ──
        const aemter = App.query(`SELECT s.zustaendiges_amt as code, COUNT(s.id) as cnt
          FROM schueler s WHERE ${_ak} AND s.zustaendiges_amt != ''${gf}
          GROUP BY s.zustaendiges_amt ORDER BY cnt DESC`);
        const maxAmt = aemter.length ? aemter[0].cnt : 0;

        // ── 4) Azubis je Jahrgang (with kontrollergebnis summary) ──
        const jgs = App.query(`SELECT j.id, j.bezeichnung, j.pruefungstermin, j.typ,
          COUNT(DISTINCT s.id) as cnt,
          COUNT(DISTINCT CASE WHEN ke.ergebnis='in_ordnung' THEN s.id END) as ok_cnt,
          COUNT(DISTINCT CASE WHEN ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung' THEN s.id END) as issue_cnt
          FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
          LEFT JOIN kontrollergebnisse ke ON ke.schueler_id=s.id AND ke.ergebnis != ''
          WHERE ${_ak}${gf} GROUP BY j.id ORDER BY j.jahr DESC, j.typ`);
        const maxJG = jgs.length ? Math.max(...jgs.map(j=>j.cnt)) : 0;

        // ── 5) Verkürzer ──
        const verkuerzer = App.scalar(`SELECT COUNT(*) FROM schueler s WHERE ${_ak}${gf}
          AND (julianday(s.ausbildungsende) - julianday(s.ausbildungsbeginn)) < 365*2.8
          AND s.ausbildungsbeginn != '' AND s.ausbildungsende != ''`) || 0;

        // ── 6) Mängel-Codes ──
        const codeLabels = {A:'Unterschr. Azubi',B:'Unterschr. Ausb.',C:'BS-Themen',D:'Wetter',E:'Inhaltl. lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'};
        const maengelCodes = App.query(`SELECT maengel_codes FROM kw_status ks JOIN schueler s ON ks.schueler_id=s.id WHERE ks.maengel_codes != '' AND ks.maengel_codes != 'H' AND ${_ak}${gf}`);
        const codeCounts = {};
        maengelCodes.forEach(r => r.maengel_codes.split(',').forEach(c => { c = c.trim(); if (c && c !== 'H') codeCounts[c] = (codeCounts[c]||0) + 1; }));
        const codeEntries = Object.entries(codeCounts).sort((a,b) => b[1]-a[1]);
        const maxCode = codeEntries.length ? codeEntries[0][1] : 0;
        const totalCodes = codeEntries.reduce((s, [, c]) => s + c, 0);

        // ── 7) Top Betriebe (meiste Azubis) ──
        const topBetriebe = App.query(`SELECT COALESCE(b.name, s.ausbildungsstaette) as name, b.ort, b.id as bid, COUNT(s.id) as cnt
          FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id
          WHERE ${_ak}${gf} GROUP BY COALESCE(b.id, s.ausbildungsstaette) ORDER BY cnt DESC LIMIT 10`);
        const maxBetrieb = topBetriebe.length ? topBetriebe[0].cnt : 0;
        const totalBetriebe = App.scalar(`SELECT COUNT(DISTINCT COALESCE(betrieb_id, ausbildungsstaette)) FROM schueler s WHERE ${_ak}${gf}`) || 0;

        // ── 8) Nächste Prüfungstermine ──
        const pruefTermine = App.query(`SELECT j.bezeichnung, j.pruefungstermin, j.typ, COUNT(s.id) as cnt
          FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
          WHERE ${_ak} AND j.pruefungstermin >= ?${gf}
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
    const _ak = App._extraFilterSql().overrideAktiv ? '1=1' : 's.aktiv=1';
    const total = App.scalar('SELECT COUNT(*) FROM schueler s WHERE ' + _ak + gf) || 0;
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
      plugins: { legend: { position: isMobile ? 'bottom' : 'bottom', labels: { font: { size: isMobile ? 10 : 11, family: "'DM Sans'" }, padding: isMobile ? 4 : 8, boxWidth: isMobile ? 10 : 12 } } }
    };

    // ── 1) Kontrollfortschritt Donut ──
    try {
      const okCnt = App.scalar('SELECT COUNT(DISTINCT s.id) FROM schueler s JOIN kontrollergebnisse ke ON ke.schueler_id=s.id WHERE ke.ergebnis="in_ordnung" AND ' + _ak + gf) || 0;
      const issueCnt = App.scalar('SELECT COUNT(DISTINCT s.id) FROM schueler s JOIN kontrollergebnisse ke ON ke.schueler_id=s.id WHERE ke.ergebnis != "" AND ke.ergebnis != "in_ordnung" AND ' + _ak + gf) || 0;
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
      const mCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.geschlecht='m'" + gf) || 0;
      const wCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.geschlecht='w'" + gf) || 0;
      const dCnt = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.geschlecht='d'" + gf) || 0;
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
      const aemter = App.query("SELECT s.zustaendiges_amt as code, COUNT(s.id) as cnt FROM schueler s WHERE " + _ak + " AND s.zustaendiges_amt != ''" + gf + " GROUP BY s.zustaendiges_amt ORDER BY cnt DESC");
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
      const mRows = App.query("SELECT maengel_codes FROM kw_status ks JOIN schueler s ON ks.schueler_id=s.id WHERE ks.maengel_codes != '' AND ks.maengel_codes != 'H' AND " + _ak + gf);
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
      const saData = App.query("SELECT s.schulabschluss as sa, COUNT(*) as cnt FROM schueler s WHERE " + _ak + " AND s.schulabschluss != ''" + gf + " GROUP BY s.schulabschluss ORDER BY s.schulabschluss");
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
      const bestanden = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.pruefungserfolg='bestanden'" + gf) || 0;
      const nichtBest = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.pruefungserfolg='nicht_bestanden'" + gf) || 0;
      const wdh1Best = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.pruefungserfolg_wdh1='bestanden'" + gf) || 0;
      const wdh1Fail = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.pruefungserfolg_wdh1='nicht_bestanden'" + gf) || 0;
      const wdh2Best = App.scalar("SELECT COUNT(*) FROM schueler s WHERE " + _ak + " AND s.pruefungserfolg_wdh2='bestanden'" + gf) || 0;
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
      const frs = App.query("SELECT fr.id, fr.bezeichnung, fr.typ, COUNT(s.id) as cnt FROM schueler s JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE " + _ak + gf + " GROUP BY fr.id ORDER BY cnt DESC");
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
              y: { grid: { display: false }, ticks: { font: { size: 11, family: "'DM Sans'" } } }
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
        <h2>Import</h2>
        <p>Auszubildende, Ausbilder und Landesfachklassen importieren und verwalten</p>
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
          <details style="margin-top:8px">
            <summary style="cursor:pointer;font-size:12px;color:var(--clr-forest);font-weight:600;padding:4px 0">📋 Alternativ: Daten aus Zwischenablage einfügen (Copy & Paste)</summary>
            <div style="margin-top:6px">
              <textarea id="csvPasteArea" class="form-control" rows="6" maxlength="500000" placeholder="Tabelle aus IBYKUS/Excel kopieren und hier einfügen (Ctrl+V)&#10;&#10;Erste Zeile = Spaltenüberschriften" style="font-size:11px;font-family:monospace;white-space:pre;resize:vertical"></textarea>
              <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="ImportHandler.handlePaste('csvPasteArea')">Eingefügte Daten importieren</button>
            </div>
          </details>
          <div id="importPreview"></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="cursor:pointer" onclick="document.getElementById('lfkSection').style.display=document.getElementById('lfkSection').style.display==='none'?'':'none'">
          Landesfachklasse-Import ▾
        </div>
        <div id="lfkSection" style="display:none">
          <div style="background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius);padding:14px 18px;margin-bottom:16px">
            <div style="display:flex;align-items:start;gap:10px">
              <span style="font-size:20px;line-height:1">🏫</span>
              <div style="font-size:13px;color:var(--clr-text)">
                <strong style="color:var(--clr-forest-dark)">Landesfachklassen aus IBYKUS importieren</strong>
                <p style="margin:8px 0 0;line-height:1.7">
                  Bestimmte Fachrichtungen besuchen in höheren Ausbildungsjahren eine andere Berufsschule (Landesfachklasse).
                  Dieser Import ordnet die Landesfachklassen den Schülern zu.
                </p>
                <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px">
                  <span><strong>Gemüsebau:</strong> 3. AJ → Heidelberg</span>
                  <span><strong>Obstbau:</strong> 2.+3. AJ → Heilbronn</span>
                  <span><strong>Baumschule:</strong> 3. AJ → OG / Freiburg</span>
                  <span><strong>Stauden:</strong> 3. AJ → Freiburg</span>
                </div>
                <div style="margin-top:8px;padding:8px 12px;background:rgba(45,80,22,0.08);border-radius:6px;font-size:12px;color:var(--clr-sage)">
                  💡 <strong>IBYKUS-Export:</strong> Unter <em>Berichtsheftkontrolle-Export</em> die Spalten
                  <code>Nr.</code>, <code>Besch-Person</code>, <code>Nummer der Klasse</code>, <code>Beschreibung Klasse</code>, <code>Landesfachklasse</code> exportieren.
                </div>
              </div>
            </div>
          </div>
          <div class="drop-zone" id="lfkDropZone" onclick="document.getElementById('lfkFileInput').click()"
               ondragover="event.preventDefault();this.classList.add('dragover')"
               ondragleave="this.classList.remove('dragover')"
               ondrop="event.preventDefault();this.classList.remove('dragover');ImportHandler.handleLFKFile(event.dataTransfer.files[0])">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>Landesfachklasse-Export hierher ziehen oder klicken (.csv, .xlsx)</p>
            <input type="file" id="lfkFileInput" accept=".csv,.txt,.xlsx,.xls" style="display:none" onchange="ImportHandler.handleLFKFile(this.files[0])">
          </div>
          <details style="margin-top:8px">
            <summary style="cursor:pointer;font-size:12px;color:var(--clr-forest);font-weight:600;padding:4px 0">📋 Alternativ: Daten aus Zwischenablage einfügen (Copy & Paste)</summary>
            <div style="margin-top:6px">
              <textarea id="lfkPasteArea" class="form-control" rows="6" maxlength="500000" placeholder="Tabelle aus IBYKUS kopieren und hier einfügen (Ctrl+V)&#10;&#10;Spalten: Nr. | Besch-Person | Nummer der Klasse | Beschreibung Klasse | Landesfachklasse" style="font-size:11px;font-family:monospace;white-space:pre;resize:vertical"></textarea>
              <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="ImportHandler.handlePaste('lfkPasteArea','lfk')">Eingefügte Daten importieren</button>
            </div>
          </details>
          <div id="lfkImportPreview"></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="cursor:pointer" onclick="document.getElementById('ausbilderSection').style.display=document.getElementById('ausbilderSection').style.display==='none'?'':'none'">
          Ausbilder-Import ▾
        </div>
        <div id="ausbilderSection" style="display:none">
          <div style="background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius);padding:14px 18px;margin-bottom:16px">
            <div style="display:flex;align-items:start;gap:10px">
              <span style="font-size:20px;line-height:1">👨‍🏫</span>
              <div style="font-size:13px;color:var(--clr-text)">
                <strong style="color:var(--clr-forest-dark)">Ausbilder aus IBYKUS importieren</strong>
                <p style="margin:8px 0 0;line-height:1.7">
                  Importiert Ausbilder-Daten und ordnet sie automatisch den bestehenden Betrieben zu
                  (über Betriebsnummer oder Betriebsname).
                </p>
                <div style="margin-top:8px;padding:8px 12px;background:rgba(45,80,22,0.08);border-radius:6px;font-size:12px;color:var(--clr-sage)">
                  💡 <strong>Spalten:</strong> Betriebsnummer, Betriebsname, Nachname, Vorname, Telefon, E-Mail, Mobil, Funktion
                </div>
              </div>
            </div>
          </div>
          <div class="drop-zone" id="ausbilderDropZone" onclick="document.getElementById('ausbilderFileInput').click()"
               ondragover="event.preventDefault();this.classList.add('dragover')"
               ondragleave="this.classList.remove('dragover')"
               ondrop="event.preventDefault();this.classList.remove('dragover');ImportHandler.handleAusbilderFile(event.dataTransfer.files[0])">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>Ausbilder-Export hierher ziehen oder klicken (.csv, .xlsx)</p>
            <input type="file" id="ausbilderFileInput" accept=".csv,.txt,.xlsx,.xls" style="display:none" onchange="ImportHandler.handleAusbilderFile(this.files[0])">
          </div>
          <div id="ausbilderImportPreview"></div>
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
              const frAj = App.formatTerminFrAj(t.id);
              const schule = kl.length ? kl[0].schule : '';
              const calLabel = t.typ === 'einsendung' ? '📬 Einsendung' : (schule || kl.map(k => k.klassenbezeichnung).join('+'));
              terminDays[day] = { t, label: calLabel, detail: frAj, status: t.status, pruefer: t.pruefer };
            });

            let cells = '';
            for (let i = 0; i < firstDay; i++) cells += '<div></div>';
            for (let d = 1; d <= daysInMonth; d++) {
              const td = terminDays[d];
              const isToday = d === now.getDate() && m === now.getMonth() && year === now.getFullYear();
              const bg = td ? (td.status === 'durchgefuehrt' ? 'var(--clr-green-light)' : 'var(--clr-blue-light)') : '';
              const border = isToday ? '2px solid var(--clr-forest)' : td ? '1px solid var(--clr-sage-light)' : '';
              cells += `<div style="min-height:32px;padding:2px 4px;border-radius:4px;font-size:11px;cursor:${td?'pointer':'default'};background:${bg};border:${border}" ${td ? `onclick="PlanungHandler.editTermin(${td.t.id})" title="${esc(td.label)} – ${esc(td.detail)} – ${esc(td.pruefer)}"` : ''}>
                <div style="font-weight:${isToday?'700':'400'};color:${td?'var(--clr-forest-dark)':'var(--clr-text-light)'}">${d}</div>
                ${td ? `<div style="font-size:9px;color:var(--clr-forest);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(td.label)}</div><div style="font-size:8px;color:var(--clr-sage);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(td.detail)}</div>` : ''}
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
        ${termine.length ? `<table class="data-table"><thead><tr><th>Datum</th><th>Titel</th><th>Schule</th><th>Klasse(n)</th><th>Fachrichtung</th><th>Jahrgang</th><th>Schüler</th><th>Prüfer</th><th>Status</th><th>Aktionen</th></tr></thead><tbody id="planTableBody">
          ${termine.map(t => {
            const klassen = App.getTerminKlassen(t.id);
            const schule = klassen.length ? klassen[0].schule : '–';
            const ort = klassen.length ? klassen[0].schule_ort : '';
            const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
            const frStr = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ') || '–';
            const jgStr = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].join(', ') || '–';
            const schuelerCount = App.getTerminSchuelerCount(t.id);
            return `<tr data-status="${t.status}">
            <td data-sort="${t.geplant_datum}"><strong>${formatDate(t.geplant_datum)}</strong> <span style="font-size:10px;color:var(--clr-sage)">KW${getKW(t.geplant_datum)}</span>${t.typ==='einsendung'?' <span style="font-size:9px;padding:1px 5px;background:var(--clr-blue-light);color:var(--clr-blue);border-radius:8px">📬</span>':''}</td>
            <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.bemerkung||'')}">${esc(t.bemerkung || '–')}</td>
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
            ${termine.map(t => `<option value="${t.id}">${esc(App.formatTerminLabel(t))}</option>`).join('')}
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
    const today = todayStr();

    // Update overdue status – must use App.run() so the change is persisted via dirty-tracking
    try { App.run("UPDATE wiedervorlagen SET status='ueberfaellig' WHERE status='offen' AND frist_datum < ?", [today]); } catch(e) {}

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
          <div class="card-header">Excel-Dashboard</div>
          <p style="font-size:13px;color:var(--clr-text-light)">Rohdaten + Schul-/Betriebs-/Fachrichtungs-/Amt-Statistik als Excel.</p>
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

      <!-- Tariflöhne -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">💰 Tariflöhne & Vergütung</div>
        <p style="font-size:13px;color:var(--clr-text-light);padding:0 12px">Tarifliche Ausbildungsvergütungen und Mindestvergütung nach §17 BBiG verwalten.</p>
        <div style="padding:8px 12px 12px"><button class="btn btn-primary btn-sm" onclick="Views.openTarifModal()">Tariflöhne bearbeiten</button></div>
      </div>

      <!-- Änderungs-Logbuch -->
      ${(() => {
        const logCount = App.scalar("SELECT COUNT(*) FROM aenderungslog WHERE ibykus_relevant=1 AND exportiert=0") || 0;
        const logAll = App.scalar("SELECT COUNT(*) FROM aenderungslog") || 0;
        return `<div class="card" style="margin-top:16px">
          <div class="card-header">📋 Änderungs-Logbuch ${logCount > 0 ? `<span style="background:var(--clr-red);color:white;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">${logCount} offen</span>` : ''}</div>
          <p style="font-size:13px;color:var(--clr-text-light);padding:0 12px">Datenänderungen an Azubi-Stammdaten für den Nachtrag in IBYKUS. ${logAll} Einträge gesamt, davon ${logCount} noch nicht exportiert.</p>
          <div style="padding:8px 12px 12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="Views.showLogbuch()">Logbuch anzeigen</button>
            <button class="btn btn-secondary btn-sm" onclick="Views.exportLogbuch()">📄 Als CSV exportieren</button>
            ${logCount > 0 ? `<button class="btn btn-sm" style="background:var(--clr-green);color:white;border:none" onclick="App.run('UPDATE aenderungslog SET exportiert=1 WHERE exportiert=0');Views.einstellungen();App.toast(${logCount}+' Einträge als exportiert markiert','success')">✓ Alle als exportiert markieren</button>` : ''}
          </div>
        </div>`;
      })()}

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
      <!-- Pin -->
      <div style="text-align:right;padding:12px;opacity:0.3"><span id="pinEE" onclick="Views._pinClicked()" style="cursor:default;font-size:14px;user-select:none">📌</span></div>
      <div id="dashboardToggle" style="display:none;margin-top:8px;padding:12px 16px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand)">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Erweiterte Funktionen</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="togDashboard" ${App.scalar("SELECT wert FROM einstellungen WHERE schluessel='azubi_dashboard_enabled'")==='1'?'checked':''} onchange="Views._toggleDashboard(this.checked)" style="width:20px;height:20px;accent-color:var(--clr-forest)">
          Azubi-Dashboard &amp; Phasen-Editor aktivieren
        </label>
        <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">Erweiterte Ausbildungsverlaufs-Funktionen (🎓 Button bei Azubis)</div>
      </div>
    </div>`;
    setTimeout(() => this.renderTextbausteine(), 50);
  },

  _pinClicked() {
    const pw = prompt('Passwort für erweiterte Funktionen:');
    if (pw === 'dienstweg') {
      document.getElementById('dashboardToggle').style.display = '';
    }
  },

  _toggleDashboard(enabled) {
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('azubi_dashboard_enabled',?)", [enabled ? '1' : '0']);
    App.toast(enabled ? 'Azubi-Dashboard aktiviert — Seite neu laden für volle Wirkung' : 'Azubi-Dashboard deaktiviert', 'success');
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

  uploadWordTemplate(file) {
    if (!file || !file.name.endsWith('.docx')) return App.toast('Bitte eine .docx-Datei auswählen', 'error');
    if (file.size > 10 * 1024 * 1024) return App.toast('Vorlage zu groß (max 10 MB)', 'error');
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
    const jahrgaenge = App.query("SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, CASE typ WHEN 'Sommer' THEN 1 WHEN 'Winter' THEN 2 WHEN 'Frühjahr' THEN 3 WHEN 'Herbst' THEN 4 ELSE 5 END");
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
            <input type="date" class="form-control" id="neTerminDatum" value="${todayStr()}" style="width:160px">
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
            <label style="font-size:11px">Jahrgang</label>
            <select class="form-control" id="neJahrgang" style="width:auto" onchange="NacherfassungHandler.loadSchueler()">
              <option value="">– optional –</option>
              ${(() => {
                const ap = jahrgaenge.filter(j => j.typ === 'Sommer' || j.typ === 'Winter');
                const zp = jahrgaenge.filter(j => j.typ === 'Frühjahr' || j.typ === 'Herbst');
                const other = jahrgaenge.filter(j => !['Sommer','Winter','Frühjahr','Herbst'].includes(j.typ));
                let opts = '';
                if (ap.length) {
                  opts += '<optgroup label="AP (Abschlussprüfung)">';
                  opts += ap.map(j => `<option value="${j.id}">${esc(j.bezeichnung)} (${j.typ} ${j.jahr})</option>`).join('');
                  opts += '</optgroup>';
                }
                if (zp.length) {
                  opts += '<optgroup label="ZP (Zwischenprüfung)">';
                  opts += zp.map(j => `<option value="${j.id}">${esc(j.bezeichnung)} (${j.typ} ${j.jahr})</option>`).join('');
                  opts += '</optgroup>';
                }
                if (other.length) {
                  opts += '<optgroup label="Sonstige">';
                  opts += other.map(j => `<option value="${j.id}">${esc(j.bezeichnung)}</option>`).join('');
                  opts += '</optgroup>';
                }
                return opts;
              })()}
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
    const version = '2.0';
    const buildDate = '27.04.2026';
    c.innerHTML = `
    <div class="fade-in" style="padding-top:28px">
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="font-size:22px;margin-bottom:4px">📖 Hilfe – Berichtsheftkontrolle</h2>
        <button class="btn btn-sm btn-secondary" onclick="Views.exportHilfePDF()" title="Hilfe als PDF exportieren" style="font-size:11px">📄 Als PDF exportieren</button>
      </div>
      <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:16px">Version ${version} · Stand: ${buildDate} · Regierungspräsidium Freiburg, Abt. 3, Ref. 31</p>

      <div style="display:grid;grid-template-columns:240px 1fr;gap:16px;align-items:start">
        <!-- Navigation -->
        <div class="card" id="helpNav" style="position:sticky;top:8px;padding:8px 0;font-size:13px">
          <div style="padding:4px 16px;font-weight:700;color:var(--clr-forest-dark);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Inhalt</div>
          ${['Schnellstart','Ordnerstruktur','Startbildschirm','Dashboard','Stammdaten','IBYKUS-Import','Kontrollplanung','Kontrolldurchführung','KW-Raster & Bulk-Editing','Azubi-Dashboard','Azubi-Rechner & Tarife','Schüler-Akte','Phasen-Editor','Wiedervorlagen','Berichte & Export','Jahresbericht PDF','Globale Filter','Globale Suche','Tastenkürzel (vollständig)','Undo/Redo','Multi-User & Sync','Datensicherung','Nacherfassung (Altdaten)','Einstellungen','Wartung & Administration','Datenschutz & Rechtskonformität','FAQ'].map((t,i) => `<a href="#" class="help-nav-link" data-section="${i}" onclick="document.getElementById('help_${i}').scrollIntoView({behavior:'smooth',block:'start'});return false" style="display:block;padding:4px 16px;color:var(--clr-text);text-decoration:none;border-left:3px solid transparent;transition:background 0.15s,border-color 0.15s">${t}</a>`).join('')}
        </div>

        <!-- Content -->
        <div style="font-size:13px;line-height:1.7">

          <div id="help_0" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">🚀 Schnellstart</div>
            <p>Die Berichtsheftkontrolle ist ein lokales Arbeitsinstrument zur Planung, Durchführung und Dokumentation von Berichtsheft-Durchsichten in den Ausbildungsberufen des Gartenbaus. Die Anwendung läuft vollständig im Browser (Chrome/Edge) – sämtliche Daten verbleiben auf dem lokalen Rechner bzw. dem Netzlaufwerk des Regierungspräsidiums.</p>
            <p style="margin-top:8px"><strong>Typischer Arbeitsablauf:</strong></p>
            <p>1. <strong>IBYKUS-Import</strong> → Stammdaten der Auszubildenden aus dem BAV-System übernehmen</p>
            <p>2. <strong>Kontrollplanung</strong> → Durchsichtstermine anlegen und Berufsschulklassen zuweisen</p>
            <p>3. <strong>Kontrolldurchführung</strong> → Ausbildungsnachweise prüfen, Ergebnisse im KW-Raster dokumentieren</p>
            <p>4. <strong>Nachverfolgung</strong> → Wiedervorlagen bearbeiten, Durchsichtsbögen und Berichte exportieren</p>
          </div>

          <div class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-red)">
            <div class="card-header" style="font-size:15px;color:var(--clr-red)">⚠️ Wichtige Hinweise für neue Mitarbeiter</div>
            <p><strong>Datenfluss:</strong> Die Datenstruktur ist eine <strong>Einbahnstraße</strong>: IBYKUS → Export (CSV) → Import in dieses Tool. Es gibt <strong>keine Rücksynchronisation</strong> zum IBYKUS-System!</p>
            <p style="margin-top:6px"><strong>Gefahrenquellen:</strong></p>
            <p>• <strong>Vor jeder neuen Kontrolle</strong> immer einen frischen IBYKUS-Export importieren → stellt sicher, dass Stammdaten (Status, Betrieb, etc.) aktuell sind</p>
            <p>• <strong>Änderungen in diesem Tool</strong> (z.B. Inaktiv-Setzung, Betriebswechsel, AP-Zulassung) werden NICHT automatisch in IBYKUS übertragen. Solche Änderungen müssen über das <strong>Änderungs-Logbuch</strong> (Einstellungen) an die Assistenz weitergegeben werden, die sie in IBYKUS nachträgt.</p>
            <p>• <strong>Niemals</strong> die SQLite-Datei manuell bearbeiten oder kopieren während die App geöffnet ist</p>
            <p>• <strong>Regelmäßig Backups</strong> erstellen (passiert automatisch, aber prüfen unter _bhk/backups/)</p>
            <p>• <strong>Multi-User:</strong> Maximal 2–3 Personen gleichzeitig. Vor dem Bearbeiten den eigenen Prüfernamen auswählen!</p>
            <p style="margin-top:8px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px"><strong>Merke:</strong> Dieses Tool ersetzt IBYKUS nicht — es ist ein Arbeitsinstrument für die Durchsicht. IBYKUS bleibt das führende System.</p>
          </div>

          <div id="help_1" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📁 Ordnerstruktur</div>
            <p>Die Anwendung erstellt beim ersten Start automatisch folgende Verzeichnisstruktur im gewählten Arbeitsordner:</p>
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
            <p>Das Dashboard zeigt eine Übersicht der wichtigsten Kennzahlen des aktuellen Datenbestands:</p>
            <p>• <strong>Kontrollstatus-Regler</strong> – Zeigt Auszubildende an, deren letzte Durchsicht länger als X Monate zurückliegt. Regler auf 0 = noch nie kontrollierte Auszubildende.</p>
            <p>• <strong>Anstehende Prüfungstermine</strong> – Auflistung der nächsten Abschlussprüfungen mit Anzahl der betroffenen Auszubildenden.</p>
            <p>• <strong>Betriebsranking</strong> – Ausbildungsbetriebe mit den meisten Auszubildenden (Top 10).</p>
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
            <p>Die Stammdatenverwaltung gliedert sich in folgende Bereiche:</p>
            <p><strong>Auszubildende</strong> – Durchsuchbare Liste aller Auszubildenden mit Ampelstatus (Kontrollstand), Ausbildungsbetrieb und Kontrollenhistorie. Über Checkboxen können mehrere Schüler für <strong>Bulk-Aktionen</strong> ausgewählt werden: Klasse/Jahrgang/Fachrichtung zuweisen, als inaktiv setzen, oder löschen (mit Sicherheitsabfrage). Export als Excel oder in die Zwischenablage möglich.</p>
            <p><strong>Jahrgänge</strong> – Abschlussjahrgänge verwalten. Die Bezeichnung entspricht dem Prüfungszeitraum der Abschlussprüfung: <strong>S</strong> = Sommer, <strong>W</strong> = Winter. Beispiel: S2027 = Sommerprüfung 2027, W2027 = Winterprüfung 2027.</p>
            <p><strong>Berufsschulen</strong> – Schulen mit Kontaktdaten, E-Mail-CC-Adressen und Ansprechpartnern.</p>
            <p><strong>Ausbildungsbetriebe</strong> – Betriebe mit Anschrift, Kontaktdaten und zugeordneten Auszubildenden.</p>
            <p><strong>Fachrichtungen</strong> – Fachrichtungen im Gartenbau (z.B. GaLaBau, Baumschule, Zierpflanzenbau) sowie Fachwerkerberufe.</p>
            <p><strong>Klassen</strong> – Automatisch generierte Berufsschulklassen (Schule + Jahrgang + Fachrichtung + Ausbildungsjahr).</p>
            <p><strong>Ausbildungsberater</strong> – Liste der Sachbearbeiter/Ausbildungsberater, die Durchsichten durchführen.</p>
          </div>

          <div id="help_5" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">📥 IBYKUS-Import</div>
            <p>Der Import bildet die zentrale Schnittstelle zur Datenpflege. CSV-Exportdateien aus dem BAV-System IBYKUS werden eingelesen und mit dem lokalen Datenbestand abgeglichen.</p>
            <p style="margin-top:8px"><strong>Ablauf:</strong></p>
            <p>1. In IBYKUS: Datenexport als CSV-Datei (Semikolon-getrennt, Zeichenkodierung UTF-8)</p>
            <p>2. In der Anwendung: <em>Import → Datei auswählen</em></p>
            <p>3. Die Spaltenzuordnung erfolgt automatisch (27 Felder werden erkannt)</p>
            <p>4. Vorschau prüfen → <em>Import starten</em></p>
            <p style="margin-top:8px"><strong>Importierte Datenkategorien:</strong></p>
            <p>• <strong>Stammdaten</strong> – Vor-/Nachname, Ausbildungsbetrieb, Fachrichtung, Ausbildungsbeginn/-ende</p>
            <p>• <strong>Kontaktdaten</strong> – Telefonnummer, E-Mail-Adresse</p>
            <p>• <strong>Geschlecht</strong> – Codiert: 1 = männlich, 2 = weiblich, 3 = divers</p>
            <p>• <strong>Schulische Vorbildung</strong> – Codiert: 1 = ohne Hauptschulabschluss, 2 = Hauptschulabschluss, 3 = Mittlere Reife, 4 = Hochschulreife, 5 = im Ausland erworben</p>
            <p>• <strong>Prüfungsergebnisse</strong> – Abschlussprüfung inkl. 1./2. Wiederholung (1 = bestanden, 2 = nicht bestanden)</p>
            <p>• <strong>BAV-Status</strong> – Vertragsstatus (z.B. BESTAET = bestätigt, ENDE = beendet)</p>
            <p>• <strong>Prüfungstermine</strong> – Abschlussprüfung (z.B. S2027), Zwischenprüfung (z.B. H2026)</p>
            <p>• <strong>Verwaltungsdaten</strong> – Zuständiges Amt, Betriebsnummer, BAV-Identnummer</p>
            <p style="margin-top:8px"><strong>Automatische Verarbeitung:</strong></p>
            <p>• Berufsschulen, Klassen und Jahrgänge werden beim Import <strong>automatisch angelegt</strong>, sofern sie noch nicht existieren</p>
            <p>• Bei erneutem Import (Re-Import) werden bestehende Datensätze anhand der BAV-Identnummer <strong>aktualisiert</strong>, nicht dupliziert</p>
            <p>• Die Fachrichtung wird aus dem IBYKUS-Berufscode abgeleitet (z.B. 010 = Garten- und Landschaftsbau, 036 = Baumschule)</p>
          </div>

          <div id="help_6" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📅 Kontrollplanung</div>
            <p>Unter <em>Planung</em> werden Durchsichtstermine (Kontrolltermine) angelegt und Berufsschulklassen zugewiesen.</p>
            <p>• <strong>Neuer Termin</strong> → Datum, Durchführungsort, zuständiger Ausbildungsberater, Durchsichtsart (Vor-Ort-Durchsicht / Einsendung) festlegen</p>
            <p>• <strong>Klassen zuweisen</strong> → Einem Termin können mehrere Berufsschulklassen zugeordnet werden</p>
            <p>• <strong>Terminstatus</strong> → Geplant → Durchgeführt → Abgeschlossen</p>
            <p>• <strong>Blockplan</strong> → Übersicht der Berufsschulblöcke (welche Klassen befinden sich wann in der Schule) zur Terminkoordination</p>
          </div>

          <div id="help_7" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">🔍 Kontrolldurchführung</div>
            <p>Das Kernmodul der Anwendung. Unter <em>Kontrolle</em> wird die eigentliche Durchsicht der Ausbildungsnachweise (Berichtshefte) dokumentiert.</p>
            <p style="margin-top:8px"><strong>Ablauf je Auszubildendem:</strong></p>
            <p>1. Durchsichtstermin auswählen → Liste der zugeordneten Auszubildenden wird angezeigt</p>
            <p>2. Auszubildenden anklicken → Einzelansicht mit KW-Raster öffnet sich</p>
            <p>3. <strong>KW-Raster</strong> ausfüllen – je Kalenderwoche Mängelcodes (A–I) vergeben</p>
            <p>4. <strong>Pflichtbestandteile</strong> prüfen – Ausbildungsplan, Fachberichte, Bescheinigungen, Unterschriften</p>
            <p>5. <strong>Gesamtergebnis</strong> festlegen – In Ordnung / Nachholung / E-Mail an Betrieb / Vorlage RP / postalische Aufforderung</p>
            <p>6. Weiter zum nächsten Auszubildenden (◀ ▶ Schaltflächen oder Tastaturnavigation)</p>
            <p style="margin-top:8px"><strong>Übersichtsliste:</strong></p>
            <p>Zeigt alle Auszubildenden eines Durchsichtstermins mit Ampelstatus (Kontrollstand), Fortschrittsbalken und Zulassungsstatus zur Abschlussprüfung. Die Ergebnisse können als <strong>Snapshot archiviert</strong> werden (unveränderliche Momentaufnahme der Durchsicht).</p>
            <p style="margin-top:8px"><strong>Nach Fachrichtung gruppieren:</strong></p>
            <p>Über den Button <em>Nach FR gruppieren</em> können die Schüler in der Übersicht nach Fachrichtung sortiert mit Gruppenüberschriften dargestellt werden.</p>
            <p style="margin-top:8px"><strong>Bulk-Aktionen:</strong></p>
            <p>Über Checkboxen können mehrere Schüler gleichzeitig ausgewählt und als <em>In Ordnung</em> markiert werden. Einzelne Schüler können per ✕-Button aus dem Termin entfernt werden.</p>
          </div>

          <div id="help_8" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">📊 KW-Raster & Bulk-Editing</div>
            <p>Das KW-Raster bildet alle Kalenderwochen eines Ausbildungsjahres ab. Je Kalenderwoche können folgende Mängelcodes vergeben werden:</p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;margin:8px 0">
              <strong>A</strong><span>Unterschrift des Auszubildenden fehlt</span>
              <strong>B</strong><span>Unterschrift des Ausbildenden/Ausbilders fehlt</span>
              <strong>C</strong><span>Berufsschulthemen fehlen oder sind unvollständig</span>
              <strong>D</strong><span>Witterungsangaben fehlen oder sind unvollständig</span>
              <strong>E</strong><span>Inhaltlich lückenhaft (Tätigkeitsbeschreibungen unzureichend)</span>
              <strong>F</strong><span>Ausbildungsnachweise fehlen vollständig</span>
              <strong>G</strong><span>Datum- oder KW-Angabe fehlt</span>
              <strong>H</strong><span>Fehltage (1–5 Tage pro KW)</span>
              <strong>I</strong><span>Sonstiges (Bemerkung erforderlich)</span>
            </div>
            <p style="margin-top:8px"><strong>Tastaturkürzel im KW-Raster:</strong></p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;margin:8px 0">
              <code>A–G</code><span>Mängelcode direkt togglen (an/aus)</span>
              <code>H</code><span>Fehltage-Eingabe öffnen (Popover)</span>
              <code>1–5</code><span>Fehltage-Schnelleingabe (setzt H + Anzahl)</span>
              <code>0</code><span>Fehltage entfernen</span>
              <code>I</code><span>Sonstiges-Dialog mit Bemerkung + Textbausteinen</span>
              <code>O</code><span>Keine Beanstandungen (als geprüft markieren)</span>
              <code>Entf / Backspace</code><span>Alle Codes entfernen (→ behoben)</span>
              <code>Leertaste / Enter</code><span>Vollständiges Bearbeitungs-Modal öffnen</span>
              <code>Pfeiltasten</code><span>Zwischen KW-Zellen navigieren</span>
            </div>
            <p style="margin-top:8px"><strong>Mehrfachauswahl (Bulk-Editing):</strong></p>
            <p>• <strong>Shift+Klick</strong> – Alle KWs von der zuletzt fokussierten bis zur geklickten Zelle markieren (blauer Rahmen)</p>
            <p>• <strong>Shift+Pfeiltaste</strong> – Selektion Zelle für Zelle erweitern</p>
            <p>• <strong>Escape</strong> – Selektion aufheben</p>
            <p>• Nach Auswahl: Jede Taste (A–G, O, 1–5, Entf) wirkt auf <strong>alle markierten KWs</strong> gleichzeitig</p>
            <p>• Ein Badge unten rechts zeigt die Anzahl der ausgewählten KWs</p>
            <p style="margin-top:8px">• <strong>Grau hinterlegte KWs</strong> = Zeitraum außerhalb des Ausbildungsverhältnisses oder Unterbrechungsphase</p>
            <p>• <strong>Fehltage</strong> werden als prozentualer Anteil der Arbeitstage je Ausbildungsjahr berechnet</p>
          </div>

          <div id="help_9" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest);${typeof AzubiDashboard!=='undefined'&&AzubiDashboard.isEnabled()?'':'display:none'}"
            <div class="card-header" style="font-size:15px">🎓 Azubi-Dashboard</div>
            <p>Per-Schüler-Dashboard mit Ausbildungsverlauf, Kennzahlen, Vergütung und Prüfungsterminen. Erreichbar über den 🎓-Button in Stammdaten, SchuelerView und Kontrolle.</p>
            <p><strong>Komponenten:</strong></p>
            <p>• <strong>Hero-Status-Card</strong> – Aktuelles Lehrjahr (VZ-Äquivalent), Fortschrittsbalken, aktueller Betrieb + Teilzeit-%</p>
            <p>• <strong>Nächster Meilenstein</strong> – ZP, AP oder Vertragsende mit Countdown in Tagen</p>
            <p>• <strong>Phasen-Timeline</strong> – Farbiger Balken: dunkelgrün = Vollzeit, hellgrün = Teilzeit, grau-gestreift = Unterbrechung, goldene Linie = Betriebswechsel, rote Linie = Heute</p>
            <p>• <strong>Kennzahlen-Cards</strong> – Fehltagsbudget (10%/15%-Schwelle), aktuelle Vergütung, Wochenstunden, Fortschritt</p>
            <p>• <strong>Risiko-Indikatoren</strong> – Automatische Warnungen bei Fehltage-Überschreitung, Phasen-Lücken, Unterbrechungen</p>
            <p style="margin-top:8px"><strong>Editierbare Felder (direkt im Dashboard):</strong></p>
            <p>• Zwischenprüfung / Abschlussprüfung (leer = automatisch berechnet)</p>
            <p>• Ausbildungsende – bei Änderung wird Jahrgangs-Anpassung angeboten</p>
            <p>• Beruf (Tarif), reguläre Dauer, Verkürzung, Geburtsdatum, vorzeitige Zulassung §45</p>
            <p>• Individueller Bruttolohn (überschreibt Tarif, 0 = Tarifberechnung)</p>
            <p>• <strong>Vergütungsperioden-Tabelle</strong> – Zeitraum, Betrieb, Lehrjahr, TZ-%, Brutto VZ/effektiv, Urlaub</p>
          </div>

          <div id="help_10" class="card" style="margin-bottom:12px;${typeof AzubiDashboard!=='undefined'&&AzubiDashboard.isEnabled()?'':'display:none'}"
            <div class="card-header" style="font-size:15px">💰 Azubi-Rechner & Tarife</div>
            <p>Berechnet Vergütung, Prüfungstermine und Kennzahlen basierend auf dem Phasenmodell und Tarifdaten.</p>
            <p><strong>Tarifverwaltung</strong> (Einstellungen → „Tariflöhne bearbeiten"):</p>
            <p>• 7 Gartenbau-Fachrichtungen mit Tarifsätzen je Lehrjahr (GaLaBau, Baumschule, Friedhof, Gemüse, Obst, Stauden, Zierpflanzen)</p>
            <p>• Mindestvergütung §17 BBiG – separat editierbar, jährlich aktualisiert</p>
            <p>• „Auf Standard zurücksetzen" – Tarife auf eingebaute Werte zurücksetzen</p>
            <p style="margin-top:8px"><strong>Sonderregelungen:</strong></p>
            <p>• <strong>Fachwerker/Fachpraktiker (§66 BBiG)</strong> – Erhalten Ausbildungsgeld der Arbeitsagentur: 501 € (Elternhaushalt) / 822 € (eigene Wohnung), nicht tarifgebunden. Nur 1 ÜBA-Bescheinigung erforderlich (statt 2 bzw. 6).</p>
            <p>• <strong>Individueller Bruttolohn</strong> – Pro Azubi einstellbar, überschreibt Tarifberechnung. Vergütungsperioden werden trotzdem angezeigt (Lehrjahr-Wechsel, Urlaub).</p>
          </div>

          <div id="help_11" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📋 Schüler-Akte</div>
            <p>Pro Schüler können Bemerkungen und Dateien hinterlegt werden. Erreichbar über den 📋-Button in Stammdaten und SchuelerView.</p>
            <p>• <strong>Bemerkungen</strong> – Freitext-Notizen mit Zeitstempel und Prüfer-Zuordnung</p>
            <p>• <strong>Dateien</strong> – Dokumente an den Schüler-Datensatz anhängen (werden im Arbeitsordner gespeichert)</p>
            <p>• <strong>Aktenvermerk-Export</strong> – Als PDF exportierbar</p>
          </div>

          <div id="help_12" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest);${typeof AzubiDashboard!=='undefined'&&AzubiDashboard.isEnabled()?'':'display:none'}"
            <div class="card-header" style="font-size:15px">🔀 Phasen-Editor</div>
            <p>Verwaltet Ausbildungsphasen: Vollzeit, Teilzeit, Unterbrechungen, Betriebswechsel. Erreichbar im Azubi-Dashboard → „Phasen bearbeiten".</p>
            <p><strong>Phasentypen:</strong></p>
            <p>• <strong>Ausbildung</strong> – Betrieb, Teilzeit-% (25–100%), pauschale Fehltage</p>
            <p>• <strong>Unterbrechung</strong> – Grund (Mutterschutz, Elternzeit, Krankheit etc.), verschiebt Vertragsende</p>
            <p style="margin-top:8px"><strong>Funktionen:</strong></p>
            <p>• „Standard-Phase aus Stammdaten erzeugen" – Erstellt automatisch eine Phase aus Ausbildungsbeginn/-ende</p>
            <p>• <strong>Konflikt-Erkennung</strong> – Neue Phase überlappt bestehende → Dialog mit Auflösungsoptionen (Kürzen, Splitten, Akzeptieren)</p>
            <p>• <strong>Validierung</strong> – Lücken und Überlappungen werden automatisch erkannt und als Warnung angezeigt</p>
            <p>• Lehrjahr-Berechnung basiert auf VZ-Äquivalent, nicht auf Kalenderzeit</p>
            <p>• KW-Raster markiert Unterbrechungs-Phasen als inaktive (graue) Wochen</p>
            <p style="margin-top:8px"><strong>IBYKUS-Import-Schutz:</strong> Wenn ein Re-Import Ausbildungsbeginn/-ende ändern würde und Phasen existieren, werden die Datums-Felder NICHT überschrieben. Ein Konflikt-Dialog nach dem Import ermöglicht die manuelle Entscheidung.</p>
          </div>

          <div id="help_13" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">🔔 Wiedervorlagen</div>
            <p>Wiedervorlagen dienen der Nachverfolgung offener Beanstandungen aus einer Berichtsheft-Durchsicht.</p>
            <p>• <strong>Automatische Anlage</strong> – Bei einem Durchsichtsergebnis mit Beanstandung (Ergebnis ≠ „In Ordnung") wird automatisch eine Wiedervorlage mit Fristdatum erzeugt</p>
            <p>• <strong>Manuelle Anlage</strong> – Zusätzliche Wiedervorlagen können je Auszubildendem manuell erstellt werden</p>
            <p>• <strong>Statusverlauf:</strong> Offen → Überfällig (nach Ablauf der Frist) → Erledigt</p>
            <p>• <strong>Bearbeitungsnotizen</strong> können je Wiedervorlage hinterlegt werden (z.B. Rückmeldungen des Betriebs)</p>
            <p>• <strong>Filteroptionen:</strong> Alle / Offen / Überfällig / Erledigt</p>
          </div>

          <div id="help_14" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">📄 Berichte & Export</div>
            <p>Folgende Exportfunktionen stehen zur Verfügung:</p>
            <p>• <strong>Jahresbericht (PDF)</strong> – Zusammenfassende Statistik mit Mängelverteilung, Berufsschulübersicht, Fachrichtungsauswertung, Betriebsranking und detaillierter Aufschlüsselung nach Fachrichtung und zuständigem Amt</p>
            <p>• <strong>Durchsichtsbogen (PDF)</strong> – Einzeldokument je Auszubildendem mit allen Prüfergebnissen, KW-Mängeln und Pflichtbestandteilen</p>
            <p>• <strong>Serienbrief (Word)</strong> – Automatisierte Brieferzeugung über eigene .docx-Vorlage mit Platzhaltern (z.B. Aufforderungsschreiben an Ausbildungsbetriebe)</p>
            <p>• <strong>CSV-Export</strong> – Tabellarischer Export für die Weiterverarbeitung in Microsoft Excel</p>
            <p>• <strong>Snapshot-Archiv</strong> – Unveränderliche Momentaufnahme der Durchsichtsergebnisse eines Termins zur Dokumentation und Archivierung</p>
          </div>

          <div id="help_15" class="card" style="margin-bottom:12px">
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

          <div id="help_16" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-blue)">
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
            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">Erweiterte Filter (+ Filter):</p>
            <p>Über den <strong>+ Filter</strong>-Button können zusätzliche dynamische Filter hinzugefügt werden. Diese sind in 5 Kategorien organisiert:</p>
            <div style="margin-top:6px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px">
              <p><strong>Ausbildung</strong> – Verkürzer, Landesfachklasse, Geschlecht, Schulabschluss, Lehrjahr, Ausbildungsbeginn/-ende</p>
              <p><strong>Prüfungen</strong> – AP-Zulassung, AP bestanden, Prüfungserfolg, Zwischenprüfung</p>
              <p><strong>Standort</strong> – Berufsschule, Klasse, PLZ-Bereich, Betrieb Ort, Betrieb</p>
              <p><strong>Kontrolle</strong> – Offene Mängel, Offene Wiedervorlage, BAV-Status, Inaktive Schüler, Inaktiv-Grund</p>
              <p><strong>Datenqualität</strong> – Ohne Betrieb, Ohne Klasse, Ohne E-Mail</p>
            </div>
            <p style="margin-top:6px">Jeder Extra-Filter erscheint als <strong>Chip</strong> unter der Topbar und kann einzeln per ✕ entfernt werden. Mehrere Extra-Filter werden mit UND verknüpft.</p>
          </div>

          <div id="help_17" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">🔎 Globale Suche (Strg+K)</div>
            <p>Die Volltextsuche durchsucht den <strong>gesamten Datenbestand</strong> nach folgenden Feldern:</p>
            <p>• Nachname, Vorname, Ausbildungsbetrieb, Berufsschule, Klasse, Jahrgang, Fachrichtung, BAV-Identnummer, E-Mail, Telefon</p>
            <p>• Es werden bis zu 50 Treffer mit Ampelstatus und Betriebsangabe angezeigt</p>
            <p>• Ein Klick auf einen Treffer öffnet die Einzelansicht des Auszubildenden in der Kontrolle</p>
            <p>• <strong>Tastatur:</strong> Strg+K = Suche öffnen, Escape = schließen, ↑↓ = navigieren, Enter = auswählen</p>
          </div>

          <div id="help_18" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
            <div class="card-header" style="font-size:15px">⌨️ Tastenkürzel (vollständig)</div>
            <p><strong>Allgemein:</strong></p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px">
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Strg+K</kbd><span>Globale Suche öffnen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Strg+Z</kbd><span>Rückgängig (Undo)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Strg+Y</kbd><span>Wiederherstellen (Redo)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Strg+S</kbd><span>Sofort speichern</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">F1 / ?</kbd><span>Tastenkürzel-Übersicht</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Escape</kbd><span>Dialog schließen / Selektion aufheben</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Alt+1–8</kbd><span>Schnellnavigation (Dashboard, Stammdaten, Import, Planung, Kontrolle, WV, Berichte, Einstellungen)</span>
            </div>
            <p><strong>In der Kontrolle:</strong></p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px">
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Strg+→ / ←</kbd><span>Nächster / vorheriger Azubi</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">/</kbd><span>Schüler-Suche fokussieren</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">F5</kbd><span>Von Datenträger neu laden</span>
            </div>
            <p><strong>Im KW-Raster:</strong></p>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px">
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">A–G</kbd><span>Mängelcode togglen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">H</kbd><span>Fehltage-Popover öffnen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">1–5</kbd><span>Fehltage-Schnelleingabe</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">0</kbd><span>Fehltage entfernen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">I</kbd><span>Sonstiges-Dialog (Bemerkung)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">O</kbd><span>Keine Beanstandungen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Entf / Backspace</kbd><span>Zelle leeren (→ behoben)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Leertaste / Enter</kbd><span>Bearbeitungs-Modal öffnen</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Pfeiltasten</kbd><span>Zwischen Zellen navigieren</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Shift+Klick</kbd><span>Bereich auswählen (Bulk)</span>
              <kbd style="padding:2px 6px;background:var(--clr-sand);border-radius:3px;font-size:11px">Shift+Pfeiltaste</kbd><span>Selektion erweitern</span>
            </div>
          </div>

          <div id="help_19" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">↩️ Undo / Redo</div>
            <p>Im KW-Raster können Änderungen rückgängig gemacht werden:</p>
            <p>• <strong>Strg+Z</strong> – Letzte Aktion rückgängig machen (Undo)</p>
            <p>• <strong>Strg+Y</strong> oder <strong>Strg+Shift+Z</strong> – Wiederherstellen (Redo)</p>
            <p>• Der Undo-Verlauf ist session-lokal und wird beim Verlassen der Kontrolle zurückgesetzt</p>
            <p>• Unterstützt: Code-Toggles, Fehltage-Änderungen, Zellen leeren</p>
          </div>

          <div id="help_20" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">👥 Mehrbenutzer-Betrieb & Synchronisation</div>
            <p>Mehrere Ausbildungsberater können <strong>gleichzeitig</strong> mit derselben Datenbank arbeiten (gemeinsames Netzlaufwerk).</p>
            <p><strong>Funktionsweise:</strong></p>
            <p>1. Alle Sachbearbeiter öffnen dieselbe HTML-Datei und wählen denselben Arbeitsordner</p>
            <p>2. Jeder Sachbearbeiter wählt seinen Namen in der Benutzerauswahl (Topbar, rechts oben)</p>
            <p>3. Änderungen werden automatisch im 8-Sekunden-Intervall mit der gemeinsamen Datenbankdatei synchronisiert</p>
            <p>4. Ein <strong>Synchronisationsmarker</strong> (<code>_bhk/sync_*</code>) signalisiert anderen Instanzen, dass Änderungen vorliegen</p>
            <p><strong>Sperrsystem (Locking):</strong></p>
            <p>• Bearbeitet Sachbearbeiter A einen Auszubildenden, sehen andere Sachbearbeiter ein 🔒-Symbol (Datensatz gesperrt)</p>
            <p>• Sperren werden beim Speichern und Weiterschalten automatisch freigegeben</p>
            <p>• Sicherheits-Timeout: Sperren werden nach 15 Minuten Inaktivität automatisch aufgehoben</p>
            <p>• Beim Schließen des Browsers werden alle gehaltenen Sperren freigegeben</p>
            <p><strong>Positionsanzeige:</strong></p>
            <p>• In der Kontrollansicht wird angezeigt, welcher Sachbearbeiter aktuell welchen Auszubildenden bearbeitet</p>
          </div>

          <div id="help_21" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">💾 Datensicherung</div>
            <p><strong>Automatisches Speichern:</strong> Jede Änderung wird nach 1,5 Sekunden automatisch in die Datenbankdatei geschrieben (verzögertes Speichern). Ein manuelles Speichern ist nicht erforderlich.</p>
            <p><strong>Automatische Backups:</strong> Sicherungskopien der Datenbank werden regelmäßig in <code>_bhk/backups/</code> erstellt. Ältere Sicherungen werden automatisch bereinigt.</p>
            <p><strong>Empfehlung:</strong> Der Arbeitsordner sollte auf einem regelmäßig gesicherten Netzlaufwerk liegen. Die SQLite-Datei im Unterordner <code>Datenbanken/</code> enthält den gesamten Datenbestand und kann zusätzlich manuell gesichert werden.</p>
          </div>

          <div id="help_22" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-blue)">
            <div class="card-header" style="font-size:15px">⏱️ Nacherfassung (Übernahme von Altdaten)</div>
            <p>Beim Umstieg von der bisherigen papiergestützten Dokumentation auf die Berichtsheftkontrolle müssen vergangene Durchsichten nicht vollständig nacherfasst werden. Empfohlen wird folgender pragmatischer Ansatz:</p>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">📌 Was lohnt sich nachzuerfassen?</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>🔴 <strong>Priorität 1 – Pflicht (~15 Min.):</strong> Offene Wiedervorlagen übernehmen – andernfalls gehen laufende Fristen verloren. Nur die aktuell offenen Wiedervorlagen eintragen (Auszubildender, Frist, Art der Wiedervorlage).</p>
              <p>🟡 <strong>Priorität 2 – Empfohlen (~30 Min.):</strong> Letztes Durchsichtsergebnis je Auszubildendem erfassen. Damit arbeitet das Ampelsystem korrekt und das Dashboard zeigt zutreffende Kennzahlen.</p>
              <p>🟢 <strong>Priorität 3 – Optional (~60 Min.):</strong> KW-Mängelcodes der letzten Durchsicht übernehmen, sofern der Mängelverlauf bei der nächsten Kontrolle sichtbar sein soll.</p>
              <p>⚪ <strong>Weglassen:</strong> Ältere Durchsichten und Detail-KWs. Der Aufwand übersteigt den Nutzen – diese Daten sind auf den archivierten Papierbögen vorhanden.</p>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">🚀 Vorgehen mit der Schnellerfassung</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Voraussetzung:</strong> In <em>Einstellungen → Sichtbare Menüpunkte</em> die <strong>Nacherfassung</strong> aktivieren.</p>
              <p style="margin-top:6px"><strong>Schritt 1:</strong> Sidebar → <em>Nacherfassung</em> öffnen</p>
              <p><strong>Schritt 2:</strong> Datum der letzten Durchsicht eintragen, Ausbildungsberater wählen, Berufsschule auswählen</p>
              <p><strong>Schritt 3:</strong> In der Tabelle je Auszubildendem eintragen:</p>
              <p style="margin-left:16px">• <strong>Ergebnis:</strong> "In Ordnung" oder entsprechendes Mängel-Ergebnis</p>
              <p style="margin-left:16px">• <strong>WV-Frist:</strong> Erscheint automatisch bei Mängeln (+4 Wochen, anpassbar)</p>
              <p style="margin-left:16px">• <strong>Codes:</strong> Optional, z.B. A,F für fehlende Unterschriften + fehlende Berichte</p>
              <p style="margin-left:16px">• <strong>Bemerkung:</strong> Optional, Freitext</p>
              <p><strong>Schritt 4:</strong> "💾 Alle speichern" → Kontrolltermin + Ergebnisse + WV werden angelegt</p>
              <p style="margin-top:6px"><strong>Tipp:</strong> Die aufklappbare Liste <em>„Noch nicht kontrollierte Auszubildende"</em> zeigt, welche Auszubildenden noch keine Durchsicht im Datenbestand haben – gruppiert nach Berufsschule.</p>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">⏱ Zeitschätzung für die Erstbefüllung</p>
            <div style="margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
              <div style="padding:8px;background:var(--clr-amber-light);border-radius:var(--radius)">
                <div style="font-weight:700">Ohne Schnellerfassung</div>
                <p>20 Auszubildende: ~45 Min. (Einzelansicht)</p>
                <p>200 Auszubildende: ~6 Stunden</p>
                <p>600 Auszubildende: ~2 Tage</p>
              </div>
              <div style="padding:8px;background:var(--clr-green-light);border-radius:var(--radius)">
                <div style="font-weight:700">Mit Schnellerfassung</div>
                <p>20 Auszubildende: ~10 Min. (Tabelle)</p>
                <p>200 Auszubildende: ~1,5 Stunden</p>
                <p>600 Auszubildende: ~4 Stunden</p>
              </div>
            </div>

            <p style="margin-top:10px;font-weight:700;color:var(--clr-forest-dark)">💡 Wichtig: AP und ZP sind zwei getrennte Felder</p>
            <div style="margin-top:4px;padding:10px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.7">
              <p>Für jeden Auszubildenden werden sowohl der Termin der <strong>Abschlussprüfung (AP)</strong> als auch der Termin der <strong>Zwischenprüfung (ZP)</strong> geführt. Beide Werte stammen aus dem IBYKUS-Export und werden als getrennte Felder gespeichert:</p>
              <p style="margin-top:4px">• <strong>AP</strong> (S2027, W2027): Bestimmt den Abschlussjahrgang → Klassen- und Termin-Zuordnung</p>
              <p>• <strong>ZP</strong> (H2026, F2027): Wird im ZP-Filter und in der Anzeige verwendet</p>
              <p style="margin-top:4px">Im Jahrgänge-Filter kann <strong>entweder</strong> nach AP oder nach ZP gefiltert werden (nicht beides gleichzeitig), weil die Zeitpunkte unterschiedlich sind und eine AND-Verknüpfung keine sinnvollen Ergebnisse liefert.</p>
              <p style="margin-top:4px">Beim IBYKUS-Import werden AP und ZP <strong>nie vermischt</strong>. Wenn sich Werte in IBYKUS ändern (z.B. Verschiebung der AP), werden sie beim nächsten Import automatisch aktualisiert.</p>
            </div>
          </div>

          <div id="help_23" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">⚙️ Einstellungen</div>
            <p>Unter <strong>Sidebar → Einstellungen</strong> können folgende Optionen konfiguriert werden:</p>
            <p>• <strong>Textbausteine</strong> – Vorgefertigte Bemerkungstexte für KW-Raster (I-Code) und Ergebnis-Kommentare</p>
            <p>• <strong>Tariflöhne bearbeiten</strong> – Tarifliche Ausbildungsvergütung pro Beruf und Lehrjahr anpassen. Mindestvergütung §17 BBiG separat editierbar. „Auf Standard zurücksetzen" möglich.</p>
            <p>• <strong>Word-Vorlage</strong> – DOCX-Vorlage für Serienbriefe an Betriebe/Schulen hochladen</p>
            <p>• <strong>RP-Adressen</strong> – Adresse für persönliche Vorlage und Post-Versand</p>
            <p>• <strong>E-Mail-Vorlage Freisprechung</strong> – Text für Freisprechungseinladungen</p>
            <p>• <strong>Import-Verlauf</strong> – Letzte IBYKUS-Imports mit Datum, Anzahl und Status</p>
            <p>• <strong>Betrieb-Duplikate</strong> – Doppelte Betriebe erkennen und zusammenführen</p>
          </div>

          <div id="help_24" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-amber)">
            <div class="card-header" style="font-size:15px">🔧 Wartung & Administration</div>
            <p><strong>Architektur:</strong> Die gesamte Anwendung besteht aus einer einzigen HTML-Datei (~6 MB). Es wird kein Webserver und keine Installation benötigt. Sämtliche Abhängigkeiten – JavaScript-Bibliotheken (sql.js, Chart.js, jsPDF, PapaParse, SheetJS, PizZip, docxtemplater, FileSaver, pdf.js) und Schriftarten (DM Sans, Fraunces) – sind direkt in die HTML-Datei eingebettet. Es werden keine externen Ressourcen nachgeladen.</p>
            <p style="margin-top:8px"><strong>Aktualisierung:</strong></p>
            <p>1. Neue Version der HTML-Datei in den Arbeitsordner kopieren (bestehende Datei überschreiben)</p>
            <p>2. Browser-Tab mit F5 neu laden – die aktualisierte Version ist sofort verfügbar</p>
            <p>3. Datenbank und benutzerspezifische Einstellungen bleiben erhalten (getrennte Speicherung in <code>Datenbanken/</code> und <code>_bhk/</code>)</p>
            <p style="margin-top:8px"><strong>Backups:</strong></p>
            <p>• Automatische Backups in <code>_bhk/backups/</code> (werden regelmäßig bereinigt)</p>
            <p>• Manuelle Sicherung: Die .sqlite-Datei aus <code>Datenbanken/</code> kopieren</p>
            <p>• Für Disaster Recovery: gesamten Arbeitsordner sichern</p>
            <p style="margin-top:8px"><strong>Netzlaufwerk-Betrieb:</strong></p>
            <p>• Arbeitsordner auf einem gemeinsamen Netzlaufwerk ablegen (z.B. <code>Z:\\Berichtsheftkontrolle\\</code>)</p>
            <p>• Jeder Sachbearbeiter öffnet dieselbe HTML-Datei im Browser und wählt denselben Arbeitsordner</p>
            <p>• Der Synchronisationsmarker in <code>_bhk/sync_*</code> darf im laufenden Betrieb nicht gelöscht werden</p>
            <p>• Bei Synchronisationsproblemen: Alle Browser-Instanzen schließen, <code>_bhk/sync_*</code> löschen, Anwendung neu starten</p>
            <p style="margin-top:8px"><strong>Datenbank-Wartung:</strong></p>
            <p>• <em>Einstellungen → Betriebe zusammenführen</em>: Zusammenführung von Betriebsduplikaten (unterschiedliche Schreibweisen desselben Betriebs)</p>
            <p>• <em>IBYKUS Re-Import</em>: Bestehende Datensätze werden anhand der BAV-Identnummer aktualisiert, nicht dupliziert</p>
            <p>• Auszubildende mit BAV-Status „ENDE" (beendetes Ausbildungsverhältnis) verbleiben im Datenbestand, werden jedoch über den BAV-Status-Filter standardmäßig ausgeblendet</p>
          </div>

          <div id="help_25" class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-red)">
            <div class="card-header" style="font-size:15px">🔒 Datenschutz & Rechtskonformität</div>
            <p style="font-weight:600;color:var(--clr-forest-dark)">Datenschutzrechtliche Einordnung für Führungskräfte, Datenschutzbeauftragte und behördliche Prüfungen</p>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📌 Zweck und Rechtsgrundlage</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>Die Berichtsheftkontrolle dient der Durchführung und Dokumentation der Berichtsheft-Durchsichten gemäß den Aufgaben der zuständigen Stelle nach dem <strong>Berufsbildungsgesetz (BBiG)</strong>.</p>
              <p style="margin-top:6px"><strong>Rechtsgrundlage der Datenverarbeitung:</strong></p>
              <p>• <strong>Art. 6 Abs. 1 lit. e DSGVO</strong> i.V.m. <strong>§ 3 LDSG BW</strong> – Die Verarbeitung ist zur Wahrnehmung einer Aufgabe erforderlich, die im öffentlichen Interesse liegt bzw. in Ausübung öffentlicher Gewalt erfolgt.</p>
              <p>• <strong>§ 43 Abs. 1 Nr. 2 BBiG</strong> – Die ordnungsgemäße Führung des Berichtshefts (Ausbildungsnachweis) ist Zulassungsvoraussetzung zur Abschlussprüfung. Die zuständige Stelle ist verpflichtet, dies zu überwachen.</p>
              <p>• <strong>§ 76 BBiG</strong> – Aufgaben der zuständigen Stelle, insbesondere die Überwachung der Berufsausbildung.</p>
              <p style="margin-top:6px">Die Anwendung verarbeitet ausschließlich Daten, die zur Erfüllung dieser gesetzlichen Aufgabe erforderlich sind. Eine Einwilligung der Betroffenen ist nicht erforderlich, da die Verarbeitung auf einer gesetzlichen Grundlage beruht.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📋 Verarbeitete Datenkategorien</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p style="font-weight:700">Personenbezogene Daten der Auszubildenden:</p>
              <div style="display:grid;grid-template-columns:200px 1fr;gap:2px 12px;margin:4px 0 8px 0">
                <span><strong>Stammdaten</strong></span><span>Vor- und Nachname, Geschlecht</span>
                <span><strong>Kontaktdaten</strong></span><span>Telefonnummer, E-Mail-Adresse</span>
                <span><strong>Ausbildungsdaten</strong></span><span>Ausbildungsbetrieb, Fachrichtung, Berufsschulklasse, Ausbildungsbeginn/-ende, BAV-Status, BAV-Identnummer</span>
                <span><strong>Prüfungsdaten</strong></span><span>Abschlussprüfungstermin, Zwischenprüfungstermin, Prüfungsergebnis (bestanden/nicht bestanden/WDH), Zulassungsstatus</span>
                <span><strong>Schulische Vorbildung</strong></span><span>Schulabschluss vor Ausbildungsbeginn (codiert: 1–5)</span>
                <span><strong>Kontrolldaten</strong></span><span>Durchsichtsergebnisse, Mängelcodes (A–I) je Kalenderwoche, Fehltage, Bemerkungen, Prüfername und Zeitstempel</span>
                <span><strong>Verwaltungsdaten</strong></span><span>Zuständiges Amt, Wiedervorlagen (Frist, Art, Status)</span>
              </div>
              <p style="font-weight:700;margin-top:6px">Daten der Ausbildungsbetriebe:</p>
              <div style="display:grid;grid-template-columns:200px 1fr;gap:2px 12px;margin:4px 0 8px 0">
                <span><strong>Betriebsdaten</strong></span><span>Name, Firma, Zusatzbezeichnung, Betriebsnummer</span>
                <span><strong>Anschrift</strong></span><span>Straße, PLZ, Ort</span>
                <span><strong>Kontaktdaten</strong></span><span>Telefon, Fax, E-Mail, Ansprechpartner</span>
              </div>
              <p style="font-weight:700;margin-top:6px">Nicht verarbeitete Daten:</p>
              <p>Es werden <strong>keine</strong> Sozialversicherungsnummern, Bankverbindungen, Gesundheitsdaten, biometrischen Daten oder besondere Kategorien personenbezogener Daten i.S.d. Art. 9 DSGVO verarbeitet.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">🔄 Datenherkunft und Datenfluss</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Datenquelle:</strong> Sämtliche personenbezogenen Stammdaten werden ausschließlich aus dem <strong>BAV-System IBYKUS</strong> importiert (CSV-Export). Es erfolgt keine eigenständige Datenerhebung bei den Betroffenen.</p>
              <p style="margin-top:6px"><strong>IBYKUS bleibt das führende System.</strong> Die Berichtsheftkontrolle ist ein nachgelagertes Arbeitsinstrument. Änderungen an Stammdaten erfolgen ausschließlich in IBYKUS. Beim Re-Import werden bestehende Datensätze anhand der BAV-Identnummer aktualisiert, nicht dupliziert.</p>
              <p style="margin-top:6px"><strong>In der Anwendung ergänzte Daten:</strong> Ausschließlich dienstliche Kontrolldaten (Durchsichtsergebnisse, Mängelcodes, Fehltage, Wiedervorlagen, Bemerkungen). Diese entstehen im Rahmen der hoheitlichen Aufgabenwahrnehmung und werden nicht an IBYKUS zurückübermittelt.</p>
              <p style="margin-top:6px"><strong>Datenausgabe:</strong> PDF-Durchsichtsbögen und Berichte werden lokal erzeugt und vom Sachbearbeiter in den Verwaltungsvorgang (E-Akte/Papierakte) überführt. Es erfolgt kein automatisierter Datenversand.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">🖥️ Technische Architektur und Datensicherheit</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Lokale Verarbeitung:</strong> Die gesamte Anwendung läuft als einzelne HTML-Datei (~6 MB) im Browser des Dienstrechners. Es existiert kein externer Server, kein Backend, keine Cloud-Komponente. Die Datenverarbeitung erfolgt vollständig im Arbeitsspeicher des Browsers (Chromium-basierte JavaScript-Engine).</p>
              <p style="margin-top:6px"><strong>Datenspeicherung:</strong> Die Datenbank (SQLite-Format, ca. 1–30 MB) liegt als einzelne Datei auf dem Netzlaufwerk des Regierungspräsidiums Freiburg. Der Speicherort unterliegt den bestehenden Zugriffs- und Berechtigungskonzepten der Windows-Domäne (Active Directory).</p>
              <p style="margin-top:6px"><strong>Datensicherung:</strong> Automatische Backups werden im Unterordner <code>_bhk/backups/</code> des Arbeitsordners erstellt. Die reguläre Netzlaufwerk-Sicherung durch die IT-Abteilung bleibt davon unberührt und ergänzt den lokalen Backup-Mechanismus.</p>
              <p style="margin-top:6px"><strong>Zugriffsschutz:</strong> Der Zugriff auf die Datenbankdatei wird durch die NTFS-Berechtigungen des Netzlaufwerks gesteuert. Innerhalb der Anwendung identifizieren sich die Sachbearbeiter über ein Prüfer-Dropdown (Hannes Pix, Christoph Zilz, Eva Dronia). Diese Kennung dient der Nachvollziehbarkeit (wer hat wann welche Kontrolle durchgeführt), nicht der Authentifizierung im IT-Sicherheitssinne.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📡 Netzwerkverkehr und externe Verbindungen</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Es findet keinerlei Netzwerkverkehr statt.</strong></p>
              <p style="margin-top:6px">Sämtliche Abhängigkeiten – JavaScript-Bibliotheken (sql.js, Chart.js, jsPDF, PapaParse, SheetJS, PizZip, docxtemplater, FileSaver, pdf.js) und Schriftarten (DM Sans, Fraunces) – sind als Base64-codierte Daten direkt in die HTML-Datei eingebettet.</p>
              <p style="margin-top:6px">Die Anwendung lädt <strong>keine externen Ressourcen</strong>: kein Content Delivery Network (CDN), keine Web-Schriftarten (Google Fonts o.ä.), keine Analytics- oder Tracking-Dienste, keine Telemetrie. Eine Überprüfung mittels Browser-Entwicklertools (F12 → Netzwerk-Tab) bestätigt: null ausgehende HTTP-Anfragen.</p>
              <p style="margin-top:6px">Zu keinem Zeitpunkt werden personenbezogene Daten – weder Azubi-Stammdaten noch Kontrollergebnisse noch Metadaten – an Dritte, externe Server oder den Hersteller übermittelt.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📂 Aufbewahrung und Löschung</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p><strong>Aufbewahrungsdauer:</strong> Die Aufbewahrungsfristen richten sich nach den für die Berufsbildung geltenden Fristen der Aktenordnung des Regierungspräsidiums. Die Anwendung enthält keinen automatischen Löschmechanismus.</p>
              <p style="margin-top:6px"><strong>Löschung:</strong> Die vollständige Datenlöschung erfolgt durch Löschen der SQLite-Datenbankdatei auf dem Netzlaufwerk. Einzelne Auszubildende können über den BAV-Status „Ende" gefiltert und anschließend manuell gelöscht werden. Eine Archivierung abgeschlossener Jahrgänge ist durch Anlage einer separaten Datenbank möglich.</p>
              <p style="margin-top:6px"><strong>Backup-Bereinigung:</strong> Automatische Backups in <code>_bhk/backups/</code> werden regelmäßig bereinigt. Bei endgültiger Löschung sollten auch Backup-Dateien geprüft und ggf. entfernt werden.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">🏗️ Keine Softwareinstallation – Einordnung als Arbeitsmittel</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>Die Anwendung erfordert <strong>keine Installation, keine Administratorrechte und keine Konfiguration durch die IT-Abteilung</strong>. Sie wird als einzelne HTML-Datei im Browser geöffnet – funktional vergleichbar mit einer Excel-Arbeitsmappe mit erweiterter Funktionalität.</p>
              <p style="margin-top:6px"><strong>Technische Einordnung:</strong> Es handelt sich nicht um eine Fachanwendung im Sinne der IT-Strategie, sondern um ein lokales Arbeitsinstrument der Sachbearbeitung. Die Datei nutzt ausschließlich Standardfunktionalitäten des Browsers (File System Access API, Web SQL via sql.js). Es werden keine Browser-Erweiterungen, Plugins oder Systemressourcen außerhalb der Browser-Sandbox beansprucht.</p>
              <p style="margin-top:6px"><strong>Kompatibilität:</strong> Lauffähig auf den vorhandenen Dienstrechnern (Windows 10/11, Zero-Trust-Umgebung) mit Google Chrome oder Microsoft Edge. Keine Abhängigkeit von bestimmten Betriebssystemversionen oder zusätzlicher Software.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">⚖️ Datenschutz-Folgenabschätzung (DSFA)</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-blue-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <p>Eine Datenschutz-Folgenabschätzung nach Art. 35 DSGVO ist nach Einschätzung des Verantwortlichen <strong>nicht erforderlich</strong>, da:</p>
              <p style="margin-top:4px">• keine systematische und umfassende Bewertung persönlicher Aspekte natürlicher Personen stattfindet (kein Profiling, kein Scoring),</p>
              <p>• keine besonderen Kategorien personenbezogener Daten i.S.d. Art. 9 DSGVO verarbeitet werden,</p>
              <p>• keine umfangreiche Überwachung öffentlich zugänglicher Bereiche erfolgt,</p>
              <p>• der Kreis der Betroffenen auf Auszubildende im Zuständigkeitsbereich des RP Freiburg begrenzt ist (~600 Personen),</p>
              <p>• die verarbeiteten Datenkategorien und Speicherorte identisch mit den bisherigen Excel-basierten Verfahren sind,</p>
              <p>• keine Datenübermittlung an Dritte oder ins Ausland stattfindet.</p>
              <p style="margin-top:6px"><strong>Risikobewertung: niedrig.</strong> Die Anwendung ändert weder Art noch Umfang der Datenverarbeitung gegenüber dem bestehenden Verfahren. Sie strukturiert lediglich die bereits vorhandene dienstliche Datenverarbeitung in einem effizienteren Format.</p>
            </div>

            <p style="margin-top:12px;font-weight:600;color:var(--clr-forest-dark)">📎 Verzeichnis der Verarbeitungstätigkeiten (Kurzfassung)</p>
            <div style="margin-top:6px;padding:12px;background:var(--clr-sand-light);border-radius:var(--radius);font-size:12px;line-height:1.8">
              <div style="display:grid;grid-template-columns:220px 1fr;gap:4px 12px">
                <span><strong>Bezeichnung:</strong></span><span>Berichtsheftkontrolle – Durchsichten Gärtner</span>
                <span><strong>Verantwortlicher:</strong></span><span>Regierungspräsidium Freiburg, Abt. 3, Ref. 31</span>
                <span><strong>Zweck:</strong></span><span>Planung, Durchführung und Dokumentation der Berichtsheft-Durchsichten gemäß § 76 BBiG</span>
                <span><strong>Rechtsgrundlage:</strong></span><span>Art. 6 Abs. 1 lit. e DSGVO i.V.m. § 3 LDSG BW, § 43, § 76 BBiG</span>
                <span><strong>Betroffene:</strong></span><span>Auszubildende in Gärtner-Berufen im RP-Bezirk Freiburg</span>
                <span><strong>Datenkategorien:</strong></span><span>Stammdaten, Kontaktdaten, Ausbildungs- und Prüfungsdaten, Kontrollergebnisse (s.o.)</span>
                <span><strong>Empfänger:</strong></span><span>Keine Übermittlung an Dritte. Interne Nutzung durch die Ausbildungsberater des Ref. 31</span>
                <span><strong>Drittlandtransfer:</strong></span><span>Keiner. Ausschließlich lokale Verarbeitung auf Dienstrechnern/Netzlaufwerk</span>
                <span><strong>Löschfristen:</strong></span><span>Nach Maßgabe der Aktenordnung des RP Freiburg</span>
                <span><strong>TOM:</strong></span><span>Zugriffskontrolle über NTFS-Berechtigungen, Browser-Sandbox, verschlüsseltes Netzlaufwerk (Behördennetz), keine externe Datenübermittlung</span>
              </div>
            </div>
          </div>

          <div id="help_26" class="card" style="margin-bottom:12px">
            <div class="card-header" style="font-size:15px">❓ Häufig gestellte Fragen (FAQ)</div>
            <p><strong>Die Diagramme im Dashboard werden unscharf dargestellt.</strong><br>
            Stellen Sie sicher, dass Sie die aktuelle Version der Anwendung verwenden. Die Anwendung erkennt hochauflösende Bildschirme (HiDPI/Retina) automatisch und passt die Rendering-Qualität der Diagramme entsprechend an.</p>
            <p style="margin-top:8px"><strong>Auszubildende sind nach dem Import nicht mehr sichtbar.</strong><br>
            Prüfen Sie den BAV-Status-Filter in der Topbar (📋-Schaltfläche). Ist der Filter auf „Aktive BAV" eingestellt, werden Auszubildende mit dem BAV-Status „ENDE" (beendetes Ausbildungsverhältnis) ausgeblendet. Setzen Sie den Filter auf „Alle BAV", um sämtliche Datensätze anzuzeigen.</p>
            <p style="margin-top:8px"><strong>Können mehrere Sachbearbeiter gleichzeitig mit der Anwendung arbeiten?</strong><br>
            Ja. Der Arbeitsordner wird auf einem gemeinsamen Netzlaufwerk abgelegt. Alle Sachbearbeiter öffnen dieselbe HTML-Datei im Browser und wählen denselben Arbeitsordner. Das integrierte Synchronisationssystem gleicht Änderungen im 8-Sekunden-Intervall ab und verhindert durch ein Sperrsystem gleichzeitige Bearbeitung desselben Datensatzes.</p>
            <p style="margin-top:8px"><strong>Welche Browser werden unterstützt?</strong><br>
            Ausschließlich <strong>Google Chrome</strong> und <strong>Microsoft Edge</strong> (Chromium-basiert). Mozilla Firefox und Apple Safari werden nicht unterstützt, da diese Browser die erforderliche File System Access API nicht implementieren.</p>
            <p style="margin-top:8px"><strong>Wie viele Datensätze kann die Datenbank verarbeiten?</strong><br>
            Die Anwendung wurde für den Einsatz mit bis zu 20.000 Auszubildenden getestet (~30 MB Datenbankgröße). Die zugrundeliegende Datenbank-Engine (SQLite via sql.js) unterstützt Datenbankdateien bis 2 GB.</p>
            <p style="margin-top:8px"><strong>Was geschieht bei einem unerwarteten Schließen des Browsers?</strong><br>
            Die automatische Speicherung schreibt Änderungen nach 1,5 Sekunden in die Datenbankdatei. Im ungünstigsten Fall gehen lediglich die Eingaben der letzten Sekunden verloren. Zusätzlich werden regelmäßig automatische Sicherungskopien in <code>_bhk/backups/</code> erstellt.</p>
            <p style="margin-top:8px"><strong>Können abgeschlossene Jahrgänge archiviert werden?</strong><br>
            Ja. Erstellen Sie über den Startbildschirm eine neue Datenbank und importieren Sie ausschließlich die aktuellen Jahrgänge. Die bisherige Datenbank verbleibt im Ordner <code>Datenbanken/</code> und kann jederzeit erneut geöffnet werden.</p>
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

  exportHilfePDF() {
    const content = document.querySelector('#mainContent .fade-in');
    if (!content) return App.toast('Hilfe-Seite nicht gefunden', 'error');
    const cards = [...content.querySelectorAll('.card[id^="help_"]')].filter(c => c.style.display !== 'none');
    const titles = cards.map((c, i) => {
      const hdr = c.querySelector('.card-header');
      return { id: i, text: hdr ? hdr.textContent.trim() : `Abschnitt ${i+1}` };
    });
    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html><html><head><title>Hilfe – Berichtsheftkontrolle</title>
      <style>
        body{font-family:'Segoe UI','Helvetica',sans-serif;font-size:12px;line-height:1.7;max-width:800px;margin:0 auto;padding:30px 40px;color:#333}
        h1{font-size:22px;color:#2d5016;margin-bottom:4px}
        .subtitle{font-size:11px;color:#888;margin-bottom:24px}
        .toc{margin:16px 0 30px;padding:16px 20px;background:#f8f7f2;border:1px solid #ddd;border-radius:8px}
        .toc-title{font-weight:700;font-size:14px;color:#2d5016;margin-bottom:8px}
        .toc a{display:block;padding:2px 0;color:#2d5016;text-decoration:none;font-size:12px}
        .toc a:hover{text-decoration:underline}
        .toc-num{display:inline-block;width:24px;color:#888;font-size:11px}
        .section{border:1px solid #ddd;border-radius:8px;padding:14px 18px;margin-bottom:14px;break-inside:avoid;page-break-inside:avoid}
        .section-header{font-weight:700;font-size:15px;margin-bottom:8px;color:#2d5016;border-bottom:1px solid #e0e0d8;padding-bottom:4px}
        strong{color:#1a3a0a}
        code,kbd{background:#f0f0f0;padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace}
        table{border-collapse:collapse;width:100%;font-size:11px;margin:8px 0}
        th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}th{background:#f5f5f0}
        .footer{margin-top:30px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#999;text-align:center}
        @media print{.toc{break-after:page}.section{break-inside:avoid}}
      </style></head><body>
      <h1>📖 Hilfe – Berichtsheftkontrolle</h1>
      <div class="subtitle">Version 2.0 · Stand: 27.04.2026 · Regierungspräsidium Freiburg, Abt. 3, Ref. 31</div>
      <div class="toc">
        <div class="toc-title">Inhaltsverzeichnis</div>
        ${titles.map((t, i) => `<a href="#pdf_${t.id}"><span class="toc-num">${i+1}.</span> ${t.text}</a>`).join('')}
      </div>`);
    cards.forEach((card, i) => {
      const hdr = card.querySelector('.card-header');
      const title = hdr ? hdr.textContent.trim() : '';
      const bodyHTML = card.innerHTML.replace(/<div class="card-header"[^>]*>.*?<\/div>/i, '');
      printWin.document.write(`<div class="section" id="pdf_${i}"><div class="section-header">${i+1}. ${title}</div>${bodyHTML}</div>`);
    });
    printWin.document.write(`<div class="footer">Berichtsheftkontrolle v2.0 · Regierungspräsidium Freiburg · Generiert am ${new Date().toLocaleDateString('de-DE')}</div></body></html>`);
    printWin.document.close();
    setTimeout(() => { printWin.print(); }, 500);
  },

  showLogbuch() {
    const logs = App.query("SELECT * FROM aenderungslog ORDER BY zeitpunkt DESC LIMIT 200");
    const feldLabel = {nachname:'Nachname',vorname:'Vorname',ausbildungsbeginn:'AV-Beginn',ausbildungsende:'AV-Ende',ausbildungsstaette:'Betrieb',status:'Status',aktiv:'Aktiv',ap_zugelassen:'AP-Zulassung',ap_bestanden:'AP-Bestanden',jahrgang_id:'Jahrgang',klasse_id:'Klasse',fachrichtung_id:'Fachrichtung',betrieb_id:'Betrieb-ID',zwischenpruefung:'ZP',zustaendiges_amt:'Amt',landesfachklasse:'LFK',inaktiv_datum:'Inaktiv-Datum',inaktiv_grund:'Inaktiv-Grund',beruf_id:'Beruf',geburtsdatum:'Geburtsdatum',regulaer_dauer_monate:'Dauer (Mon.)',verkuerzung_monate:'Verkürzung',vorzeitige_zulassung:'§45 Vorz.',brutto_lohn:'Bruttolohn',zp_termin:'ZP-Termin',ap_termin:'AP-Termin'};
    App.openModal('📋 Änderungs-Logbuch', `
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto">
        <table class="data-table" style="font-size:11px">
          <thead><tr><th>Zeitpunkt</th><th>Azubi</th><th>Feld</th><th>Alt</th><th>Neu</th><th>Aktion</th><th>Bearbeiter</th><th>IBYKUS</th></tr></thead>
          <tbody>${logs.map(l => `<tr style="${l.exportiert ? 'opacity:0.5' : l.ibykus_relevant ? 'background:var(--clr-amber-light)' : ''}">
            <td style="white-space:nowrap">${esc(l.zeitpunkt||'')}</td>
            <td><strong>${esc(l.schueler_name||'')}</strong></td>
            <td>${esc(feldLabel[l.feld] || l.feld)}</td>
            <td style="color:var(--clr-red)">${esc(l.alter_wert||'–')}</td>
            <td style="color:var(--clr-green);font-weight:600">${esc(l.neuer_wert||'–')}</td>
            <td style="font-size:10px">${esc(l.aktion||'')}</td>
            <td style="font-size:10px">${esc(l.bearbeiter||'')}</td>
            <td style="text-align:center">${l.ibykus_relevant ? (l.exportiert ? '✓' : '⚠️') : '–'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="Views.exportLogbuch();App.closeModal()">📄 CSV exportieren</button>`);
    _makeModalWide();
  },

  exportLogbuch() {
    const logs = App.query("SELECT * FROM aenderungslog WHERE ibykus_relevant=1 ORDER BY zeitpunkt DESC");
    if (!logs.length) return App.toast('Keine IBYKUS-relevanten Änderungen vorhanden', 'warning');
    const header = 'Zeitpunkt;Azubi;Feld;Alter Wert;Neuer Wert;Aktion;Bearbeiter;Exportiert';
    const rows = logs.map(l => [l.zeitpunkt, l.schueler_name, l.feld, l.alter_wert, l.neuer_wert, l.aktion, l.bearbeiter, l.exportiert ? 'Ja' : 'Nein'].map(v => `"${(v||'').replace(/"/g,'""')}"`).join(';'));
    const csv = '﻿' + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `IBYKUS-Aenderungen_${todayStr()}.csv`;
    a.click();
    App.toast(`${logs.length} Einträge exportiert`, 'success');
  },

  openTarifModal() {
    const saved = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_tarife'") || 'null');
    const berufe = saved || AzubiRechner.BERUFE;
    const miav = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_mindestverguetung'") || 'null') || AzubiRechner.MINDESTVERGUETUNG;

    const berufRows = berufe.map((b, bi) => {
      const lastTarif = b.tarife[b.tarife.length - 1];
      return `<tr>
        <td style="font-size:12px;font-weight:600">${esc(b.label)}</td>
        <td><input type="number" class="form-control" style="width:70px;padding:2px 4px;font-size:12px" data-beruf="${bi}" data-lj="0" value="${lastTarif.lj[0]}" min="0"></td>
        <td><input type="number" class="form-control" style="width:70px;padding:2px 4px;font-size:12px" data-beruf="${bi}" data-lj="1" value="${lastTarif.lj[1]}" min="0"></td>
        <td><input type="number" class="form-control" style="width:70px;padding:2px 4px;font-size:12px" data-beruf="${bi}" data-lj="2" value="${lastTarif.lj[2]}" min="0"></td>
        <td style="font-size:10px;color:var(--clr-text-light)">ab ${lastTarif.ab}</td>
      </tr>`;
    }).join('');

    const lastMiav = miav[miav.length - 1];
    App.openModal('Tariflöhne bearbeiten', `
      <div style="font-size:13px;margin-bottom:12px;color:var(--clr-text-light)">
        Aktuelle Tarife (letzter gültiger Eintrag pro Beruf). Änderungen gelten für alle neuen Berechnungen.
      </div>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Beruf</th><th>1. LJ (€)</th><th>2. LJ (€)</th><th>3. LJ (€)</th><th>Gültig</th></tr></thead>
          <tbody>${berufRows}</tbody>
        </table>
      </div>
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">Mindestvergütung §17 BBiG</div>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:6px;align-items:center;font-size:12px;margin-bottom:12px">
        <span style="font-weight:600">Aktuell (${lastMiav.ab}):</span>
        <input type="number" class="form-control" style="padding:2px 4px;font-size:12px" id="miav1" value="${lastMiav.lj[0]}" min="0">
        <input type="number" class="form-control" style="padding:2px 4px;font-size:12px" id="miav2" value="${lastMiav.lj[1]}" min="0">
        <input type="number" class="form-control" style="padding:2px 4px;font-size:12px" id="miav3" value="${lastMiav.lj[2]}" min="0">
      </div>
      <div style="font-size:11px;color:var(--clr-text-light)">Fachwerker erhalten Ausbildungsgeld der Arbeitsagentur (${AzubiRechner.FACHWERKER_AUSBILDUNGSGELD.elternhaushalt}€ / ${AzubiRechner.FACHWERKER_AUSBILDUNGSGELD.eigeneWohnung}€) — nicht tarifgebunden.</div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-sm" style="color:var(--clr-red)" onclick="App.run(&quot;DELETE FROM einstellungen WHERE schluessel IN ('custom_tarife','custom_mindestverguetung')&quot;);AzubiRechner._loadCustomTarife();App.closeModal();App.toast('Auf Standard-Tarife zurückgesetzt','success')">Auf Standard zurücksetzen</button>
        <button class="btn btn-primary" onclick="Views.saveTarife()">Speichern</button>`);
    _makeModalWide();
  },

  saveTarife() {
    const saved = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_tarife'") || 'null');
    const berufe = JSON.parse(JSON.stringify(saved || AzubiRechner.BERUFE));
    document.querySelectorAll('[data-beruf]').forEach(input => {
      const bi = parseInt(input.dataset.beruf);
      const lj = parseInt(input.dataset.lj);
      const val = parseInt(input.value) || 0;
      if (berufe[bi]) {
        berufe[bi].tarife[berufe[bi].tarife.length - 1].lj[lj] = val;
      }
    });
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('custom_tarife',?)", [JSON.stringify(berufe)]);

    const miav = JSON.parse(JSON.stringify(JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_mindestverguetung'") || 'null') || AzubiRechner.MINDESTVERGUETUNG));
    const lastIdx = miav.length - 1;
    miav[lastIdx].lj[0] = parseInt(document.getElementById('miav1').value) || 0;
    miav[lastIdx].lj[1] = parseInt(document.getElementById('miav2').value) || 0;
    miav[lastIdx].lj[2] = parseInt(document.getElementById('miav3').value) || 0;
    App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('custom_mindestverguetung',?)", [JSON.stringify(miav)]);

    AzubiRechner._loadCustomTarife();
    App.closeModal();
    App.toast('Tariflöhne gespeichert', 'success');
  },
};
