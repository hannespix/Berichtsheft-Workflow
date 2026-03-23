const BlockplanAnalyzer = {
  // Render PDF pages to images (base64 PNG)
  async pdfToImages(file, maxPages) {
    maxPages = maxPages || 3;
    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const images = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const scale = 2.5; // High resolution for accurate table reading
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      images.push({ base64, mediaType: 'image/png' });
    }
    return images;
  },

  // Also extract text as fallback
  async extractText(file) {
    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  },

  async analyze(file, schuleName) {
    App.showLoading('PDF wird gerendert\u2026');
    try {
      const images = await this.pdfToImages(file);
      const pdfText = await this.extractText(file);
      window._bpLastPdfText = pdfText;
      const textCtx = pdfText.length > 100 ? '\nExtrahierter Text als Hilfe:\n' + pdfText.substring(0, 5000) : '';

      // === PASS 1: Struktur verstehen ===
      App.showLoading('Pass 1/3: Tabellenstruktur analysieren\u2026');
      const structPrompt = `Du siehst den Blockplan einer Berufsschule als Bild. Beantworte folgende Fragen zur STRUKTUR:

1. TABELLENFORMAT: Welches Format?
   a) Wochenbasiert mit Spalten pro Klasse (Nummern oder "x" in Zellen)
   b) Blockbasiert (Block 1-5 mit KW-Bereichen)
   c) Tagesbasiert (Wochentage als Spalten, Klassennamen in Zellen)
   d) Anderes Format

2. SPALTENSTRUKTUR: Liste ALLE Gärtner/Gartenbau-Spaltenüberschriften auf.
   - Welche gehören zu Lehrjahr 1 (Grundstufe/L1)?
   - Welche zu Lehrjahr 2 (Fachstufe 1/L2)?
   - Welche zu Lehrjahr 3 (Fachstufe 2/L3)?

3. ZELLENINHALTE: Was steht in Zellen bei Unterricht? (Blocknummern 1-12, "x", Klassennamen?)

4. FERIEN: Welche Zeilen sind Ferien/frei?

5. GESCHÄTZTE WOCHENZAHL pro Lehrjahr? (z.B. 12, 24, 38)

Schule: ${schuleName}
${textCtx}

Antworte strukturiert mit Nummern 1-5.`;

      const structResponse = await LLMHelper.callVision(structPrompt, images);

      // === PASS 2: KWs extrahieren mit Strukturwissen ===
      App.showLoading('Pass 2/3: Kalenderwochen extrahieren\u2026');
      const extractPrompt = `Du siehst den Blockplan einer Berufsschule als Bild. Deine Strukturanalyse ergab:

${structResponse}

AUFGABE: Extrahiere ALLE Kalenderwochen (KW) pro Lehrjahr.

ENTSCHEIDENDE ZUORDNUNGSREGEL:
Eine KW zählt für ein Lehrjahr, wenn MINDESTENS EINE Klasse/Untergruppe dieses Lehrjahrs in dieser KW Unterricht hat.

BEI WOCHENBASIERTEN PLÄNEN (Format a):
- Jedes Lehrjahr hat oft 4 Untergruppen-Spalten (z.B. GL1, GL2, GL3, GL4)
- Die Untergruppen wechseln sich typischerweise im 2er-Rhythmus ab:
  KW 38: GL1+GL2 haben Blocknummer \u2192 KW 38 zählt für dieses LJ
  KW 39: GL3+GL4 haben Blocknummer \u2192 KW 39 zählt AUCH für dieses LJ
- BEIDE Wochen zählen! Nicht nur Wochen wo alle 4 Gruppen gleichzeitig da sind!
- Gehe JEDE Zeile durch und prüfe JEDE Spalte des LJ einzeln.

BEI BLOCKBASIERTEN PLÄNEN (Format b):
- Alle KWs innerhalb eines Block-Zeitraums zählen.

BEI TAGESBASIERTEN PLÄNEN (Format c):
- Jede nicht-Ferien-KW zählt für LJs die an diesem Tag Unterricht haben.
- Wenn z.B. Mo+Di=L1G, dann hat LJ1 in JEDER normalen Schulwoche Unterricht (\u223838 Wochen).

IGNORIERE: Ferien-Zeilen, reine Prüfungswochen ohne regulären Unterricht.
NUR Gärtner/Gartenbau (GB, GL, GaLaBau) \u2013 NICHT Floristen, Weinbau.
Schule: ${schuleName}

Gehe JEDE Zeile der Tabelle durch. Für JEDE KW, prüfe JEDE Spalte.

Antworte NUR mit JSON (kein Markdown, kein Text):
{"schuljahr":"2025/2026","lehrjahre":{"1":[KWs],"2":[KWs],"3":[KWs]}}`;

      const extractResponse = await LLMHelper.callVision(extractPrompt, images);
      const jsonMatch = extractResponse.match(/\{[\s\S]*"lehrjahre"[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Kein JSON in KI-Antwort.\n\n' + extractResponse.substring(0, 300));
      const result = JSON.parse(jsonMatch[0]);

      // === PASS 3: Selbstvalidierung ===
      App.showLoading('Pass 3/3: Ergebnis validieren\u2026');
      const ljCounts = Object.entries(result.lehrjahre||{}).map(([lj,kws])=>`LJ ${lj}: ${(kws||[]).length} Wochen`).join(', ');
      const validatePrompt = `Du hast einen Blockplan analysiert. Ergebnis: ${ljCounts}

${JSON.stringify(result)}

Strukturanalyse: ${structResponse.substring(0, 1200)}

VALIDIERUNG \u2013 prüfe kritisch:

1. PLAUSIBILITÄT der Wochenzahlen:
   - Blockunterricht (12 Blöcke \u00d7 2 Wochen): Erwarte ~24 Wochen/LJ
   - Tagesunterricht (2 Tage/Woche, ganzjährig): Erwarte ~38 Wochen/LJ
   - Kompakt-Blöcke (5 Blöcke \u00d7 2-3 Wochen): Erwarte ~10-15 Wochen/LJ
   Passen die extrahierten Zahlen zum erkannten Format?

2. SYMMETRIE: Alle 3 LJ sollten \u00b120% gleich viele Wochen haben.
   Abweichung >30% = wahrscheinlich Fehler bei Spaltenzuordnung.

3. FEHLERSUCHE: Schau NOCHMAL auf das Bild.
   - Hast du KWs vergessen wo nur 1-2 von 4 Untergruppen Unterricht haben?
   - Hast du Ferien-KWs fälschlich mitgezählt?

4. KONFIDENZ (1-10):
   9-10 = Tabelle klar lesbar, Ergebnis sicher korrekt
   6-8 = Komplexes Layout, weitgehend sicher
   3-5 = Unsicher, manuelle Prüfung nötig
   1-2 = Tabelle nicht lesbar

5. Falls Korrekturen nötig: Gib korrigiertes VOLLSTÄNDIGES JSON aus.

Antwortformat:
KONFIDENZ: [Zahl]
KOMMENTAR: [1 Satz Begründung]
JSON: [korrigiertes JSON oder UNCHANGED]`;

      const valResponse = await LLMHelper.callVision(validatePrompt, images);

      // Parse validation response
      const konfMatch = valResponse.match(/KONFIDENZ:\s*(\d+)/i);
      const konfidenz = konfMatch ? parseInt(konfMatch[1]) : 5;
      const kommentarMatch = valResponse.match(/KOMMENTAR:\s*([^\n]+)/i);

      // Check for corrected JSON
      let finalResult = result;
      const correctedJson = valResponse.match(/\{[\s\S]*"lehrjahre"[\s\S]*\}/);
      if (correctedJson && !valResponse.includes('UNCHANGED')) {
        try {
          const corrected = JSON.parse(correctedJson[0]);
          if (corrected.lehrjahre) { finalResult = corrected; finalResult._corrected = true; }
        } catch(e) { /* keep original */ }
      }

      // Add metadata
      finalResult._konfidenz = konfidenz;
      finalResult._kommentar = kommentarMatch?.[1] || '';
      finalResult._struktur = structResponse.substring(0, 500);

      // Plausibility warnings
      finalResult._warnings = [];
      Object.entries(finalResult.lehrjahre || {}).forEach(([lj, kws]) => {
        if (!Array.isArray(kws)) return;
        if (kws.length > 42) finalResult._warnings.push(`LJ ${lj}: ${kws.length} Wochen \u2013 verdächtig viel.`);
        if (kws.length < 8 && kws.length > 0) finalResult._warnings.push(`LJ ${lj}: Nur ${kws.length} Wochen \u2013 zu wenig, Untergruppen möglicherweise nicht erkannt.`);
      });
      const ljArr = Object.values(finalResult.lehrjahre || {}).map(kws => (kws||[]).length).filter(n => n > 0);
      if (ljArr.length >= 2) {
        const maxL = Math.max(...ljArr), minL = Math.min(...ljArr);
        if (maxL > 0 && (maxL - minL) / maxL > 0.35)
          finalResult._warnings.push(`Asymmetrie: ${minL}\u2013${maxL} Wochen. Spaltenzuordnung prüfen.`);
      }
      if (konfidenz <= 5) finalResult._warnings.push(`KI-Konfidenz ${konfidenz}/10 \u2013 manuelle Prüfung empfohlen.`);

      App.hideLoading();
      return finalResult;
    } catch(e) {
      App.hideLoading();
      throw e;
    }
  },

  async importResult(bsId, result) {
    const sj = result.schuljahr || '2025/2026';
    let total = 0;
    App.run('DELETE FROM blockplan WHERE berufsschule_id=? AND schuljahr=?', [bsId, sj]);
    Object.entries(result.lehrjahre || {}).forEach(([lj, kws]) => {
      (kws || []).forEach(kw => {
        App.run('INSERT OR IGNORE INTO blockplan (berufsschule_id,schuljahr,lehrjahr,kalenderwoche) VALUES (?,?,?,?)', [bsId, sj, parseInt(lj), parseInt(kw)]);
        total++;
      });
    });
    return total;
  }
};
