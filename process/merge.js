/**
 * process/merge.js
 *
 * Combina los datos extraídos de Google Ads, Meta Ads y Google Sheet
 * en un único JSON compatible con generate/build-report.js.
 */

export function mergeData({ googleAds, metaAds, sheet }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const mtdFrom = new Date(today.getFullYear(), today.getMonth(), 1);

  const fmt = (d) => d.toISOString().slice(0, 10);

  return {
    generated_at: new Date().toISOString(),

    date_range: {
      from:  fmt(mtdFrom),
      to:    fmt(yesterday),
      label: `${monthName(today.getMonth())} ${today.getFullYear()} — MTD al ${yesterday.getDate()}`,
      ayer:  fmt(yesterday),
    },

    // MTD es el principal para los gráficos; ayer va en subarrays
    google_ads: enrichWithAyer(googleAds.mtd, googleAds.ayer),
    meta_ads:   enrichWithAyer(metaAds.mtd,   metaAds.ayer),

    // Snapshots de ayer (para los KPI cards "Ayer")
    google_ads_ayer: googleAds.ayer,
    meta_ads_ayer:   metaAds.ayer,

    cotas: sheet.cotas,
    solas: sheet.solas,
  };
}

function enrichWithAyer(mtdRows, ayerRows) {
  // Agrega campo `ayer_*` a cada campaña del MTD cruzando por nombre
  return mtdRows.map(row => {
    const ayerRow = ayerRows.find(a =>
      normalize(a.campaign) === normalize(row.campaign)
    );
    return {
      ...row,
      ayer_spend:       ayerRow?.spend       ?? null,
      ayer_conversions: ayerRow?.conversions  ?? null,
      ayer_results:     ayerRow?.results      ?? null,
      ayer_cpa:         ayerRow?.cpa          ?? null,
      ayer_cpr:         ayerRow?.cpr          ?? null,
    };
  });
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function monthName(month) {
  return ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month];
}
