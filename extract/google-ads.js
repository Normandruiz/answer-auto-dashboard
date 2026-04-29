/**
 * extract/google-ads.js
 *
 * Extrae datos de Google Ads (campañas AUTO) usando Playwright.
 * Retorna dos arrays: ayer y mtd, con el mismo schema que mock.json#google_ads.
 *
 * Requiere haber ejecutado `node extract/setup-auth.js` al menos una vez.
 */

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const AUTH_DIR  = resolve(ROOT, '.auth-profile');

export async function extractGoogleAds(dateYesterday, dateMtdFrom) {
  const config = JSON.parse(await readFile(resolve(ROOT, 'config.json'), 'utf8'));

  const browser = await chromium.launchPersistentContext(AUTH_DIR, {
    channel:  'chrome',
    headless: true,
    viewport: { width: 1400, height: 900 },
  });

  try {
    const gaParams = new URLSearchParams({
      ocid: config.google_ads.ocid,
      ...config.google_ads.auth_params,
    });
    const baseUrl = `${config.google_ads.base_url}?${gaParams}`;

    const ayerData = await scrapeCampaigns(browser, baseUrl, dateYesterday, dateYesterday);
    const mtdData  = await scrapeCampaigns(browser, baseUrl, dateMtdFrom, dateYesterday);

    return { ayer: ayerData, mtd: mtdData };
  } finally {
    await browser.close();
  }
}

async function scrapeCampaigns(browser, baseUrl, dateFrom, dateTo) {
  const page = await browser.newPage();

  // Navegar e inyectar rango de fechas vía URL segment
  // Google Ads acepta fechas en la URL como __r.timeRange=...
  // La forma más robusta es navegar y usar el selector de fechas de la UI
  const url = `${baseUrl}&__r.timeRange={"start":"${dateFrom}","end":"${dateTo}"}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  // Esperar que aparezca la tabla de campañas
  await page.waitForSelector('div[data-testid="campaign-list-table"], table[aria-label*="ampaign"], .campaign-row', {
    timeout: 30_000,
  }).catch(() => {
    // Si no aparece el selector exacto, seguimos e intentamos el fallback
  });

  // Extraer datos de la tabla via intercepción de red
  // Google Ads hace un request interno a su API; capturamos esa respuesta
  const campaigns = await page.evaluate(() => {
    const rows = [];

    // Selector principal: filas de tabla con nombre de campaña
    const tableRows = document.querySelectorAll(
      'tr[data-campaign-id], tr[data-row-key], .table-row[data-id]'
    );

    tableRows.forEach(row => {
      // Nombre de campaña
      const nameEl = row.querySelector(
        '[data-column="campaign_name"] a, [data-column-id="campaign_name"], .campaign-name a, td:first-child a'
      );
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      if (!name) return;

      const getText = (sel) => {
        const el = row.querySelector(sel);
        return el ? el.textContent.replace(/[^0-9.,%-]/g, '').trim() : '0';
      };
      const toNum = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;

      // Columnas estándar de Google Ads
      const cost = toNum(getText('[data-column="cost"], [data-column-id="cost"]'));
      const conv = toNum(getText('[data-column="conversions"], [data-column-id="conversions"]'));
      const clicks = toNum(getText('[data-column="clicks"], [data-column-id="clicks"]'));
      const impressions = toNum(getText('[data-column="impressions"], [data-column-id="impressions"]'));
      const statusEl = row.querySelector('[data-column="status"] span, [data-column-id="status"] span');
      const status = statusEl ? statusEl.textContent.trim() : 'Unknown';

      const cpc = clicks > 0 ? Math.round(cost / clicks) : 0;
      const cpa = conv > 0 ? Math.round(cost / conv) : 0;

      rows.push({ campaign: name, spend: cost, conversions: conv, clicks, impressions, cpc, cpa, status });
    });

    return rows;
  });

  // Fallback: si no encontramos datos, intentar con otra estructura de la UI
  if (campaigns.length === 0) {
    console.warn(`  ⚠ Google Ads: tabla vacía para ${dateFrom}→${dateTo}. Intentando fallback...`);

    const fallback = await page.evaluate(() => {
      const rows = [];
      // Algunas versiones de la UI usan divs en lugar de tabla
      document.querySelectorAll('[role="row"]:not([role="columnheader"])').forEach(row => {
        const cells = row.querySelectorAll('[role="gridcell"]');
        if (cells.length < 5) return;
        const name = cells[0]?.textContent.trim();
        if (!name) return;
        const toNum = s => parseFloat((s || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        rows.push({
          campaign:    name,
          spend:       toNum(cells[4]?.textContent),
          conversions: toNum(cells[8]?.textContent),
          clicks:      toNum(cells[3]?.textContent),
          impressions: toNum(cells[2]?.textContent),
          cpc:         0,
          cpa:         0,
          status:      cells[1]?.textContent.trim() || 'Unknown',
        });
      });
      return rows;
    });

    await page.close();
    return fallback;
  }

  await page.close();
  return campaigns;
}
