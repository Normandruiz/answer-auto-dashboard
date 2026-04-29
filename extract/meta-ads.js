/**
 * extract/meta-ads.js
 *
 * Extrae campañas AUTO de Meta Ads Manager usando Playwright.
 * Retorna dos arrays: ayer y mtd.
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

export async function extractMetaAds(dateYesterday, dateMtdFrom) {
  const config = JSON.parse(await readFile(resolve(ROOT, 'config.json'), 'utf8'));

  const browser = await chromium.launchPersistentContext(AUTH_DIR, {
    channel:  'chrome',
    headless: true,
    viewport: { width: 1400, height: 900 },
  });

  try {
    const ayerData = await scrapeMeta(browser, config, dateYesterday, dateYesterday);
    const mtdData  = await scrapeMeta(browser, config, dateMtdFrom, dateYesterday);
    return { ayer: ayerData, mtd: mtdData };
  } finally {
    await browser.close();
  }
}

async function scrapeMeta(browser, config, dateFrom, dateTo) {
  const page = await browser.newPage();

  // Meta Ads Manager — vista de campañas con filtro de cuenta
  const url = `${config.meta_ads.base_url}?act=${config.meta_ads.ad_account_id}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  // Aplicar rango de fechas usando el selector de Meta
  await applyDateRange(page, dateFrom, dateTo);

  // Esperar que la tabla cargue
  await page.waitForSelector('[data-visualcompletion="loading-state"]', { state: 'hidden', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const campaigns = await page.evaluate((filter) => {
    const rows = [];

    // Intentar seleccionar filas de la tabla de campañas
    const tableRows = document.querySelectorAll(
      'tr[class*="row"], div[role="row"]:not([role="columnheader"])'
    );

    tableRows.forEach(row => {
      const nameEl = row.querySelector('a[href*="campaigns"], span[class*="campaign-name"], [data-testid="campaign-name"]');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();

      // Filtrar solo campañas AUTO
      if (!name.toLowerCase().includes('auto')) return;

      const toNum = (sel) => {
        const el = row.querySelector(sel);
        if (!el) return 0;
        return parseFloat(el.textContent.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      };

      // Columnas típicas de Meta Ads Manager
      // Orden: Nombre | Entrega | Resultados | Costo/resultado | Importe gastado | Alcance | Impresiones
      const cells = row.querySelectorAll('td, [role="cell"]');
      const getText = (i) => cells[i]?.textContent.trim() || '0';
      const toN = (s) => parseFloat(s.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

      const results     = toN(getText(2));
      const cpr         = toN(getText(3));
      const spend       = toN(getText(4));
      const reach       = toN(getText(5));
      const impressions = toN(getText(6));

      // Detectar tipo de conversión
      const eventTypeEl = row.querySelector('[class*="event-type"], [data-column="result_type"]');
      const eventType   = eventTypeEl ? eventTypeEl.textContent.trim() : 'Conversión_Auto';

      const statusEl = row.querySelector('[class*="delivery"], [data-column="delivery"]');
      const status   = statusEl ? statusEl.textContent.trim() : 'Active';

      rows.push({ campaign: name, spend, results, event_type: eventType, cpr, impressions, reach, status });
    });

    return rows;
  }, config.meta_ads.campaign_name_filter);

  if (campaigns.length === 0) {
    console.warn(`  ⚠ Meta Ads: tabla vacía para ${dateFrom}→${dateTo}.`);
  }

  await page.close();
  return campaigns;
}

async function applyDateRange(page, dateFrom, dateTo) {
  // Buscar y hacer click en el selector de rango de fechas de Meta Ads Manager
  const datePicker = await page.$('[aria-label*="Date range"], [data-testid="date-range"], button[class*="dateRange"]');
  if (!datePicker) return;

  await datePicker.click();
  await page.waitForTimeout(500);

  // Seleccionar rango personalizado si las fechas no son "ayer"
  const today = new Date();
  const yest  = new Date(today); yest.setDate(today.getDate() - 1);
  const yestStr = yest.toISOString().slice(0, 10);

  if (dateFrom === yestStr && dateTo === yestStr) {
    // Buscar opción "Ayer" en el dropdown
    const opt = await page.$('li[data-value="yesterday"], [data-preset="yesterday"], div:has-text("Ayer"), div:has-text("Yesterday")');
    if (opt) { await opt.click(); return; }
  }

  // Rango personalizado
  const custom = await page.$('div:has-text("Personalizar"), div:has-text("Custom range")');
  if (custom) {
    await custom.click();
    await page.waitForTimeout(300);

    // Escribir fechas en los inputs
    const inputs = await page.$$('input[type="text"][placeholder*="MM"], input[name*="date"]');
    if (inputs.length >= 2) {
      const fmt = (d) => d.replace(/-/g, '/'); // YYYY/MM/DD o MM/DD/YYYY según locale
      await inputs[0].triple_click();
      await inputs[0].type(fmt(dateFrom));
      await inputs[1].triple_click();
      await inputs[1].type(fmt(dateTo));

      const apply = await page.$('button:has-text("Aplicar"), button:has-text("Update"), button:has-text("Apply")');
      if (apply) await apply.click();
    }
  }

  await page.waitForTimeout(1000);
}
