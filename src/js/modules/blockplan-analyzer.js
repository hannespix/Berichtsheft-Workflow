// Blockplan-Analyse: Nur manueller Import (KI-Analyse entfernt)
const BlockplanAnalyzer = {
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
