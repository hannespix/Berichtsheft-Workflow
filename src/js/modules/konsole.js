// ══════════════════════════════════════════════════════════════
//  KONSOLE: Diagnosebefehle für die Browser-Konsole (F12 → Konsole)
//
//  Ziel: Netz- und Mehrbenutzerprobleme am Arbeitsplatz nachvollziehen,
//  ohne Programmcode zu lesen. Alles hängt am globalen Objekt `bhk`:
//    bhk.hilfe()      Übersicht der Befehle
//    bhk.status()     Zustand von Verbindung, Synchronisation, Präsenz
//    bhk.spur()       Ereignisspur (BhkSpur) als Tabelle
//    bhk.test()       Verbindungstest mit Schreibprobe und Uhrversatz
//    bhk.kopieren()   Zustandsbild in die Zwischenablage (Weitergabe an die Entwicklung)
//    bhk.dateien()    Inhalt von _bhk/ mit Größe und Alter
//  Die Befehle lesen nur; einzig der Verbindungstest schreibt eine kleine
//  Probedatei und löscht sie wieder. Nichts davon landet in der Datenbank.
// ══════════════════════════════════════════════════════════════

const Konsole = {
  BEFEHLE: [
    ['bhk.hilfe()', 'diese Übersicht'],
    ['bhk.status()', 'Verbindung, Synchronisation, Präsenz und Zähler je Bereich'],
    ['bhk.spur(bereich, n)', 'Ereignisspur, letzte n Einträge (Standard 40); Bereich z.B. "anhaengen", "abgleich", "kompakt", "netz", "takt", "fenster"'],
    ['bhk.dateien()', 'Inhalt von _bhk/ mit Größe und Alter (liest das Netzlaufwerk)'],
    ['bhk.protokolle()', 'Protokolle dieser Datenbank je Rechner: Person, Größe, Alter, hier ungelesen (auch als Fenster unter Wartung → Verbindung)'],
    ['bhk.test()', 'Verbindungstest: Auflisten, Lesen, Schreibprobe, Uhrversatz, Lebenszeichen'],
    ['bhk.jetzt()', 'Abgleich sofort ausführen'],
    ['bhk.pruefen(azubiId)', 'Prüfung je Azubi: lokale Wochen und Ergebnisse, Ops in allen Protokollen und welche dieser Rechner nie angewendet hat'],
    ['bhk.vollabgleich()', 'Alle Protokolle ab dem Snapshot-Stand neu einlesen (heilt verlorene Lesestände; Neueres bleibt erhalten)'],
    ['bhk.ausschreiben(terminId, azubiId?)', 'Stand DIESES Rechners (Durchsicht eines Termins oder eines Azubis) als neueste Änderung ins Protokoll schreiben – alle Kollegen übernehmen ihn'],
    ['bhk.kopieren()', 'Zustandsbild samt Spur und Protokoll in die Zwischenablage (zur Weitergabe an die Entwicklung)'],
    ['bhk.debug(true)', 'jeden Netzvorgang sofort in der Konsole zeigen (bleibt bis bhk.debug(false))'],
  ],
  PROBE_PREFIX: 'probe_',
  _tabelle(zeilen) { try { if (console.table) console.table(zeilen); else console.log(zeilen); } catch(e) { console.log(zeilen); } },
  _zeit(t) { return t ? new Date(t).toLocaleTimeString('de-DE') : ''; },
  _alter(t) {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
  },

  hilfe() {
    console.log('%cBerichtsheftkontrolle – Diagnosebefehle', 'font-weight:bold');
    this._tabelle(this.BEFEHLE.map(([b, w]) => ({ Befehl: b, Wirkung: w })));
    console.log('Tipp: In den Konsolen-Einstellungen „Protokoll beibehalten" einschalten, damit die Meldungen ein Neuladen überleben. Mit Rechtsklick → „Speichern unter…" lässt sich die ganze Konsole als Datei sichern.');
    return this.BEFEHLE.map(b => b[0]);
  },

  // ── Zustand ──
  status() {
    const d = App.diagnose();
    const zeilen = [];
    Object.entries(d).forEach(([gruppe, werte]) => {
      if (gruppe === 'datenbank' || gruppe === 'programm') return;
      Object.entries(werte).forEach(([k, v]) => zeilen.push({ Bereich: gruppe, Angabe: k, Wert: v === '' ? '–' : v }));
    });
    zeilen.push({ Bereich: 'sync', Angabe: 'anhaengenLaeuft', Wert: !!App._appendInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'kompaktierungLaeuft', Wert: !!App._compactInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'speichernLaeuft', Wert: !!App._mergeInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'eigenesProtokoll', Wert: App._myOplogName ? `${App._myOplogName()} (${Math.round((App._myLogSize || 0) / 1024)} KB)` : '–' });
    console.log('%cZustand', 'font-weight:bold');
    this._tabelle(zeilen);
    const z = typeof BhkSpur !== 'undefined' ? BhkSpur.zusammenfassung() : [];
    if (z.length) { console.log('%cNetz- und Dateivorgänge je Bereich', 'font-weight:bold'); this._tabelle(z); }
    return { zustand: d, bereiche: z };
  },

  spur(bereich, n) {
    if (typeof bereich === 'number') { n = bereich; bereich = ''; }
    const l = BhkSpur.liste(bereich || null, n || 40);
    if (!l.length) { console.log('Keine Einträge' + (bereich ? ' für „' + bereich + '“' : '') + '.'); return []; }
    this._tabelle(l.map(e => ({ Zeit: this._zeit(e.t), Bereich: e.kat, Vorgang: e.was, ms: e.ms == null ? '' : e.ms, OK: e.ok ? '✓' : '✗', Art: e.art || '', Info: e.ok ? (e.info || '') : `${e.fehler || ''}${e.info ? ' (' + e.info + ')' : ''}` })));
    return l;
  },

  // ── Netzlaufwerk ──
  async dateien() {
    const dir = App._syncDirV3 ? App._syncDirV3() : null;
    if (!dir) { console.log('Kein Ordner verbunden.'); return []; }
    const t0 = Date.now();
    const zeilen = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file') { zeilen.push({ Name: name + '/', Art: 'Ordner', KB: '', Geändert: '', Alter: '' }); continue; }
      try {
        const f = await h.getFile();
        zeilen.push({ Name: name, Art: this._dateiArt(name), KB: Math.round(f.size / 1024 * 10) / 10, Geändert: new Date(f.lastModified).toLocaleString('de-DE'), Alter: this._alter(f.lastModified) });
      } catch(e) { zeilen.push({ Name: name, Art: this._dateiArt(name), KB: '?', Geändert: 'nicht lesbar: ' + (BhkSpur.fehlerArt(e) || e.name), Alter: '' }); }
    }
    zeilen.sort((a, b) => a.Art.localeCompare(b.Art) || a.Name.localeCompare(b.Name));
    const ms = Date.now() - t0;
    const arten = {};
    zeilen.forEach(z => { arten[z.Art] = (arten[z.Art] || 0) + 1; });
    console.log(`_bhk/: ${zeilen.length} Einträge in ${ms} ms – ` + Object.entries(arten).map(([a, n]) => `${n}× ${a}`).join(', '));
    this._tabelle(zeilen);
    BhkSpur.notiere('probe', 'Ordner auflisten (bhk.dateien)', { ok: true, ms, info: `${zeilen.length} Einträge` });
    return zeilen;
  },
  // Protokolle der aktuellen Datenbank im Sync-Ordner: je Datei Rechner,
  // zuletzt schreibende Person (aus der letzten Zeile), Größe, Alter und
  // der eigene Lesestand. Zwei Rechner vergleichen damit per Screenshot, ob
  // sie dieselben Dateien mit derselben Größe sehen – sehen sie das nicht,
  // arbeiten sie in verschiedenen Ordnern oder ein Rechner schreibt in einen
  // lokalen Zwischenspeicher (Windows-Offlinedateien), der den Server nie
  // erreicht.
  async protokolle() {
    const dir = App._syncDirV3 ? App._syncDirV3() : null;
    if (!dir) return { fehler: 'Kein Ordner verbunden', zeilen: [] };
    const prefix = App._oplogPrefix();
    const mein = App._getClientId();
    const zeilen = [];
    let anzahlAlle = 0;
    for await (const [name, h] of dir.entries()) {
      if (!name.endsWith('.jsonl') || !name.startsWith('oplog_')) continue;
      anzahlAlle++;
      if (!name.startsWith(prefix)) continue;
      const m = name.match(/^oplog_(.+)_([a-z0-9]+)_g(\d+)\.jsonl$/);
      const rechner = m ? m[2] : '?';
      const z = { datei: name, rechner, eigenes: rechner === mein, generation: m ? Number(m[3]) : 0, person: '', groesse: 0, geaendert: 0, lesestand: 0, neu: 0, ops: null, fehler: '' };
      try {
        const f = await h.getFile();
        z.groesse = f.size; z.geaendert = f.lastModified;
        z.lesestand = z.eigenes && name === App._myOplogName() ? App._myLogSize : (App._logOffsets[name] || 0);
        z.neu = Math.max(0, f.size - z.lesestand);
        // Letzte Zeile: wer hat zuletzt geschrieben? (nur die letzten 4 KB lesen)
        const schwanz = await f.slice(Math.max(0, f.size - 4096)).text();
        const letzte = schwanz.split('\n').filter(l => l.trim()).pop();
        if (letzte) { try { const op = JSON.parse(letzte); z.person = op.u || ''; z.letzteOp = op.ts || 0; } catch(e) {} }
      } catch(e) { z.fehler = (BhkSpur.fehlerArt && BhkSpur.fehlerArt(e)) || e.name || String(e); }
      zeilen.push(z);
    }
    zeilen.sort((a, b) => b.geaendert - a.geaendert);
    return {
      hauptordner: App.dirHandle ? (App.dirHandle.name || '') : '', ordner: dir.name || '', datenbank: App.autoLoadedDbName || '', rechner: mein,
      bhkFehlt: App._bhkFehlt || '', andereDatenbanken: anzahlAlle - zeilen.length, zeilen,
    };
  },
  async protokolleDialog() {
    const r = await this.protokolle();
    if (r.fehler) return App.toast(r.fehler, 'warning');
    const esc2 = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
    const kb = (n) => (n / 1024).toFixed(1).replace('.', ',') + ' KB';
    const fremde = r.zeilen.filter(z => !z.eigenes);
    const juengsteFremde = fremde.length ? fremde[0] : null;
    const befund = r.bhkFehlt ? `<div style="padding:8px 10px;border-left:4px solid var(--clr-red, #b00020);background:#fdecea;margin-bottom:10px"><strong>„_bhk“ nicht zugänglich</strong> (${esc2(r.bhkFehlt)}) – dieser Rechner schreibt in den Hauptordner, Kollegen lesen dort nicht.</div>`
      : !fremde.length ? `<div style="padding:8px 10px;border-left:4px solid var(--clr-amber);background:var(--clr-amber-light, #fff7ed);margin-bottom:10px"><strong>Kein Protokoll eines anderen Rechners für diese Datenbank.</strong> Entweder arbeitet noch niemand sonst hier, oder die Kollegen schreiben in einen anderen Ordner / eine andere Datei.</div>`
      : `<div style="padding:8px 10px;border-left:4px solid var(--clr-green);background:var(--clr-green-light);margin-bottom:10px">Jüngstes fremdes Protokoll: <strong>${esc2(juengsteFremde.person || juengsteFremde.rechner)}</strong>, ${esc2(this._alter(juengsteFremde.geaendert))} alt, ${juengsteFremde.neu ? `<strong>${kb(juengsteFremde.neu)} hier noch nicht gelesen</strong> (→ Vollabgleich)` : 'vollständig gelesen'}.</div>`;
    const body = `
      <div style="font-size:13px;line-height:1.6;margin-bottom:8px">
        Hauptordner <strong>${esc2(r.hauptordner || '?')}</strong> · Protokolle in <strong>${esc2(r.ordner || '?')}</strong> · Datenbank <strong>${esc2(r.datenbank)}</strong> · dieser Rechner <code>${esc2(r.rechner)}</code>${r.andereDatenbanken ? ` · <span style="color:var(--clr-amber)">${r.andereDatenbanken} Protokoll(e) anderer Datenbanken</span>` : ''}
      </div>
      ${befund}
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:6px">Zum Vergleich auf dem anderen Rechner dasselbe Fenster öffnen: <strong>gleiche Dateien, gleiche Größen?</strong> Zeigt ein Rechner sein eigenes Protokoll größer als der andere es sieht, kommen seine Schreibvorgänge nicht auf dem Server an (Windows-Offlinedateien / Zwischenspeicher).</div>
      <table class="data-table" style="font-size:12px"><thead><tr><th>Person</th><th>Rechner</th><th>Datei</th><th style="text-align:right">Größe</th><th>Geändert</th><th style="text-align:right">Hier ungelesen</th></tr></thead><tbody>
      ${r.zeilen.map(z => `<tr${z.eigenes ? ' style="font-weight:600"' : ''}><td>${esc2(z.person || '–')}${z.eigenes ? ' (ich)' : ''}</td><td><code>${esc2(z.rechner)}</code></td><td style="word-break:break-all">${esc2(z.datei)}${z.fehler ? ` <span style="color:var(--clr-red)">${esc2(z.fehler)}</span>` : ''}</td><td style="text-align:right">${kb(z.groesse)}</td><td>${z.geaendert ? esc2(new Date(z.geaendert).toLocaleString('de-DE')) + ' <span style="color:var(--clr-text-light)">(' + esc2(this._alter(z.geaendert)) + ')</span>' : '–'}</td><td style="text-align:right">${z.eigenes ? '–' : (z.neu ? `<strong>${kb(z.neu)}</strong>` : '0')}</td></tr>`).join('') || '<tr><td colspan="6">Keine Protokolle</td></tr>'}
      </tbody></table>`;
    App.openModal('Protokolle im Ordner', body, `<button class="btn btn-secondary" onclick="Konsole.protokolleDialog()">↻ Aktualisieren</button><button class="btn btn-secondary" onclick="App.closeModal();Konsole.vollabgleichDialog()">⟳ Vollabgleich</button><button class="btn btn-primary" onclick="App.closeModal()">Schließen</button>`);
    try { App._makeModalWide && App._makeModalWide(); } catch(e) {}
    return r;
  },
  _dateiArt(name) {
    if (name.endsWith('.crswap')) return 'Tauschdatei (Browser)';
    if (name.startsWith('oplog_')) return 'Protokoll';
    if (name.startsWith('praesenz_')) return 'Lebenszeichen';
    if (name.startsWith('chat_')) return 'Chat';
    if (name.startsWith('pos-')) return 'Position';
    if (name.startsWith('lock')) return 'Sperre';
    if (name.startsWith('snapmeta_')) return 'Snapshot-Meta';
    if (name.startsWith('sync')) return 'Marker';
    if (name.startsWith(this.PROBE_PREFIX)) return 'Probe';
    return 'Sonstiges';
  },

  // Verbindungstest: jeder Schritt gemessen, am Ende Befunde in Klartext.
  // Die Schreibprobe ist der einzige schreibende Schritt und räumt sich auf.
  async test() {
    const dir = App._syncDirV3 ? App._syncDirV3() : null;
    const schritte = [];
    const befunde = [];
    const schritt = async (name, fn) => {
      const t0 = Date.now();
      try {
        const info = await fn();
        const ms = Date.now() - t0;
        schritte.push({ Schritt: name, ms, Ergebnis: 'OK', Info: info == null ? '' : String(info) });
        BhkSpur.notiere('probe', name, { ok: true, ms, info: info == null ? '' : String(info) });
        return { ok: true, ms, info };
      } catch(e) {
        const ms = Date.now() - t0;
        const art = BhkSpur.fehlerArt(e);
        schritte.push({ Schritt: name, ms, Ergebnis: 'FEHLER', Info: `${art}: ${e && e.message || e}` });
        BhkSpur.notiere('probe', name, { ok: false, ms, fehler: e });
        return { ok: false, ms, art, fehler: e };
      }
    };
    if (!dir) {
      befunde.push('Kein Ordner verbunden – Test nicht möglich.');
      console.log(befunde[0]);
      return { schritte, befunde };
    }
    console.log('%cVerbindungstest läuft…', 'font-weight:bold');
    // 1) Ordner auflisten
    const liste = await schritt('Ordner _bhk auflisten', async () => { let n = 0; for await (const _ of dir.entries()) n++; return `${n} Einträge`; });
    // 2) Datenbankdatei: Metadaten
    const meta = await schritt('Datenbankdatei lesen (Metadaten)', async () => {
      if (!App.dbFileHandle) throw new Error('keine Datenbankdatei verbunden');
      const f = await App.dbFileHandle.getFile();
      return `${Math.round(f.size / 1024 / 1024 * 10) / 10} MB, geändert ${new Date(f.lastModified).toLocaleString('de-DE')}`;
    });
    // 3) Schreibprobe: schreiben, zurücklesen, Uhrversatz schätzen, löschen
    let versatz = null;
    const probeName = this.PROBE_PREFIX + (App._dbSlug ? App._dbSlug() : 'db') + '_' + App._getClientId() + '.txt';
    const schreib = await schritt('Schreibprobe (kleine Datei anlegen, zurücklesen, löschen)', async () => {
      const geschrieben = Date.now();
      const inhalt = 'bhk-probe ' + geschrieben;
      const h = await dir.getFileHandle(probeName, { create: true });
      const w = await h.createWritable();
      await w.write(inhalt);
      await w.close();
      const f = await (await dir.getFileHandle(probeName, { create: false })).getFile();
      const zurueck = await f.text();
      if (zurueck !== inhalt) throw new Error('Zurückgelesener Inhalt weicht ab (Offlinedateien oder Zwischenspeicher?)');
      versatz = f.lastModified - geschrieben;
      try { App._uhrVersatzLernen(versatz); } catch(e) {}
      try { await dir.removeEntry(probeName); } catch(e) {}
      return `Uhrversatz zum Dateiserver etwa ${Math.round(versatz / 1000)} s (geschätzt)`;
    });
    if (!schreib.ok) { try { await dir.removeEntry(probeName); } catch(e) {} }
    // 4) Abgleich
    const abgleich = await schritt('Fremde Protokolle lesen (Abgleich)', async () => {
      if (!App._v3Ready) return 'Abgleich noch nicht bereit (Start läuft)';
      await App._pollOplogs();
      return `Abgleich ${Math.round(App._lastPollMs || 0)} ms`;
    });

    // Befunde
    if (!schreib.ok) {
      if (schreib.art === 'safebrowsing') befunde.push('Schreiben blockiert: Der Browser lehnt Schreibvorgänge ab (Safe Browsing / Enterprise-Richtlinie ohne Internet-Ausleitung). Lesen geht, eigene Änderungen kommen bei den Kollegen NICHT an. Hilfe → Mehrbenutzer-Betrieb nennt die IT-Einstellung.');
      else if (schreib.art === 'zustand') befunde.push('Zugriff veraltet (Windows-Dateicache): Bitte die Seite neu laden (F5).');
      else if (schreib.art === 'verweigert') befunde.push('Schreiben verweigert: Ordnerberechtigung nur lesend oder Zugriff abgelaufen – Ordner erneut verbinden.');
      else befunde.push(`Schreiben fehlgeschlagen (${BhkSpur.artText(schreib.art)}): ${schreib.fehler && schreib.fehler.message || ''}`);
    }
    if (liste.ok && liste.ms > 2000) befunde.push(`Langsame Leitung: Das Auflisten des Ordners dauert ${liste.ms} ms (Büro-LAN: unter 100 ms). Wartung → Verbindung → „Langsame Leitung“ empfohlen.`);
    else if (liste.ok && liste.ms > 500) befunde.push(`Leitung mittel: Auflisten ${liste.ms} ms – der Abgleich braucht länger, das ist über VPN normal.`);
    if (versatz != null && Math.abs(versatz) > 60000) befunde.push(`Uhrversatz von etwa ${Math.round(Math.abs(versatz) / 60000)} min zwischen diesem Rechner und dem Dateiserver. Änderungen werden ab jetzt mit der Serverzeit gestempelt; bis dahin konnte dieser Rechner Konflikte um dasselbe Feld falsch gewinnen oder verlieren. Uhr per Domäne synchronisieren.`);
    if (App._tabIsPrimary === false) befunde.push('Zweit-Registerkarte: Diese Registerkarte kann keinen Snapshot schreiben, Import und Datenbank-Tools sind gesperrt.');
    if (App._neuladenNoetig) befunde.push('Der Zugriff auf das Netzlaufwerk ist veraltet – nur Neuladen (F5) hilft.');
    if (App._netzWeg) befunde.push('Netzabriss-Zustand aktiv: Abgleich und Speichern sind pausiert, Probe alle 30 s.');
    if (App._safeBrowsingBis && Date.now() < App._safeBrowsingBis) befunde.push(`Backups bis ${this._zeit(App._safeBrowsingBis)} ausgesetzt (Safe-Browsing-Abbruch zuvor).`);
    if ((App._dirtyOps || []).length) befunde.push(`${App._dirtyOps.length} Änderung(en) warten noch auf das Anhängen.`);
    if (typeof document !== 'undefined' && document.hidden) befunde.push('Das Fenster gilt als verdeckt – in diesem Zustand setzt der Abgleich-Takt aus.');
    const s = BhkSpur.stat;
    ['anhaengen', 'abgleich', 'backup'].forEach(k => { if (s[k] && s[k].fehler && s[k].letzteArt) befunde.push(`Bereich ${k}: ${s[k].fehler} Fehler in dieser Sitzung, zuletzt ${BhkSpur.artText(s[k].letzteArt)}.`); });
    if (!befunde.length) befunde.push(`Keine Auffälligkeiten: Lesen, Schreiben und Abgleich funktionieren (Programmstand ${App.BUILD}).`);
    else befunde.push(`Programmstand dieses Rechners: ${App.BUILD} – bitte mit den Kollegen vergleichen (alle müssen dieselbe Datei vom Netzlaufwerk starten).`);

    this._tabelle(schritte);
    console.log('%cBefunde', 'font-weight:bold');
    befunde.forEach(b => console.log('• ' + b));
    return { schritte, befunde, versatzMs: versatz, abgleich: abgleich.ok, meta: meta.ok };
  },

  // Verbindungstest mit Ergebnisfenster (Wartung → Verbindung)
  async testDialog() {
    App.showLoading && App.showLoading('Verbindungstest läuft…');
    let r;
    try { r = await this.test(); } finally { App.hideLoading && App.hideLoading(); }
    const text = ['Verbindungstest ' + new Date().toLocaleString('de-DE'), ...r.schritte.map(s => `${s.Ergebnis === 'OK' ? '✓' : '✗'} ${s.Schritt}: ${s.ms} ms${s.Info ? ' – ' + s.Info : ''}`), '', 'Befunde:', ...r.befunde.map(b => '• ' + b)].join('\n');
    this._letzterTest = text;
    App.openModal('Verbindungstest', `
      <table class="data-table"><thead><tr><th>Schritt</th><th style="text-align:right">Dauer</th><th>Ergebnis</th></tr></thead><tbody>
        ${r.schritte.map(s => `<tr><td>${esc(s.Schritt)}</td><td style="text-align:right;white-space:nowrap">${s.ms} ms</td><td style="color:${s.Ergebnis === 'OK' ? 'var(--clr-green)' : 'var(--clr-red)'}">${esc(s.Ergebnis)}${s.Info ? ' <span style="color:var(--clr-text-light)">– ' + esc(s.Info) + '</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:10px;font-size:13px"><strong>Befunde</strong><ul style="margin:4px 0 0 18px">${r.befunde.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>
      <div style="font-size:12px;color:var(--clr-text-light);margin-top:8px">Mehr in der Browser-Konsole (F12): <code>bhk.hilfe()</code> zeigt alle Diagnosebefehle, <code>bhk.spur()</code> die Ereignisspur.</div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-secondary" onclick="App.kopieren(Konsole._letzterTest,'Testergebnis kopiert')">▤ Ergebnis kopieren</button>
       <button class="btn btn-primary" onclick="Konsole.kopieren()">▤ Zustandsbild kopieren</button>`);
    return r;
  },

  async jetzt() {
    const t0 = Date.now();
    if (App._v3Ready && !App._pollBusy) await App._pollOplogs();
    console.log(`Abgleich ${Math.round(App._lastPollMs || 0)} ms – gesamt ${Date.now() - t0} ms`);
    return { abgleichMs: App._lastPollMs || 0 };
  },
  kopieren() { return App.kopieren(App.diagnoseText({ zeilen: 150 }), 'Zustandsbild kopiert – bei der Entwicklung einfügen'); },
  // Prüfung je Azubi (Konsole): lokaler Stand gegen die Protokolle auf dem Laufwerk
  async pruefen(sid) {
    if (sid == null) { console.log('Aufruf: bhk.pruefen(<Azubi-Kennung>) – die Kennung steht in der Adresszeile der Azubi-Seite oder in der Konsole über App.query("SELECT id,nachname FROM schueler WHERE nachname LIKE ?", ["Muster%"])'); return null; }
    const r = await App.azubiPruefen(sid);
    console.log(`%cPrüfung ${r.name} (#${r.sid}) – Rechner ${r.rechner.slice(-4)}, Programmstand ${r.build}, Uhrversatz ${Math.round(r.versatzMs / 1000)} s, Datenbank ${r.datenbank || '?'}, Protokolle in Ordner „${r.ordner || '?'}“ (Hauptordner „${r.hauptordner || '?'}“)`, 'font-weight:bold');
    if (r.bhkFehlt) console.log(`%cACHTUNG: Der Unterordner _bhk konnte nicht geöffnet werden (${r.bhkFehlt}) – dieser Rechner schreibt seine Protokolle in den Hauptordner, die Kollegen lesen dort nicht.`, 'color:#A94E00;font-weight:bold');
    if (r.ordner && r.ordner !== '_bhk') console.log('%cACHTUNG: Die Protokolle dieses Rechners liegen NICHT in _bhk – Kollegen sehen seine Änderungen nicht. Ordnerrechte für _bhk prüfen, Verbindung trennen und neu verbinden.', 'color:#A94E00;font-weight:bold');
    if (r.protokolleAusserhalb && r.protokolleAusserhalb.length) { console.log('%cACHTUNG: Im Hauptordner liegen aktuelle Protokolle außerhalb von _bhk – ein anderer Rechner schreibt daneben (er konnte _bhk nicht öffnen):', 'color:#A94E00;font-weight:bold'); this._tabelle(r.protokolleAusserhalb); }
    if (App._leitDb) console.log(`Gemeinsame Datenbank dieses Ordners: „${App._leitDb.name}“${App.istLeitDb() === false ? ' – HIER IST ABER EINE ANDERE GEÖFFNET (Wartung → Verbindung → „Zur gemeinsamen Datenbank wechseln“)' : ' (hier geöffnet)'}`);
    if (r.andereDatenbanken && r.andereDatenbanken.length) { console.log('%cACHTUNG: Im selben Ordner werden Protokolle für eine ANDERE Datenbank geschrieben – dort arbeitet vermutlich der Kollege. Alle müssen dieselbe Datei öffnen (Name rechts in der Kopfzeile):', 'color:#A94E00;font-weight:bold'); this._tabelle(r.andereDatenbanken); }
    console.log(`Lokal: ${r.lokal.wochen.length} Wochenzeilen, davon ${r.lokal.wochenMitCodes} mit Codes; ${r.lokal.ergebnisse.length} Kontrollergebnis(se); ${r.lokal.stempel} Zeilen mit Stempeln`);
    this._tabelle(r.lokal.wochen.filter(w => w.codes || w.bemerkung).map(w => ({ AJ: w.aj, KW: w.kw, Codes: w.codes, Fehltage: w.fehltage, Bemerkung: w.bemerkung })));
    this._tabelle(r.lokal.ergebnisse.map(e => ({ Termin: e.termin, Ergebnis: e.ergebnis, Geändert: e.geaendert_am, Von: e.geaendert_von })));
    if (r.hinweis) console.log(r.hinweis);
    else {
      console.log(`Protokolle auf dem Laufwerk: ${r.gesamtOps} Op(s) zu diesem Azubi, davon ${r.unbekanntGesamt} auf diesem Rechner NICHT angewendet`);
      if (r.zwangOps) console.log(`Ausgeschriebener Stand („für alle übernehmen“): ${r.zwangOps} Op(s), zuletzt ${new Date(r.zwangLetzte).toLocaleString('de-DE')}, davon ${r.zwangUnbekannt} hier noch nicht gelesen${r.zwangUnbekannt ? ' → bhk.vollabgleich() oder bhk.jetzt()' : ' – alle angewendet; zeigt die Oberfläche trotzdem Altes, Ansicht neu laden (F5)'}`);
      else console.log('Kein ausgeschriebener Stand in den Protokollen dieses Ordners. Wurde „für alle übernehmen“ auf dem anderen Rechner ausgeführt, arbeitet er auf einem ANDEREN Ordner/einer anderen Datenbank (dort bhk.pruefen(id) vergleichen: Datenbank und Ordner) oder sein Speicherstatus zeigt noch „wartend“/„hängt“.');
      this._tabelle(r.protokolle.filter(p => p.ops || p.fehler).map(p => ({ Protokoll: p.protokoll, Ops: p.ops, NichtAngewendet: p.unbekannt, Lesestand: p.lesestand, Größe: p.groesse, Fehler: p.fehler || '' })));
      if (r.unbekannt.length) { console.log('%cNicht angewendete Ops (Auszug)', 'font-weight:bold'); this._tabelle(r.unbekannt); }
      if (r.verworfenGesamt) {
        console.log(`%c${r.verworfenGesamt} Op(s) der Kollegen wurden hier VERWORFEN, weil dieser Rechner für dieselben Felder neuere eigene Werte hat (Last-Write-Wins).`, 'font-weight:bold');
        this._tabelle(r.verworfen);
        console.log('→ Soll der Stand des ANDEREN Rechners gelten: dort bhk.ausschreiben(terminId, azubiId) bzw. in der Durchsicht ⋯ → „Stand dieses Rechners für alle übernehmen“.');
      }
      if (r.unbekanntGesamt) console.log('→ bhk.vollabgleich() liest die Protokolle ab dem Snapshot-Stand neu ein.');
      else if (!r.verworfenGesamt) console.log('Alle Ops zu diesem Azubi sind hier angewendet. Fehlt trotzdem etwas, wurde es auf dem anderen Rechner nie ins Protokoll geschrieben (dort: Speicherstatus „n wartend“, bhk.status(), Wartung → „Änderungen als Datei“) – oder der andere Rechner arbeitet auf einer anderen Datenbankdatei (bhk.status() vergleichen).');
    }
    return r;
  },
  // Stand dieses Rechners für alle (Konsole)
  ausschreiben(terminId, schuelerId) {
    if (terminId == null && schuelerId == null) { console.log('Aufruf: bhk.ausschreiben(<Termin-Kennung>[, <Azubi-Kennung>]) – Termin-Kennung über App.query("SELECT id,datum,name FROM kontrolltermine ORDER BY datum DESC LIMIT 10")'); return null; }
    const r = App.standAusschreiben({ terminId, schuelerId });
    console.log(`Stand ausgeschrieben: ${r.azubis} Azubi(s), ${r.zeilen} Zeilen, ${r.ops} Änderungen – werden jetzt angehängt (Speicherstatus in der Kopfzeile). Als Datei: App.standAlsDatei(r.text)`);
    return r;
  },
  // Dialog aus der Durchsicht / Wartung: erklärt, fragt nach, schreibt aus
  async ausschreibenDialog(terminId, schuelerId) {
    // Nichts darf hier werfen – ein Fehler vor der Rückfrage hieße: nichts wird
    // ausgeschrieben, und der Nutzer hält es für erledigt
    let t = null, s = null;
    try { t = terminId != null ? App.query('SELECT geplant_datum, bemerkung FROM kontrolltermine WHERE id=?', [terminId])[0] : null; } catch(e) {}
    try { s = schuelerId != null ? App.query('SELECT nachname, vorname FROM schueler WHERE id=?', [schuelerId])[0] : null; } catch(e) {}
    const datum = (d) => { try { return typeof formatDate === 'function' ? formatDate(d) : d; } catch(e) { return d; } };
    const was = s ? `die Durchsicht von ${s.nachname}, ${s.vorname}${t ? ` (Termin ${datum(t.geplant_datum)})` : ''}`
      : t ? `alle Durchsichten des Termins ${datum(t.geplant_datum)}${t.bemerkung ? ` „${t.bemerkung}“` : ''}` : 'diese Durchsicht';
    const ok = await App.confirm(
      `Der Stand DIESES Rechners für ${was} wird als neueste Änderung ins Protokoll geschrieben: Ergebnis, alle Wochen des Azubis, Mängel, Wiedervorlagen und Archiv.\n\n` +
      'Alle anderen Rechner übernehmen diesen Stand – auch dort, wo gerade etwas anderes steht. Hier ändert sich nichts.\n\n' +
      'Vorher sicherstellen, dass HIER der richtige Stand steht.',
      { titel: 'Stand dieses Rechners für alle übernehmen', ok: 'Jetzt ausschreiben', abbrechen: 'Abbrechen' });
    if (!ok) return null;
    let r;
    try { r = App.standAusschreiben({ terminId, schuelerId }); }
    catch(e) { console.error('[Ausschreiben]', e); App.toast('Ausschreiben fehlgeschlagen: ' + (e && e.message || e) + ' – nichts wurde geschrieben', 'error'); return null; }
    if (!r.ops) { App.toast('Nichts auszuschreiben (keine Durchsicht zu diesem Termin/Azubi)', 'info'); return r; }
    App.toast(`${r.zeilen} Zeilen für ${r.azubis} Azubi(s) ausgeschrieben – die Kollegen übernehmen sie mit dem nächsten Abgleich`, 'success');
    const datei = await App.confirm(
      'Zusätzlich als Änderungsdatei sichern? Nur nötig, wenn ein Rechner das Protokoll nicht bekommt: die Datei dort unter Wartung → Verbindung → „Änderungsdatei einspielen“ laden.',
      { titel: 'Notausgang: Datei', ok: 'Datei speichern', abbrechen: 'Nicht nötig' });
    if (datei) App.standAlsDatei(r.text, s ? `${s.nachname}` : (t ? `termin_${terminId}` : ''));
    return r;
  },
  async vollabgleich() {
    const r = await App.vollabgleich('Konsole');
    if (!r.ok) console.log('Vollabgleich nicht möglich: ' + r.grund);
    else console.log(`Vollabgleich: ${r.dateien} Protokolle, ${r.gelesen} Ops gelesen, ${r.angewendet} angewendet, ${r.fehler} Lesefehler, ${r.ms} ms`);
    return r;
  },
  async vollabgleichDialog() {
    App.showLoading && App.showLoading('Vollabgleich läuft…');
    let r; try { r = await App.vollabgleich('Wartung'); } finally { App.hideLoading && App.hideLoading(); }
    if (!r.ok) return App.toast('Vollabgleich nicht möglich: ' + r.grund, 'warning');
    App.toast(`Vollabgleich: ${r.gelesen} Änderungen aus ${r.dateien} Protokollen gelesen, ${r.angewendet} übernommen${r.fehler ? `, ${r.fehler} Protokoll(e) nicht lesbar` : ''}`, r.fehler ? 'warning' : 'success');
    return r;
  },
  debug(an) {
    const neu = BhkSpur.setDebug(an !== false);
    console.log(neu ? 'Debug an: Jeder Netzvorgang erscheint ab jetzt als [Spur:…] in der Konsole.' : 'Debug aus.');
    return neu;
  },

  installieren() {
    if (typeof window === 'undefined') return;
    window.bhk = this;
    try {
      if (BhkSpur.debug) console.log('[Spur] Debug-Ausgabe ist eingeschaltet (bhk.debug(false) schaltet sie aus)');
      console.log('%cBerichtsheftkontrolle%c – Diagnose: bhk.hilfe() · Verbindungstest: bhk.test() · Zustandsbild kopieren: bhk.kopieren()', 'font-weight:bold', '');
    } catch(e) {}
  },
};
Konsole.installieren();
