// ══════════════════════════════════════════════════════════════
//  DATENBANK-TOOLS (Einstellungen)
//  Bestandsübersicht, Verdichten alter Azubis, Jahrgänge mit Archiv
//  löschen, Aufräumen + Neuaufbau der Datei (VACUUM), Archiv-Rückholung.
//
//  Grundsatz: Vorschau mit Zahlen → Backup → Ausführen über den
//  Bulk-Pfad (kein Op-Protokoll, Snapshot wird direkt neu geschrieben,
//  die anderen Clients laden ihn beim nächsten Abgleich) → Neuaufbau.
//  Nichts läuft offline, bei Netzabriss oder mit ausstehendem Import.
// ══════════════════════════════════════════════════════════════

const DbTools = {
  VERDICHTEN_MONATE_STANDARD: 24,
  LOG_MONATE_STANDARD: 24,
  IMPORT_DETAILS_MONATE: 12,
  STAMPS_TAGE: 90,
  BLOCKPLAN_SCHULJAHRE: 2,
  ANDERE_AKTIV_MINUTEN: 10,
  ARCHIV_ORDNER: 'archiv',
  _letzteVorschau: null,
  _letzterLauf: null,

  // ─────────────────────────────────────────────
  //  Bestand
  // ─────────────────────────────────────────────
  TABELLEN: [
    ['schueler', 'Azubis'], ['kw_status', 'Wochendaten (KW-Raster)'], ['kw_maengel', 'Mängel je KW'],
    ['durchsicht_snapshots', 'Durchsichts-Snapshots'], ['kontrollergebnisse', 'Kontrollergebnisse'],
    ['kontrolltermine', 'Kontrolltermine'], ['wiedervorlagen', 'Wiedervorlagen'], ['wiedervorlage_notizen', 'WV-Notizen'],
    ['aenderungslog', 'Änderungslog'], ['import_historie', 'Import-Historie'], ['bhk_stamps', 'Sync-Stempel'],
    ['bhk_applied_ops', 'Sync: angewandte Ops'], ['bhk_tombstones', 'Sync: Löschmarken'], ['bhk_papierkorb', 'Papierkorb'],
    ['betriebe', 'Betriebe'], ['ausbilder', 'Ausbilder'], ['klassen', 'Klassen'], ['berufsschulen', 'Berufsschulen'],
    ['blockplan', 'Blockplan-Wochen'], ['schueler_bemerkungen', 'Bemerkungen'], ['schueler_dateien', 'Akten-Dateien'],
    ['ausbildungsphasen', 'Ausbildungsphasen'], ['abschlussjahrgaenge', 'Jahrgänge'],
  ],
  _count(sql, params) { try { return App.scalar(sql, params || []) || 0; } catch(e) { return 0; } },
  _bytes(n) {
    n = n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  },
  bestand() {
    const tabellen = this.TABELLEN.map(([name, label]) => ({ name, label, zeilen: this._count(`SELECT COUNT(*) FROM ${name}`) }));
    let pageSize = 4096, pageCount = 0, freelist = 0;
    try { pageSize = App.db.exec('PRAGMA page_size')[0].values[0][0]; pageCount = App.db.exec('PRAGMA page_count')[0].values[0][0]; freelist = App.db.exec('PRAGMA freelist_count')[0].values[0][0]; } catch(e) {}
    const azubis = { aktiv: this._count('SELECT COUNT(*) FROM schueler WHERE aktiv=1'), inaktiv: this._count('SELECT COUNT(*) FROM schueler WHERE aktiv=0') };
    return {
      tabellen, azubis,
      dateiBytes: App._lastFileSize || pageSize * pageCount,
      speicherBytes: pageSize * pageCount,
      freiBytes: pageSize * freelist,
      jahrgaenge: this.jahrgangsUebersicht(),
    };
  },
  jahrgangsUebersicht() {
    // EINE Gruppierung je Tabelle statt einer Unterabfrage je Jahrgang. Die alte
    // Fassung las kw_status einmal PRO Jahrgang komplett – bei 21 Jahrgängen und
    // 300.000 Wochenzeilen dauerte allein diese Übersicht rund 10 Sekunden.
    const rows = App.query(`SELECT j.id, j.bezeichnung, j.jahr, j.typ,
        COALESCE(s.aktiv, 0) AS aktiv, COALESCE(s.inaktiv, 0) AS inaktiv,
        MAX(COALESCE(t1.d, ''), COALESCE(t2.d, '')) AS letzter_termin,
        COALESCE(kw.n, 0) AS kw_zeilen, COALESCE(ds.n, 0) AS snapshots,
        COALESCE(ke.n, 0) AS ergebnisse, COALESCE(wv.n, 0) AS wv_offen
      FROM abschlussjahrgaenge j
      LEFT JOIN (SELECT jahrgang_id, SUM(aktiv=1) AS aktiv, SUM(aktiv=0) AS inaktiv FROM schueler GROUP BY jahrgang_id) s ON s.jahrgang_id=j.id
      LEFT JOIN (SELECT jahrgang_id, MAX(COALESCE(NULLIF(durchgefuehrt_datum,''), geplant_datum)) AS d FROM kontrolltermine WHERE jahrgang_id IS NOT NULL GROUP BY jahrgang_id) t2 ON t2.jahrgang_id=j.id
      LEFT JOIN (SELECT s2.jahrgang_id, MAX(COALESCE(NULLIF(kt.durchgefuehrt_datum,''), kt.geplant_datum)) AS d
                 FROM kontrollergebnisse ke2 JOIN schueler s2 ON s2.id=ke2.schueler_id JOIN kontrolltermine kt ON kt.id=ke2.kontrolltermin_id
                 GROUP BY s2.jahrgang_id) t1 ON t1.jahrgang_id=j.id
      LEFT JOIN (SELECT s3.jahrgang_id, COUNT(*) AS n FROM kw_status k JOIN schueler s3 ON s3.id=k.schueler_id GROUP BY s3.jahrgang_id) kw ON kw.jahrgang_id=j.id
      LEFT JOIN (SELECT s4.jahrgang_id, COUNT(*) AS n FROM durchsicht_snapshots d JOIN schueler s4 ON s4.id=d.schueler_id GROUP BY s4.jahrgang_id) ds ON ds.jahrgang_id=j.id
      LEFT JOIN (SELECT s5.jahrgang_id, COUNT(*) AS n FROM kontrollergebnisse ke JOIN schueler s5 ON s5.id=ke.schueler_id GROUP BY s5.jahrgang_id) ke ON ke.jahrgang_id=j.id
      LEFT JOIN (SELECT s6.jahrgang_id, COUNT(*) AS n FROM wiedervorlagen w JOIN schueler s6 ON s6.id=w.schueler_id WHERE w.status!='erledigt' GROUP BY s6.jahrgang_id) wv ON wv.jahrgang_id=j.id
      ORDER BY j.jahr DESC, j.bezeichnung`);
    rows.forEach(r => { if (!r.letzter_termin) r.letzter_termin = null; });
    const ohne = App.query(`SELECT COUNT(*) AS n, SUM(aktiv=1) AS aktiv, SUM(aktiv=0) AS inaktiv FROM schueler WHERE jahrgang_id IS NULL`)[0];
    rows.forEach(r => { r.abgeschlossen = r.aktiv === 0 && r.inaktiv > 0; });
    if (ohne && ohne.n) rows.push({ id: 0, bezeichnung: '(ohne Jahrgang)', jahr: 0, aktiv: ohne.aktiv || 0, inaktiv: ohne.inaktiv || 0, letzter_termin: null, kw_zeilen: 0, snapshots: 0, ergebnisse: 0, wv_offen: 0, abgeschlossen: false });
    return rows;
  },

  // ─────────────────────────────────────────────
  //  Verdichten: Wochendaten inaktiver Azubis entfernen,
  //  Ergebnisse/WV/Akte bleiben. Statistik bleibt stimmig.
  // ─────────────────────────────────────────────
  _stichtag(monate) {
    const d = new Date(); d.setMonth(d.getMonth() - (parseInt(monate) || this.VERDICHTEN_MONATE_STANDARD));
    return d.toISOString().slice(0, 10);
  },
  verdichtenKandidaten(monate, jahrgangIds) {
    const stich = this._stichtag(monate);
    const jg = Array.isArray(jahrgangIds) && jahrgangIds.length ? ` AND s.jahrgang_id IN (${jahrgangIds.map(Number).filter(n => n > 0).join(',') || '0'})` : '';
    // Kandidat: inaktiv, keine offene WV, letzte Aktivität (Termin, Status-Datum, Ausbildungsende) vor dem Stichtag
    return App.query(`SELECT s.id, s.nachname, s.vorname, s.jahrgang_id,
        MAX(COALESCE(NULLIF(s.inaktiv_datum,''), ''), COALESCE(NULLIF(s.ausbildungsende,''), ''),
            COALESCE((SELECT MAX(COALESCE(NULLIF(kt.durchgefuehrt_datum,''), kt.geplant_datum)) FROM kontrollergebnisse ke JOIN kontrolltermine kt ON kt.id=ke.kontrolltermin_id WHERE ke.schueler_id=s.id), '')) AS letzte_aktivitaet,
        (SELECT COUNT(*) FROM kw_status k WHERE k.schueler_id=s.id) AS kw_zeilen,
        (SELECT COUNT(*) FROM durchsicht_snapshots d WHERE d.schueler_id=s.id) AS snapshots,
        (SELECT COUNT(*) FROM kw_maengel m WHERE m.kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id=s.id)) AS maengel
      FROM schueler s
      WHERE s.aktiv=0${jg}
        AND NOT EXISTS (SELECT 1 FROM wiedervorlagen w WHERE w.schueler_id=s.id AND w.status!='erledigt')
        AND ((SELECT COUNT(*) FROM kw_status k WHERE k.schueler_id=s.id) > 0 OR (SELECT COUNT(*) FROM durchsicht_snapshots d WHERE d.schueler_id=s.id) > 0)
      ORDER BY s.nachname, s.vorname`).filter(r => r.letzte_aktivitaet && r.letzte_aktivitaet.slice(0, 10) < stich);
  },
  verdichtenVorschau(monate, jahrgangIds) {
    const k = this.verdichtenKandidaten(monate, jahrgangIds);
    return { azubis: k.length, kwZeilen: k.reduce((a, r) => a + r.kw_zeilen, 0), snapshots: k.reduce((a, r) => a + r.snapshots, 0), maengel: k.reduce((a, r) => a + r.maengel, 0), ids: k.map(r => r.id), stichtag: this._stichtag(monate) };
  },
  // Reiner DB-Teil (ohne Speichern) – auch aus Tests aufrufbar
  _verdichtenAusfuehren(ids) {
    let n = 0;
    for (const id of ids) {
      const s = App.query('SELECT id, nachname, vorname FROM schueler WHERE id=? AND aktiv=0', [id])[0];
      if (!s) continue;
      const kw = this._count('SELECT COUNT(*) FROM kw_status WHERE schueler_id=?', [id]);
      const sn = this._count('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=?', [id]);
      App.run('DELETE FROM kw_maengel WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id=?)', [id]);
      App.run('DELETE FROM durchsicht_snapshots WHERE schueler_id=?', [id]);
      App.run('DELETE FROM kw_status WHERE schueler_id=?', [id]);
      try { App.logChange(id, 'wochendaten', `${kw} KW-Zeilen, ${sn} Snapshots`, 'verdichtet (Ergebnisse bleiben)', 'verdichtet'); } catch(e) {}
      n++;
    }
    return n;
  },
  async verdichten(monate, jahrgangIds) {
    const v = this.verdichtenVorschau(monate, jahrgangIds);
    if (!v.azubis) return App.toast('Keine Kandidaten zum Verdichten', 'info');
    const ok = await this._bestaetigen(`${v.azubis} inaktive Azubis verdichten?\n\nEntfernt werden ${v.kwZeilen} Wochenzeilen, ${v.maengel} KW-Mängel und ${v.snapshots} Durchsichts-Snapshots (letzte Aktivität vor ${v.stichtag}).\nAzubi, Kontrollergebnisse, Wiedervorlagen, Bemerkungen und Akten-Dateien bleiben erhalten.`, 'Verdichten');
    if (!ok) return;
    await this._ausfuehren('verdichten', () => {
      const n = this._verdichtenAusfuehren(v.ids);
      return `${n} Azubis verdichtet (${v.kwZeilen} Wochenzeilen, ${v.snapshots} Snapshots entfernt)`;
    });
  },

  // ─────────────────────────────────────────────
  //  Jahrgänge löschen – nur mit Archiv
  // ─────────────────────────────────────────────
  _jgIds(ids) { return (Array.isArray(ids) ? ids : [ids]).map(Number).filter(n => n > 0); },
  _jgIn(ids) { const a = this._jgIds(ids); return a.length ? a.join(',') : '0'; },
  jahrgangLoeschenVorschau(jahrgangIds) {
    const inn = this._jgIn(jahrgangIds);
    const q = (sql) => this._count(sql);
    const jgs = App.query(`SELECT id, bezeichnung FROM abschlussjahrgaenge WHERE id IN (${inn})`);
    const schuelerIds = App.query(`SELECT id FROM schueler WHERE jahrgang_id IN (${inn})`).map(r => r.id);
    const sIn = schuelerIds.length ? schuelerIds.join(',') : '0';
    // Termine: dem Jahrgang zugeordnet ODER ausschließlich Ergebnisse dieser Azubis
    const termine = App.query(`SELECT id FROM kontrolltermine kt WHERE kt.jahrgang_id IN (${inn})
      OR (EXISTS (SELECT 1 FROM kontrollergebnisse ke WHERE ke.kontrolltermin_id=kt.id AND ke.schueler_id IN (${sIn}))
          AND NOT EXISTS (SELECT 1 FROM kontrollergebnisse ke WHERE ke.kontrolltermin_id=kt.id AND ke.schueler_id NOT IN (${sIn})))`).map(r => r.id);
    const tIn = termine.length ? termine.join(',') : '0';
    return {
      jahrgaenge: jgs,
      aktiv: q(`SELECT COUNT(*) FROM schueler WHERE jahrgang_id IN (${inn}) AND aktiv=1`),
      azubis: schuelerIds.length, schuelerIds,
      termine: termine.length, terminIds: termine,
      termineGeteilt: q(`SELECT COUNT(DISTINCT kt.id) FROM kontrolltermine kt JOIN kontrollergebnisse ke ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id IN (${sIn}) AND kt.id NOT IN (${tIn})`),
      ergebnisse: q(`SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id IN (${sIn})`),
      kwZeilen: q(`SELECT COUNT(*) FROM kw_status WHERE schueler_id IN (${sIn})`),
      snapshots: q(`SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id IN (${sIn})`),
      wiedervorlagen: q(`SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id IN (${sIn})`),
      wvOffen: q(`SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id IN (${sIn}) AND status!='erledigt'`),
      dateien: q(`SELECT COUNT(*) FROM schueler_dateien WHERE schueler_id IN (${sIn})`),
      klassen: q(`SELECT COUNT(*) FROM klassen WHERE jahrgang_id IN (${inn})`),
      logZeilen: q(`SELECT COUNT(*) FROM aenderungslog WHERE schueler_id IN (${sIn})`),
    };
  },
  // Reiner DB-Teil: Azubis + Termine + Klassen + Jahrgang entfernen (ohne Papierkorb, Archiv ist die Sicherung)
  _jahrgaengeLoeschenAusfuehren(jahrgangIds, archivName) {
    const v = this.jahrgangLoeschenVorschau(jahrgangIds);
    const inn = this._jgIn(jahrgangIds);
    v.schuelerIds.forEach(id => {
      const s = App.query('SELECT nachname, vorname, ibykus_id FROM schueler WHERE id=?', [id])[0];
      if (s) { try { App.logChange(id, 'datensatz', `${s.nachname}, ${s.vorname}` + (s.ibykus_id ? ` (IBYKUS ${s.ibykus_id})` : ''), 'gelöscht – Archiv ' + (archivName || ''), 'geloescht'); } catch(e) {} }
      App.deleteSchuelerKaskade(id, { ohnePapierkorb: true, dateienBehalten: true });
    });
    v.terminIds.forEach(id => App.deleteTerminKaskade(id, { ohnePapierkorb: true }));
    App.query(`SELECT id FROM klassen WHERE jahrgang_id IN (${inn})`).forEach(k => App.deleteKlasseKaskade(k.id));
    this._jgIds(jahrgangIds).forEach(id => App.deleteJahrgangKaskade(id));
    // Einträge im Papierkorb, die auf gelöschte Azubis zeigen, wären nach dem Archiv-Löschen irreführend
    try { App.run(`DELETE FROM bhk_papierkorb WHERE art='schueler' AND ref_id IN (${v.schuelerIds.length ? v.schuelerIds.join(',') : '0'})`); } catch(e) {}
    return v;
  },
  async jahrgaengeLoeschen(jahrgangIds) {
    const ids = this._jgIds(jahrgangIds);
    if (!ids.length) return App.toast('Keinen Jahrgang ausgewählt', 'warning');
    const v = this.jahrgangLoeschenVorschau(ids);
    if (v.aktiv > 0) return App.toast(`${v.aktiv} Azubis dieses Jahrgangs sind noch aktiv – erst Jahrgang abschließen oder Status setzen`, 'error');
    if (!App.bhkDirHandle) return App.toast('Kein Datenbank-Ordner verbunden – Archiv kann nicht geschrieben werden', 'error');
    const namen = v.jahrgaenge.map(j => j.bezeichnung).join(', ');
    const text = `Jahrgang ${namen} endgültig löschen?\n\n` +
      `${v.azubis} Azubis, ${v.termine} Termine, ${v.ergebnisse} Ergebnisse, ${v.kwZeilen} Wochenzeilen, ${v.wiedervorlagen} Wiedervorlagen (${v.wvOffen} offen), ${v.dateien} Akten-Dateien, ${v.klassen} Klassen.\n` +
      (v.termineGeteilt ? `${v.termineGeteilt} Termine mit Azubis anderer Jahrgänge bleiben bestehen (nur die Ergebnisse dieses Jahrgangs werden entfernt).\n` : '') +
      `\nVorher wird ein Archiv (SQLite + Excel) nach _bhk/${this.ARCHIV_ORDNER}/ geschrieben und gegengelesen. Erst danach wird gelöscht.\n\nZur Bestätigung LÖSCHEN eingeben:`;
    const eingabe = await App.prompt(text, { titel: 'Jahrgang löschen' });
    if (eingabe !== 'LÖSCHEN') return App.toast('Abgebrochen', 'info');
    let archiv;
    try {
      App.showLoading('Archiv wird geschrieben…');
      archiv = await this._archivSchreiben(ids, v);
    } catch(e) {
      App.hideLoading();
      console.error('Archiv:', e);
      return App.toast('Archiv konnte nicht geschrieben werden – NICHTS gelöscht: ' + e.message, 'error');
    }
    App.hideLoading();
    await this._ausfuehren('jahrgang', () => {
      const r = this._jahrgaengeLoeschenAusfuehren(ids, archiv.name);
      return `Jahrgang ${namen} gelöscht (${r.azubis} Azubis, ${r.termine} Termine) – Archiv: ${archiv.name}`;
    }, { nachher: async () => { await this._aktenDateienVerschieben(v.schuelerIds, archiv.dirName); } });
  },

  // ── Archiv: eigene SQLite mit exakt den betroffenen Zeilen + Excel-Übersicht ──
  _archivName(jgs) {
    const bez = jgs.map(j => j.bezeichnung).join('+').replace(/[^A-Za-z0-9+_-]/g, '_').slice(0, 40) || 'jahrgang';
    return `archiv_${bez}_${new Date().toISOString().slice(0, 10)}`;
  },
  // Baut die Archiv-DB im Speicher (auch aus Tests nutzbar). Gibt die sql.js-DB zurück.
  _archivDbBauen(jahrgangIds, SQLlib) {
    const v = this.jahrgangLoeschenVorschau(jahrgangIds);
    const inn = this._jgIn(jahrgangIds);
    const sIn = v.schuelerIds.length ? v.schuelerIds.join(',') : '0';
    const tIn = v.terminIds.length ? v.terminIds.join(',') : '0';
    // Alle Termine mit Ergebnissen dieser Azubis (auch geteilte) mitnehmen – im Archiv schadet Mehr nicht
    const tAlle = App.query(`SELECT DISTINCT kontrolltermin_id AS id FROM kontrollergebnisse WHERE schueler_id IN (${sIn}) UNION SELECT id FROM kontrolltermine WHERE id IN (${tIn})`).map(r => r.id);
    const tIn2 = tAlle.length ? tAlle.join(',') : '0';
    const bedingungen = {
      abschlussjahrgaenge: `id IN (${inn})`,
      fachrichtungen: '1=1', berufsschulen: '1=1', pruefer: '1=1',
      klassen: `jahrgang_id IN (${inn}) OR id IN (SELECT klasse_id FROM schueler WHERE id IN (${sIn}))`,
      betriebe: `id IN (SELECT betrieb_id FROM schueler WHERE id IN (${sIn}))`,
      ausbilder: `betrieb_id IN (SELECT betrieb_id FROM schueler WHERE id IN (${sIn}))`,
      schueler: `id IN (${sIn})`,
      kontrolltermine: `id IN (${tIn2})`,
      kontrolltermin_klassen: `kontrolltermin_id IN (${tIn2})`,
      kontrolltermin_schueler: `schueler_id IN (${sIn})`,
      kontrollergebnisse: `schueler_id IN (${sIn})`,
      kw_status: `schueler_id IN (${sIn})`,
      kw_maengel: `kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id IN (${sIn}))`,
      durchsicht_snapshots: `schueler_id IN (${sIn})`,
      wiedervorlagen: `schueler_id IN (${sIn})`,
      wiedervorlage_notizen: `wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE schueler_id IN (${sIn}))`,
      ausbildungsphasen: `schueler_id IN (${sIn})`,
      schueler_bemerkungen: `schueler_id IN (${sIn})`,
      schueler_dateien: `schueler_id IN (${sIn})`,
      aenderungslog: `schueler_id IN (${sIn})`,
    };
    const lib = SQLlib || App._sqlJsFactory;
    if (!lib) throw new Error('sql.js nicht geladen');
    const adb = new lib.Database();
    const zeilen = {};
    for (const [tab, cond] of Object.entries(bedingungen)) {
      const ddl = App.scalar("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [tab]);
      if (!ddl) continue;
      adb.run(ddl);
      const rows = App.query(`SELECT * FROM ${tab} WHERE ${cond}`);
      zeilen[tab] = rows.length;
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const st = adb.prepare(`INSERT OR IGNORE INTO ${tab} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      adb.run('BEGIN');
      try { rows.forEach(r => st.run(cols.map(c => r[c] === undefined ? null : r[c]))); adb.run('COMMIT'); }
      catch(e) { try { adb.run('ROLLBACK'); } catch(_) {} throw e; }
      st.free();
    }
    adb.run('CREATE TABLE IF NOT EXISTS archiv_info (schluessel TEXT PRIMARY KEY, wert TEXT)');
    const info = { erstellt: new Date().toISOString(), von: App.currentUser || (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '', jahrgaenge: v.jahrgaenge.map(j => j.bezeichnung).join(', '), version: App.VERSION || '', quelle: App.autoLoadedDbName || '' };
    Object.entries(info).forEach(([k, w]) => adb.run('INSERT INTO archiv_info VALUES (?,?)', [k, String(w)]));
    return { db: adb, zeilen, vorschau: v };
  },
  _archivExcel(v) {
    if (typeof XLSX === 'undefined') return null;
    const sIn = v.schuelerIds.length ? v.schuelerIds.join(',') : '0';
    const azubis = App.query(`SELECT s.ibykus_id AS IBYKUS, s.nachname AS Nachname, s.vorname AS Vorname, s.geburtsdatum AS Geburtsdatum, f.bezeichnung AS Fachrichtung,
        j.bezeichnung AS Jahrgang, bs.name AS Berufsschule, b.name AS Betrieb, b.ort AS Betriebsort, s.ausbildungsbeginn AS Beginn, s.ausbildungsende AS Ende, s.status AS Status, s.inaktiv_grund AS Grund, s.zustaendiges_amt AS Amt
      FROM schueler s LEFT JOIN fachrichtungen f ON f.id=s.fachrichtung_id LEFT JOIN abschlussjahrgaenge j ON j.id=s.jahrgang_id
      LEFT JOIN klassen k ON k.id=s.klasse_id LEFT JOIN berufsschulen bs ON bs.id=k.berufsschule_id LEFT JOIN betriebe b ON b.id=s.betrieb_id
      WHERE s.id IN (${sIn}) ORDER BY s.nachname, s.vorname`);
    const ergebnisse = App.query(`SELECT s.nachname AS Nachname, s.vorname AS Vorname, COALESCE(NULLIF(kt.durchgefuehrt_datum,''), kt.geplant_datum) AS Datum, ke.durchsicht_nr AS Durchsicht,
        ke.ergebnis AS Ergebnis, ke.fehltage_gesamt AS Fehltage, ke.zulassung_ap AS AP_Zulassung, ke.pruefer AS Pruefer, ke.bemerkung AS Bemerkung
      FROM kontrollergebnisse ke JOIN schueler s ON s.id=ke.schueler_id LEFT JOIN kontrolltermine kt ON kt.id=ke.kontrolltermin_id
      WHERE ke.schueler_id IN (${sIn}) ORDER BY s.nachname, s.vorname, Datum`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(azubis), 'Azubis');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ergebnisse), 'Ergebnisse');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  },
  async _archivDir() {
    const bhk = App.bhkDirHandle;
    if (!bhk) throw new Error('Kein Datenbank-Ordner');
    return await bhk.getDirectoryHandle(this.ARCHIV_ORDNER, { create: true });
  },
  async _schreibeDatei(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    return fh;
  },
  async _archivSchreiben(jahrgangIds, v) {
    const dir = await this._archivDir();
    const name = this._archivName(v.jahrgaenge);
    const { db: adb, zeilen } = this._archivDbBauen(jahrgangIds);
    const bytes = adb.export();
    adb.close();
    const fh = await this._schreibeDatei(dir, name + '.sqlite', bytes);
    // Gegenlesen: Datei muss sich öffnen lassen und dieselbe Azubi-Zahl enthalten
    const rueck = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    const pdb = new App._sqlJsFactory.Database(rueck);
    const n = pdb.exec('SELECT COUNT(*) FROM schueler')[0].values[0][0];
    pdb.close();
    if (n !== v.azubis) throw new Error(`Archiv unvollständig (${n} von ${v.azubis} Azubis) – Löschen abgebrochen`);
    try { const x = this._archivExcel(v); if (x) await this._schreibeDatei(dir, name + '.xlsx', x); } catch(e) { console.warn('Archiv-Excel:', e); }
    console.log('[DbTools] Archiv geschrieben:', name, zeilen);
    return { name: name + '.sqlite', dirName: name, zeilen };
  },
  // Akten-Dateien der gelöschten Azubis in den Archiv-Ordner verschieben (nach dem Löschen, außerhalb des Bulk-Pfads)
  async _aktenDateienVerschieben(schuelerIds, archivDirName) {
    if (!App.bhkDirHandle || !schuelerIds.length) return 0;
    let src;
    try { src = await App.bhkDirHandle.getDirectoryHandle('dateien', { create: false }); } catch(e) { return 0; }
    let ziel = null, n = 0;
    for (const sid of schuelerIds) {
      let sd;
      try { sd = await src.getDirectoryHandle(String(sid), { create: false }); } catch(e) { continue; }
      try {
        if (!ziel) ziel = await (await (await this._archivDir()).getDirectoryHandle(archivDirName + '_dateien', { create: true }));
        const zd = await ziel.getDirectoryHandle(String(sid), { create: true });
        for await (const [name, h] of sd.entries()) {
          if (h.kind !== 'file') continue;
          const data = await (await h.getFile()).arrayBuffer();
          await this._schreibeDatei(zd, name, data);
          n++;
        }
        await src.removeEntry(String(sid), { recursive: true });
      } catch(e) { console.warn('[DbTools] Akten-Dateien verschieben:', sid, e.message); }
    }
    return n;
  },

  // ── Archiv-Rückholung ──
  async archivListe() {
    const out = [];
    try {
      const dir = await this._archivDir();
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !name.endsWith('.sqlite')) continue;
        try { const f = await h.getFile(); out.push({ name, bytes: f.size, datum: new Date(f.lastModified).toISOString().slice(0, 10) }); } catch(e) {}
      }
    } catch(e) {}
    return out.sort((a, b) => b.name.localeCompare(a.name));
  },
  async _archivOeffnen(name) {
    const dir = await this._archivDir();
    const fh = await dir.getFileHandle(name, { create: false });
    const bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    return new App._sqlJsFactory.Database(bytes);
  },
  _dbRows(adb, sql, params) {
    const st = adb.prepare(sql); st.bind(params || []);
    const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free();
    return rows;
  },
  // Einzelne Azubis aus einer Archiv-DB in die Arbeits-DB zurückholen (regulärer Op-Pfad, IDs bleiben)
  _archivWiederherstellenAus(adb, schuelerIds) {
    const ids = schuelerIds.map(Number).filter(n => n > 0);
    if (!ids.length) return { azubis: 0, zeilen: 0 };
    const sIn = ids.join(',');
    const einfuegen = (tab, rows) => {
      let n = 0;
      rows.forEach(r => {
        const cols = Object.keys(r);
        try { App.run(`INSERT OR IGNORE INTO ${tab} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => r[c])); n++; } catch(e) { console.warn('[DbTools] Rückholung', tab, e.message); }
      });
      return n;
    };
    let zeilen = 0;
    // Stammdaten, die fehlen könnten (gleiche IDs, INSERT OR IGNORE lässt Vorhandenes in Ruhe)
    const s = this._dbRows(adb, `SELECT * FROM schueler WHERE id IN (${sIn})`);
    const jg = [...new Set(s.map(x => x.jahrgang_id).filter(Boolean))];
    const kl = [...new Set(s.map(x => x.klasse_id).filter(Boolean))];
    const bt = [...new Set(s.map(x => x.betrieb_id).filter(Boolean))];
    if (jg.length) zeilen += einfuegen('abschlussjahrgaenge', this._dbRows(adb, `SELECT * FROM abschlussjahrgaenge WHERE id IN (${jg.join(',')})`));
    if (kl.length) {
      const klassen = this._dbRows(adb, `SELECT * FROM klassen WHERE id IN (${kl.join(',')})`);
      const bs = [...new Set(klassen.map(k => k.berufsschule_id).filter(Boolean))];
      if (bs.length) zeilen += einfuegen('berufsschulen', this._dbRows(adb, `SELECT * FROM berufsschulen WHERE id IN (${bs.join(',')})`));
      zeilen += einfuegen('klassen', klassen);
    }
    if (bt.length) zeilen += einfuegen('betriebe', this._dbRows(adb, `SELECT * FROM betriebe WHERE id IN (${bt.join(',')})`));
    const azubis = einfuegen('schueler', s);
    const termine = this._dbRows(adb, `SELECT DISTINCT kt.* FROM kontrolltermine kt JOIN kontrollergebnisse ke ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id IN (${sIn})`);
    zeilen += einfuegen('kontrolltermine', termine);
    for (const tab of ['kontrollergebnisse', 'kw_status', 'durchsicht_snapshots', 'wiedervorlagen', 'ausbildungsphasen', 'schueler_bemerkungen', 'schueler_dateien', 'kontrolltermin_schueler']) {
      zeilen += einfuegen(tab, this._dbRows(adb, `SELECT * FROM ${tab} WHERE schueler_id IN (${sIn})`));
    }
    zeilen += einfuegen('kw_maengel', this._dbRows(adb, `SELECT * FROM kw_maengel WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id IN (${sIn}))`));
    zeilen += einfuegen('wiedervorlage_notizen', this._dbRows(adb, `SELECT * FROM wiedervorlage_notizen WHERE wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE schueler_id IN (${sIn}))`));
    ids.forEach(id => { try { App.logChange(id, 'datensatz', 'archiviert', 'aus Archiv zurückgeholt', 'wiederhergestellt'); } catch(e) {} });
    return { azubis, zeilen };
  },
  async archivAnzeigen(name) {
    let adb;
    try { adb = await this._archivOeffnen(name); } catch(e) { return App.toast('Archiv lässt sich nicht öffnen: ' + e.message, 'error'); }
    const info = Object.fromEntries(this._dbRows(adb, 'SELECT * FROM archiv_info').map(r => [r.schluessel, r.wert]));
    const azubis = this._dbRows(adb, 'SELECT s.id, s.nachname, s.vorname, s.ibykus_id, s.status, (SELECT COUNT(*) FROM kontrollergebnisse ke WHERE ke.schueler_id=s.id) AS n FROM schueler s ORDER BY s.nachname, s.vorname');
    adb.close();
    const vorhanden = new Set(App.query(`SELECT id FROM schueler WHERE id IN (${azubis.map(a => a.id).join(',') || '0'})`).map(r => r.id));
    App.openModal(`Archiv ${esc(name)}`, `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Jahrgang ${esc(info.jahrgaenge || '–')} · erstellt ${esc((info.erstellt || '').slice(0, 10))} von ${esc(info.von || '–')} · ${azubis.length} Azubis</div>
      <div style="max-height:50vh;overflow:auto"><table class="data-table"><thead><tr><th style="width:30px"><input type="checkbox" onchange="document.querySelectorAll('.chk-arch:not(:disabled)').forEach(c=>c.checked=this.checked)"></th><th>Name</th><th>IBYKUS</th><th>Status</th><th>Ergebnisse</th></tr></thead><tbody>
        ${azubis.map(a => `<tr><td><input type="checkbox" class="chk-arch" value="${a.id}" ${vorhanden.has(a.id) ? 'disabled title="bereits in der Datenbank"' : ''}></td><td>${esc(a.nachname)}, ${esc(a.vorname)}${vorhanden.has(a.id) ? ' <span style="font-size:10px;color:var(--clr-text-light)">(vorhanden)</span>' : ''}</td><td>${esc(a.ibykus_id || '')}</td><td>${esc(App.STATUS_LABELS[a.status] || a.status || '')}</td><td>${a.n}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="font-size:11px;color:var(--clr-text-light);margin-top:6px">Zurückgeholte Azubis kommen samt Ergebnissen, Wochendaten, Wiedervorlagen und Bemerkungen zurück (inaktiv, wie archiviert). Akten-Dateien liegen unter _bhk/${esc(this.ARCHIV_ORDNER)}/…_dateien/ und werden nicht automatisch zurückkopiert.</div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-primary" onclick="DbTools.archivWiederherstellen('${esc(name)}')">Ausgewählte zurückholen</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
  },
  async archivWiederherstellen(name) {
    const ids = [...document.querySelectorAll('.chk-arch:checked')].map(c => parseInt(c.value));
    if (!ids.length) return App.toast('Keine Azubis ausgewählt', 'warning');
    if (App.offlineModus || App._netzWeg) return App.toast('Nur bei verbundenem Netzlaufwerk möglich', 'error');
    let adb;
    try { adb = await this._archivOeffnen(name); } catch(e) { return App.toast('Archiv lässt sich nicht öffnen: ' + e.message, 'error'); }
    let r;
    try { r = this._archivWiederherstellenAus(adb, ids); } finally { adb.close(); }
    App.closeModal();
    App.toast(`${r.azubis} Azubis aus dem Archiv zurückgeholt (${r.zeilen} Zeilen)`, 'success');
    try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
    this.renderCard();
  },

  // ─────────────────────────────────────────────
  //  Aufräumen + Neuaufbau
  // ─────────────────────────────────────────────
  AUFRAEUMEN_OPTIONEN: {
    waisen: { label: 'Verwaiste Zeilen (Ergebnisse, Wochendaten, Wiedervorlagen, Notizen ohne Bezug)', standard: true },
    sitzungen: { label: 'Alte Sitzungs-Sperren (älter als 1 Tag)', standard: true },
    klassen: { label: 'Leere Klassen (ohne Azubis und Termine)', standard: true },
    blockplan: { label: 'Blockpläne älter als 2 Schuljahre', standard: true },
    log: { label: 'Änderungslog älter als 24 Monate (Lösch-Logbuch bleibt)', standard: true },
    importDetails: { label: 'Import-Details älter als 12 Monate (Zusammenfassung bleibt)', standard: true },
    stamps: { label: 'Sync-Stempel älter als 90 Tage', standard: true },
    betriebe: { label: 'Betriebe ohne Azubis und Termine (samt Ausbildern)', standard: false },
    papierkorb: { label: 'Papierkorb leeren', standard: false },
  },
  _schuljahrGrenze() {
    const sj = App.schuljahrZu(new Date());
    const y = parseInt(sj) - this.BLOCKPLAN_SCHULJAHRE;
    return `${y}/${y + 1}`;
  },
  _monatsGrenze(monate) { return this._stichtag(monate) + ' 00:00:00'; },
  _stampsAlt() {
    const grenze = Date.now() - this.STAMPS_TAGE * 86400000;
    let n = 0;
    if (App._rowStamps) for (const [, v] of App._rowStamps) { if (Object.values(v).every(x => (x.ts || 0) < grenze)) n++; }
    return n;
  },
  WAISEN: [
    ['kontrollergebnisse', 'schueler_id NOT IN (SELECT id FROM schueler) OR kontrolltermin_id NOT IN (SELECT id FROM kontrolltermine)'],
    ['kw_status', 'schueler_id NOT IN (SELECT id FROM schueler)'],
    ['kw_maengel', 'kontrollergebnis_id NOT IN (SELECT id FROM kontrollergebnisse)'],
    ['durchsicht_snapshots', 'schueler_id NOT IN (SELECT id FROM schueler) OR kontrollergebnis_id NOT IN (SELECT id FROM kontrollergebnisse)'],
    ['wiedervorlagen', 'schueler_id NOT IN (SELECT id FROM schueler)'],
    ['wiedervorlage_notizen', 'wiedervorlage_id NOT IN (SELECT id FROM wiedervorlagen)'],
    ['kontrolltermin_schueler', 'kontrolltermin_id NOT IN (SELECT id FROM kontrolltermine) OR schueler_id NOT IN (SELECT id FROM schueler)'],
    ['kontrolltermin_klassen', 'kontrolltermin_id NOT IN (SELECT id FROM kontrolltermine) OR klasse_id NOT IN (SELECT id FROM klassen)'],
    ['ausbildungsphasen', 'schueler_id NOT IN (SELECT id FROM schueler)'],
    ['schueler_bemerkungen', 'schueler_id NOT IN (SELECT id FROM schueler)'],
    ['schueler_dateien', 'schueler_id NOT IN (SELECT id FROM schueler)'],
    ['ausbilder', 'betrieb_id NOT IN (SELECT id FROM betriebe)'],
  ],
  aufraeumenVorschau(opts) {
    const o = Object.assign(Object.fromEntries(Object.entries(this.AUFRAEUMEN_OPTIONEN).map(([k, v]) => [k, v.standard])), opts || {});
    const q = (sql) => this._count(sql);
    const v = { optionen: o, posten: [] };
    const add = (key, label, n) => { if (o[key]) v.posten.push({ key, label, n }); };
    if (o.waisen) add('waisen', 'Verwaiste Zeilen', this.WAISEN.reduce((a, [t, c]) => a + q(`SELECT COUNT(*) FROM ${t} WHERE ${c}`), 0));
    add('sitzungen', 'Alte Sitzungs-Sperren', q(`SELECT COUNT(*) FROM aktive_sitzung WHERE seit < datetime('now','localtime','-1 day')`));
    add('klassen', 'Leere Klassen', q(`SELECT COUNT(*) FROM klassen k WHERE NOT EXISTS (SELECT 1 FROM schueler s WHERE s.klasse_id=k.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermine t WHERE t.klasse_id=k.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermin_klassen tk WHERE tk.klasse_id=k.id)`));
    add('blockplan', `Blockplan-Wochen vor ${this._schuljahrGrenze()}`, q(`SELECT COUNT(*) FROM blockplan WHERE schuljahr < '${this._schuljahrGrenze()}'`));
    add('log', 'Änderungslog-Zeilen', q(`SELECT COUNT(*) FROM aenderungslog WHERE zeitpunkt < '${this._monatsGrenze(this.LOG_MONATE_STANDARD)}' AND aktion != 'geloescht'`));
    add('importDetails', 'Import-Detaillisten', q(`SELECT COUNT(*) FROM import_historie WHERE zeitpunkt < '${this._monatsGrenze(this.IMPORT_DETAILS_MONATE)}' AND details_json != '[]' AND details_json != ''`));
    add('stamps', 'Sync-Stempel', this._stampsAlt());
    add('betriebe', 'Betriebe ohne Bezug', q(`SELECT COUNT(*) FROM betriebe b WHERE NOT EXISTS (SELECT 1 FROM schueler s WHERE s.betrieb_id=b.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermine t WHERE t.betrieb_id=b.id)`));
    add('papierkorb', 'Papierkorb-Einträge', q('SELECT COUNT(*) FROM bhk_papierkorb'));
    v.gesamt = v.posten.reduce((a, p) => a + p.n, 0);
    return v;
  },
  // Reiner DB-Teil (ohne VACUUM/Speichern)
  _aufraeumenAusfuehren(opts) {
    const v = this.aufraeumenVorschau(opts);
    const o = v.optionen;
    const r = {};
    const del = (key, sql) => { try { App.run(sql); r[key] = (r[key] || 0) + (App.db.getRowsModified ? App.db.getRowsModified() : 0); } catch(e) { console.warn('[DbTools] Aufräumen', key, e.message); } };
    if (o.waisen) this.WAISEN.forEach(([t, c]) => del('waisen', `DELETE FROM ${t} WHERE ${c}`));
    if (o.sitzungen) del('sitzungen', `DELETE FROM aktive_sitzung WHERE seit < datetime('now','localtime','-1 day')`);
    if (o.klassen) App.query(`SELECT id FROM klassen k WHERE NOT EXISTS (SELECT 1 FROM schueler s WHERE s.klasse_id=k.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermine t WHERE t.klasse_id=k.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermin_klassen tk WHERE tk.klasse_id=k.id)`).forEach(k => { App.deleteKlasseKaskade(k.id); r.klassen = (r.klassen || 0) + 1; });
    if (o.blockplan) del('blockplan', `DELETE FROM blockplan WHERE schuljahr < '${this._schuljahrGrenze()}'`);
    if (o.log) del('log', `DELETE FROM aenderungslog WHERE zeitpunkt < '${this._monatsGrenze(this.LOG_MONATE_STANDARD)}' AND aktion != 'geloescht'`);
    if (o.importDetails) del('importDetails', `UPDATE import_historie SET details_json='[]' WHERE zeitpunkt < '${this._monatsGrenze(this.IMPORT_DETAILS_MONATE)}' AND details_json != '[]' AND details_json != ''`);
    if (o.stamps && App._rowStamps) {
      const grenze = Date.now() - this.STAMPS_TAGE * 86400000;
      let n = 0;
      for (const [k, val] of [...App._rowStamps]) { if (Object.values(val).every(x => (x.ts || 0) < grenze)) { App._rowStamps.delete(k); n++; } }
      r.stamps = n;
    }
    if (o.betriebe) App.query(`SELECT id FROM betriebe b WHERE NOT EXISTS (SELECT 1 FROM schueler s WHERE s.betrieb_id=b.id) AND NOT EXISTS (SELECT 1 FROM kontrolltermine t WHERE t.betrieb_id=b.id)`).forEach(b => { App.deleteBetriebKaskade(b.id); r.betriebe = (r.betriebe || 0) + 1; });
    if (o.papierkorb) { r.papierkorb = this._count('SELECT COUNT(*) FROM bhk_papierkorb'); App.papierkorbLeeren(); }
    try { App.run("DELETE FROM bhk_tombstones WHERE geloescht_am < datetime('now','localtime','-60 days')"); } catch(e) {}
    try { App.run('DELETE FROM bhk_applied_ops WHERE rowid NOT IN (SELECT rowid FROM bhk_applied_ops ORDER BY rowid DESC LIMIT 5000)'); } catch(e) {}
    return r;
  },
  _optionenAusFormular() {
    const o = {};
    Object.keys(this.AUFRAEUMEN_OPTIONEN).forEach(k => { const el = document.getElementById('dbt_' + k); o[k] = el ? !!el.checked : this.AUFRAEUMEN_OPTIONEN[k].standard; });
    return o;
  },
  vorschauAnzeigen() {
    const v = this.aufraeumenVorschau(this._optionenAusFormular());
    this._letzteVorschau = v;
    const box = document.getElementById('dbtVorschau');
    if (box) box.innerHTML = `<table class="data-table" style="max-width:520px"><tbody>${v.posten.map(p => `<tr><td>${esc(p.label)}</td><td style="text-align:right"><strong>${p.n}</strong></td></tr>`).join('')}
      <tr><td><strong>Gesamt</strong></td><td style="text-align:right"><strong>${v.gesamt}</strong></td></tr></tbody></table>
      <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">Anschließend wird die Datei neu aufgebaut (VACUUM) – erst das macht sie kleiner.</div>`;
  },
  async aufraeumen(nurNeuaufbau) {
    const o = nurNeuaufbau ? Object.fromEntries(Object.keys(this.AUFRAEUMEN_OPTIONEN).map(k => [k, false])) : this._optionenAusFormular();
    const v = this.aufraeumenVorschau(o);
    const ok = await this._bestaetigen(nurNeuaufbau
      ? 'Datei neu aufbauen (VACUUM) und als neuen Snapshot schreiben?\n\nEs werden keine Daten gelöscht. Alle anderen Nutzer laden den neuen Stand beim nächsten Abgleich.'
      : `Aufräumen ausführen?\n\n${v.posten.map(p => `${p.label}: ${p.n}`).join('\n')}\n\nDanach wird die Datei neu aufgebaut.`, nurNeuaufbau ? 'Neu aufbauen' : 'Aufräumen');
    if (!ok) return;
    await this._ausfuehren('aufraeumen', () => {
      const r = nurNeuaufbau ? {} : this._aufraeumenAusfuehren(o);
      const n = Object.values(r).reduce((a, b) => a + b, 0);
      return nurNeuaufbau ? 'Datei neu aufgebaut' : `${n} Zeilen bereinigt, Datei neu aufgebaut`;
    });
  },

  // ─────────────────────────────────────────────
  //  Gemeinsamer Ablauf: Wächter → Backup → Bulk → VACUUM → Snapshot
  // ─────────────────────────────────────────────
  _sperrgrund() {
    if (!App.db) return 'Keine Datenbank geladen';
    if (App._tabIsPrimary === false) return 'Diese Registerkarte ist eine Zweit-Registerkarte dieser Datenbank und kann keinen Snapshot schreiben – bitte alle anderen Tabs/Fenster mit dieser Datenbank schließen und die Seite neu laden';
    if (App.offlineModus) return 'Im Offline-Modus nicht möglich – erst wiederverbinden';
    if (App._netzWeg) return 'Netzlaufwerk nicht erreichbar';
    if (App._bulkPending) return 'Ein Import ist noch nicht gespeichert – bitte warten';
    if (App.dbFileHandle && App._v3Active && App._v3Active() && !App._v3Ready) return 'Synchronisation noch nicht bereit';
    return '';
  },
  async _andereClientsAktiv(minuten) {
    const out = [];
    try {
      const dir = App._syncDirV3 ? App._syncDirV3() : null;
      if (!dir) return out;
      const prefix = App._oplogPrefix();
      const eigen = prefix + App._getClientId() + '_g';
      const grenze = Date.now() - (minuten || this.ANDERE_AKTIV_MINUTEN) * 60000;
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file') continue;
        if (name.startsWith(prefix) && name.endsWith('.jsonl') && !name.startsWith(eigen)) {
          try { const f = await h.getFile(); if (f.lastModified > grenze) out.push({ art: 'log', name, vor: Math.round((Date.now() - f.lastModified) / 60000) }); } catch(e) {}
        } else if (name.startsWith('pos-') && name.endsWith('.json')) {
          try { const d = JSON.parse(await (await h.getFile()).text()); if (d.ts > grenze && d.p !== (typeof KontrolleHandler !== 'undefined' ? KontrolleHandler.activePruefer : '')) out.push({ art: 'pos', name: d.p, vor: Math.round((Date.now() - d.ts) / 60000) }); } catch(e) {}
        }
      }
    } catch(e) {}
    return out;
  },
  async _bestaetigen(text, titel) {
    const grund = this._sperrgrund();
    if (grund) { App.toast(grund, 'error'); return false; }
    const andere = await this._andereClientsAktiv();
    if (andere.length) text += `\n\nACHTUNG: ${andere.length} andere Nutzer waren in den letzten ${this.ANDERE_AKTIV_MINUTEN} Minuten aktiv (${andere.map(a => a.art === 'pos' ? a.name : 'Rechner ' + a.name.replace(/^.*_([^_]+)_g\d+\.jsonl$/, '$1')).join(', ')}). Sie übernehmen den neuen Stand beim nächsten Abgleich; laufende Eingaben an gelöschten Daten gehen verloren.`;
    return App.confirm(text, { titel: titel || 'Datenbank-Tools', ok: titel || 'Ausführen', gefaehrlich: true });
  },
  WARTE_SCHRITT_MS: 2000,
  WARTE_MAX: 90,          // 90 × 2 s = 3 Minuten auf eine laufende Kompaktierung
  SAVE_VERSUCHE: 8,
  SAVE_PAUSE_MS: 15000,   // 8 × 15 s = 2 Minuten, falls das Lock belegt ist
  _ausstehend: null,
  async _ausfuehren(art, arbeit, opts) {
    const grund = this._sperrgrund();
    if (grund) return App.toast(grund, 'error');
    if (this._laeuft) return App.toast('Es läuft bereits eine Bereinigung', 'warning');
    if (this._ausstehend) return App.toast('Die letzte Bereinigung ist noch nicht gespeichert – bitte warten, bis sie nachgeholt wurde', 'warning');
    this._laeuft = true;
    App._dbToolsAktiv = true; // automatische Start-/Größen-Kompaktierung solange aussetzen
    let meldung = '';
    try {
      // Läuft gerade eine Kompaktierung (z.B. die eigene nach dem Start oder
      // die eines Kollegen)? Dann warten – VOR jeder Änderung. Sonst gäbe es
      // einen Löschstand nur im Speicher, der nicht sofort gesichert werden kann.
      if (App._compactInProgress) {
        App.showLoading('Warte auf laufende Kompaktierung…');
        for (let i = 0; i < this.WARTE_MAX && App._compactInProgress; i++) await new Promise(r => setTimeout(r, this.WARTE_SCHRITT_MS));
        if (App._compactInProgress) { App.toast('Eine Kompaktierung läuft noch (langsames Netz) – bitte in ein paar Minuten erneut versuchen. Es wurde nichts geändert.', 'warning'); return; }
      }
      const vorher = App.db.export().length;
      App.showLoading('Sicherung wird angelegt…');
      if (App.dbFileHandle) { try { await App.createBackup('vor-' + art); } catch(e) { console.warn('Backup:', e); } }
      App.showLoading('Bereinigung läuft…');
      if (App.autoSaveTimer) clearTimeout(App.autoSaveTimer);
      App._bulkImport = true;
      try { meldung = arbeit() || 'Fertig'; }
      finally { App._bulkImport = false; }
      try { App.db.run('VACUUM'); } catch(e) { console.warn('[DbTools] VACUUM:', e.message); }
      const nachher = App.db.export().length;
      this._letzterLauf = { art, meldung, vorher, nachher, zeit: new Date().toISOString() };
      if (App.dbFileHandle) {
        App.showLoading('Neuer Snapshot wird geschrieben…');
        try {
          await App.fullSave({ versuche: this.SAVE_VERSUCHE, pause: this.SAVE_PAUSE_MS, grund: 'bereinigung', label: 'Bereinigung' });
        } catch(e) {
          // Stand ist im Speicher, fullSave hat _bulkPending gesetzt – der
          // Abgleich holt die Kompaktierung automatisch nach. Nacharbeit
          // (Dateien verschieben) erst nach erfolgreichem Speichern.
          console.warn('[DbTools] Speichern verschoben:', e.message);
          this._ausstehend = { art, meldung, vorher, nachher, nachherFn: opts && opts.nachher, seit: Date.now() };
          this._letzterLauf.ausstehend = true;
          this._ausstehendStarten();
          App.toast(`${meldung} – Speichern noch nicht möglich (Kompaktierung belegt). Wird automatisch nachgeholt, bitte das Fenster NICHT schließen.`, 'error');
          return;
        }
      }
      if (opts && opts.nachher) { App.showLoading('Dateien werden verschoben…'); try { await opts.nachher(); } catch(e) { console.warn('[DbTools] Nacharbeit:', e); } }
      App.toast(`${meldung} · Datei ${this._bytes(vorher)} → ${this._bytes(nachher)}`, 'success');
    } catch(e) {
      console.error('[DbTools]', e);
      App.toast('Bereinigung: ' + e.message, 'error');
    } finally {
      this._laeuft = false;
      App._dbToolsAktiv = false;
      App.hideLoading();
      try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
      try { if (typeof UndoManager !== 'undefined' && UndoManager.clear) UndoManager.clear(); } catch(e) {}
      try { this.renderCard(); } catch(e) { console.warn('[DbTools] Karte:', e); }
    }
  },
  // Nachholung beobachten: sobald der Abgleich die Kompaktierung geschafft hat
  // (_bulkPending wieder false), Nacharbeit ausführen und melden.
  _ausstehendStarten() {
    if (this._ausstehendTimer) return;
    this._ausstehendTimer = setInterval(() => { this._ausstehendPruefen(); }, 10000);
  },
  async _ausstehendPruefen() {
    const a = this._ausstehend;
    if (!a) { if (this._ausstehendTimer) { clearInterval(this._ausstehendTimer); this._ausstehendTimer = null; } return false; }
    if (App._bulkPending) return false;
    if (this._ausstehendTimer) { clearInterval(this._ausstehendTimer); this._ausstehendTimer = null; }
    this._ausstehend = null;
    if (a.nachherFn) { try { await a.nachherFn(); } catch(e) { console.warn('[DbTools] Nacharbeit:', e); } }
    if (this._letzterLauf) delete this._letzterLauf.ausstehend;
    App.toast(`${a.meldung} · jetzt gespeichert · Datei ${this._bytes(a.vorher)} → ${this._bytes(a.nachher)}`, 'success');
    this.renderCard();
    return true;
  },

  // ─────────────────────────────────────────────
  //  Sperre prüfen / freigeben (wenn die Nachholung hängt)
  // ─────────────────────────────────────────────
  async _sperreLesen(dir) {
    dir = dir || App._syncDirV3();
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle(App._lockName(), { create: false });
      const f = await fh.getFile();
      const text = (await f.text()).trim();
      if (!text) return { frei: true, alterS: 0 };
      const lock = JSON.parse(text);
      const alterS = Math.round((Date.now() - Math.max(new Date(lock.t || 0).getTime() || 0, f.lastModified || 0)) / 1000);
      return { frei: false, von: lock.u || '?', t: lock.t || '', alterS };
    } catch(e) { return { frei: true, alterS: 0 }; }
  },
  async _sperreEntfernen(dir) {
    dir = dir || App._syncDirV3();
    const fh = await dir.getFileHandle(App._lockName(), { create: true });
    const w = await fh.createWritable();
    await w.write('');
    await w.close();
    return true;
  },
  async sperreDialog() {
    if (App._tabIsPrimary === false) return App.toast(this._sperrgrund(), 'error');
    const s = await this._sperreLesen();
    const grund = App._compactGrund || '';
    App.openModal('Kompaktierungs-Sperre', `
      <div style="font-size:13px;line-height:1.7">
        <div>Letzter Grund: <strong>${esc(grund || '–')}</strong></div>
        <div>Sperrdatei <code>${esc(App._lockName())}</code>: ${!s ? 'nicht lesbar' : s.frei ? '<span style="color:var(--clr-green)">frei</span>' : `belegt von <strong>${esc(s.von)}</strong> seit ${s.alterS} s`}</div>
        <div style="font-size:12px;color:var(--clr-text-light);margin-top:8px">Eine Sperre älter als 150 s gilt automatisch als verwaist und wird beim nächsten Versuch übernommen. Nur wenn die Nachholung trotzdem minutenlang hängt und sicher kein Kollege gerade kompaktiert (Kopfzeile „online“), die Sperre von Hand freigeben.</div>
        <div style="font-size:12px;color:var(--clr-text-light);margin-top:4px">Gerade online: ${esc(App.onlineNutzerText ? (App.onlineNutzerText() || 'niemand sonst') : '–')}</div>
      </div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-secondary" onclick="App._nachholenBulk().then(ok=>App.toast(ok?'Gespeichert':'Weiterhin nicht möglich: '+(App._compactGrund||'?'),ok?'success':'warning'))">Jetzt erneut versuchen</button>
       ${s && !s.frei ? `<button class="btn btn-primary" style="background:var(--clr-red);border-color:var(--clr-red)" onclick="DbTools.sperreFreigeben()">Sperre freigeben</button>` : ''}`);
  },
  async sperreFreigeben() {
    const ok = await App.confirm('Sperre wirklich freigeben?\n\nWenn ein Kollege gerade kompaktiert, können sich zwei Snapshots überschreiben. Nur ausführen, wenn niemand sonst online ist oder die Sperre offensichtlich verwaist ist.', { titel: 'Sperre freigeben', ok: 'Freigeben', gefaehrlich: true });
    if (!ok) return;
    try { await this._sperreEntfernen(); } catch(e) { return App.toast('Sperre konnte nicht freigegeben werden: ' + e.message, 'error'); }
    App.closeModal();
    App.toast('Sperre freigegeben – Speichern wird erneut versucht', 'success');
    try { const r = await App._nachholenBulk(); if (r) App.toast('Gespeichert', 'success'); } catch(e) {}
    this.renderCard();
  },

  // ─────────────────────────────────────────────
  //  Karte in den Einstellungen
  // ─────────────────────────────────────────────
  cardHtml() {
    return `<div class="card" style="margin-top:16px" id="dbToolsCard">
      <div class="card-header">🧹 Datenbank-Tools (Bestand, Ausmisten, Aufräumen)</div>
      <div id="dbToolsBox"><div style="font-size:12px;color:var(--clr-text-light)">Wird geladen…</div></div>
    </div>`;
  },
  renderCard() {
    const box = document.getElementById('dbToolsBox');
    if (!box || !App.db) return;
    if (App.uGet && App.uGet('rolle') === 'assistenz') { box.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light)">Die Datenbank-Tools stehen nur im Rollenprofil „Ausbildungsberater" zur Verfügung.</div>'; return; }
    const b = this.bestand();
    const gross = b.tabellen.filter(t => t.zeilen > 0).sort((x, y) => y.zeilen - x.zeilen);
    const monate = parseInt(document.getElementById('dbtMonate')?.value) || this.VERDICHTEN_MONATE_STANDARD;
    const lauf = this._ausstehend ? `<div style="font-size:12px;color:var(--clr-red);margin-top:4px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius)">⏳ ${esc(this._ausstehend.meldung)} – <strong>noch nicht gespeichert</strong>, wird automatisch nachgeholt. Bitte das Fenster nicht schließen.${App._compactGrund ? `<br>Grund: ${esc(App._compactGrund)}` : ''} <button class="btn btn-sm btn-secondary" style="margin-left:6px" onclick="DbTools.sperreDialog()">Sperre prüfen</button></div>`
      : this._letzterLauf ? `<div style="font-size:11px;color:var(--clr-forest);margin-top:4px">Letzter Lauf: ${esc(this._letzterLauf.meldung)} · ${this._bytes(this._letzterLauf.vorher)} → ${this._bytes(this._letzterLauf.nachher)}</div>` : '';
    box.innerHTML = `
      <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
        Die Datenbank wird beim Start komplett geladen und bei jeder Kompaktierung und jedem Backup komplett geschrieben – über VPN zählt jedes Megabyte.
        Alle Werkzeuge hier: Vorschau mit Zahlen, automatisches Backup, Ausführung als neuer Snapshot für alle Nutzer, danach Neuaufbau der Datei.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">
        <div style="padding:8px 10px;background:var(--clr-warm);border-radius:var(--radius)"><div style="font-size:11px;color:var(--clr-text-light)">Datei</div><div style="font-size:18px;font-weight:700">${this._bytes(b.dateiBytes)}</div><div style="font-size:11px;color:var(--clr-text-light)">Speicher ${this._bytes(b.speicherBytes)}${b.freiBytes ? ` · ${this._bytes(b.freiBytes)} frei` : ''}</div></div>
        <div style="padding:8px 10px;background:var(--clr-warm);border-radius:var(--radius)"><div style="font-size:11px;color:var(--clr-text-light)">Azubis</div><div style="font-size:18px;font-weight:700">${b.azubis.aktiv} <span style="font-size:12px;font-weight:400">aktiv</span></div><div style="font-size:11px;color:var(--clr-text-light)">${b.azubis.inaktiv} inaktiv</div></div>
        <div style="padding:8px 10px;background:var(--clr-warm);border-radius:var(--radius)"><div style="font-size:11px;color:var(--clr-text-light)">Größte Tabellen</div><div style="font-size:11px;line-height:1.5">${gross.slice(0, 4).map(t => `${esc(t.label)}: <strong>${t.zeilen}</strong>`).join('<br>')}</div></div>
      </div>
      <details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:12px;color:var(--clr-text-light)">Alle Tabellen</summary>
        <div style="columns:2;font-size:11px;margin-top:4px">${b.tabellen.map(t => `<div>${esc(t.label)}: ${t.zeilen}</div>`).join('')}</div></details>
      ${lauf}

      <h4 style="font-size:13px;margin:12px 0 6px">1 · Jahrgänge ausmisten</h4>
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:6px">
        <strong>Verdichten</strong> entfernt nur die Wochendaten inaktiver Azubis (KW-Raster, Snapshots), Ergebnisse und Statistik bleiben.
        <strong>Löschen</strong> entfernt den ganzen Jahrgang – vorher wird ein Archiv (SQLite + Excel) nach <code>_bhk/${esc(this.ARCHIV_ORDNER)}/</code> geschrieben, aus dem einzelne Azubis zurückholbar sind.
      </div>
      <div style="max-height:260px;overflow:auto"><table class="data-table" id="dbtJahrgaenge"><thead><tr>
        <th style="width:26px"><input type="checkbox" onchange="document.querySelectorAll('.chk-dbtjg:not(:disabled)').forEach(c=>c.checked=this.checked)"></th>
        <th>Jahrgang</th><th>aktiv</th><th>inaktiv</th><th>letzter Termin</th><th>Ergebnisse</th><th>Wochenzeilen</th><th>Snapshots</th><th>WV offen</th></tr></thead><tbody>
        ${b.jahrgaenge.map(j => `<tr style="${j.abgeschlossen ? '' : 'opacity:0.75'}">
          <td><input type="checkbox" class="chk-dbtjg" value="${j.id}" ${j.id && j.abgeschlossen ? '' : 'disabled'} title="${j.id ? (j.abgeschlossen ? '' : 'noch aktive Azubis') : 'ohne Jahrgang – nicht löschbar'}"></td>
          <td><strong>${esc(j.bezeichnung)}</strong></td><td>${j.aktiv}</td><td>${j.inaktiv}</td><td>${j.letzter_termin ? esc(formatDate(j.letzter_termin)) : '–'}</td><td>${j.ergebnisse}</td><td>${j.kw_zeilen}</td><td>${j.snapshots}</td><td>${j.wv_offen || ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <label style="font-size:12px">Verdichten: inaktiv seit mindestens <input type="number" id="dbtMonate" min="1" max="120" value="${monate}" style="width:56px" class="form-control" onchange="DbTools.renderCard()"> Monaten</label>
        <button class="btn btn-secondary btn-sm" onclick="DbTools.verdichten(document.getElementById('dbtMonate').value, DbTools._ausgewaehlteJahrgaenge())" title="Wochendaten inaktiver Azubis entfernen (alle Jahrgänge, wenn keiner angehakt ist)">Verdichten</button>
        <button class="btn btn-secondary btn-sm" onclick="DbTools.verdichtenZeigen()" title="Wie viele Azubis und Zeilen wären betroffen?">Wie viele?</button>
        <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="DbTools.jahrgaengeLoeschen(DbTools._ausgewaehlteJahrgaenge())">Ausgewählte Jahrgänge mit Archiv löschen</button>
      </div>

      <h4 style="font-size:13px;margin:14px 0 6px">2 · Aufräumen und Datei neu aufbauen</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:2px 12px;font-size:12px">
        ${Object.entries(this.AUFRAEUMEN_OPTIONEN).map(([k, o]) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="dbt_${k}" ${o.standard ? 'checked' : ''} style="accent-color:var(--clr-forest)">${esc(o.label)}</label>`).join('')}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-secondary btn-sm" onclick="DbTools.vorschauAnzeigen()">Vorschau</button>
        <button class="btn btn-primary btn-sm" onclick="DbTools.aufraeumen(false)">Aufräumen + neu aufbauen</button>
        <button class="btn btn-secondary btn-sm" onclick="DbTools.aufraeumen(true)" title="Nur VACUUM: Freiraum aus der Datei entfernen, nichts löschen">Nur Datei neu aufbauen</button>
      </div>
      <div id="dbtVorschau" style="margin-top:6px"></div>

      <h4 style="font-size:13px;margin:14px 0 6px">3 · Stammdaten heilen</h4>
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:6px">Abweichende Schreibweisen aus dem IBYKUS-Export (Schulname geändert, Betrieb doppelt, Jahrgang „S 2026“ statt „S2026“) zusammenführen. Der alte Name bleibt als Alias und wird beim nächsten Import automatisch zugeordnet; die Import-Vorschau warnt vor neuen Einträgen, die vorhandenen ähneln.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${['schule', 'betrieb', 'jahrgang'].map(art => { const al = App.aliasListe(art).length; return `<button class="btn btn-sm btn-secondary" onclick="StammdatenTab.dubletten('${art}')">${esc(App.ALIAS_ARTEN[art].label)} prüfen${al ? ` · ${al} Alias(e)` : ''}</button>`; }).join('')}
      </div>

      <h4 style="font-size:13px;margin:14px 0 6px">4 · Archive</h4>
      <div id="dbtArchive" style="font-size:12px;color:var(--clr-text-light)">Archive werden gelesen…</div>`;
    this._archiveRendern();
  },
  verdichtenZeigen() {
    const monate = parseInt(document.getElementById('dbtMonate')?.value) || this.VERDICHTEN_MONATE_STANDARD;
    const v = this.verdichtenVorschau(monate, this._ausgewaehlteJahrgaenge());
    App.toast(v.azubis
      ? `${v.azubis} Azubis mit ${v.kwZeilen} Wochenzeilen, ${v.maengel} KW-Mängeln und ${v.snapshots} Snapshots (letzte Aktivität vor ${v.stichtag})`
      : 'Keine Kandidaten zum Verdichten', v.azubis ? 'info' : 'success');
  },
  _ausgewaehlteJahrgaenge() { return [...document.querySelectorAll('.chk-dbtjg:checked')].map(c => parseInt(c.value)).filter(n => n > 0); },
  async _archiveRendern() {
    const box = document.getElementById('dbtArchive');
    if (!box) return;
    if (!App.bhkDirHandle) { box.innerHTML = 'Archive sind nur bei verbundenem Datenbank-Ordner verfügbar.'; return; }
    const liste = await this.archivListe();
    if (!document.getElementById('dbtArchive')) return;
    box.innerHTML = liste.length
      ? `<table class="data-table" style="max-width:640px"><tbody>${liste.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.datum)}</td><td>${this._bytes(a.bytes)}</td><td><button class="btn btn-sm btn-secondary" onclick="DbTools.archivAnzeigen('${esc(a.name)}')">Azubis anzeigen / zurückholen</button></td></tr>`).join('')}</tbody></table>`
      : `Noch keine Archive in _bhk/${esc(this.ARCHIV_ORDNER)}/.`;
  },
};
