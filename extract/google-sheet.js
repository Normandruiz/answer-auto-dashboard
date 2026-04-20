/**
 * extract/google-sheet.js
 *
 * Lee el Google Sheet interno con cotas (cotizaciones) y solas (ventas ecommerce).
 * Exporta cada tab como CSV directamente desde Google Sheets export URL,
 * usando la sesión de Google ya logueada en el perfil .auth-profile/.
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

export async function extractGoogleSheet() {
  const config = JSON.parse(await readFile(resolve(ROOT, 'config.json'), 'utf8'));
  const { sheet_id, tabs } = config.google_sheet;

  const browser = await chromium.launchPersistentContext(AUTH_DIR, {
    channel:  'chrome',
    headless: true,
    viewport: { width: 1400, height: 900 },
  });

  try {
    const cotasRaw = await fetchSheetTab(browser, sheet_id, tabs.cotas);
    const solasRaw = await fetchSheetTab(browser, sheet_id, tabs.solas);

    const cotas = parseSheetData(cotasRaw, config.google_sheet.filter_ecommerce);
    const solas = parseSheetData(solasRaw, null);

    return { cotas, solas };
  } finally {
    await browser.close();
  }
}

async function fetchSheetTab(browser, sheetId, tabName) {
  const page = await browser.newPage();

  // Primero navegar al sheet para obtener el gid (id de la pestaña)
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  await page.goto(sheetUrl, { waitUntil: 'networkidle', timeout: 30_000 });

  // Encontrar el gid de la pestaña por nombre
  const gid = await page.evaluate((targetTab) => {
    const tabs = document.querySelectorAll('.docs-sheet-tab, [id^="sheet-tab-"]');
    for (const tab of tabs) {
      if (tab.textContent.trim().toLowerCase().includes(targetTab.toLowerCase())) {
        // El ID del tab tiene el gid
        const match = tab.id?.match(/\d+/) || tab.getAttribute('data-id')?.match(/\d+/);
        return match ? match[0] : null;
      }
    }
    return null;
  }, tabName);

  let csvContent = '';

  if (gid) {
    // Descargar CSV de esa pestaña específica
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const response = await page.goto(csvUrl, { waitUntil: 'load', timeout: 20_000 });
    csvContent = await response.text();
  } else {
    // Fallback: intentar leer la tabla directamente desde la UI
    console.warn(`  ⚠ No se encontró la pestaña "${tabName}" — intentando leer UI...`);
    await page.goto(sheetUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    csvContent = await page.evaluate((targetTab) => {
      const rows = [];
      document.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td, th')].map(c => `"${c.textContent.trim()}"`);
        if (cells.length) rows.push(cells.join(','));
      });
      return rows.join('\n');
    }, tabName);
  }

  await page.close();
  return csvContent;
}

function parseSheetData(csv, filterEcommerce) {
  if (!csv) return { total: 0, by_platform: {}, by_campaign_code: {}, daily: {} };

  const lines = csv.split('\n').map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
  if (lines.length < 2) return { total: 0, by_platform: {}, by_campaign_code: {}, daily: {} };

  // Normalizar headers: minúsculas + quitar tildes para match robusto
  const norm    = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const headers = lines[0].map(norm);

  // Detectar columnas clave
  const iDate  = headers.findIndex(h => h.includes('fecha') || h.includes('date'));
  // "Código Campaña" → "codigo campana" después de normalizar
  const iCode  = headers.findIndex(h => (h.includes('codigo') || h.includes('code')) && (h.includes('camp') || h.includes('cod')));
  // "Campaña" → "campana" (sin el prefijo "codigo")
  const iCamp  = headers.findIndex(h => (h.includes('campana') || h.includes('campaign')) && !h.includes('codigo') && !h.includes('code'));
  // "Plataforma" → agrupar by_platform por esta columna
  const iPlat  = headers.findIndex(h => h.includes('plataforma') || h.includes('platform') || h.includes('origen'));
  const iCount = headers.findIndex(h => h.includes('cotizaciones') || h.includes('solas') || h.includes('cantidad') || h.includes('count') || h.includes('total'));
  const iEcomm = headers.findIndex(h => h.includes('ecommerce') || h.includes('canal'));

  const daily          = {};
  const byPlatform     = {};
  const byCampaignCode = {};
  let total            = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length < 2) continue;

    // Filtro ecommerce si aplica
    if (filterEcommerce && iEcomm >= 0) {
      if (norm(row[iEcomm] || '') !== norm(filterEcommerce)) continue;
    }

    const date  = iDate  >= 0 ? row[iDate]  : '';
    const code  = iCode  >= 0 ? row[iCode]  : '';
    const camp  = iCamp  >= 0 ? row[iCamp]  : '';
    // Plataforma para by_platform; si no hay columna plataforma, cae en campaña o "Otros"
    const plat  = iPlat  >= 0 ? row[iPlat]  : (iCamp >= 0 ? row[iCamp] : 'Otros');
    const count = iCount >= 0 ? parseFloat(row[iCount]) || 0 : 0;

    total += count;

    if (date) {
      const d = normalizeDate(date);
      if (d) daily[d] = (daily[d] || 0) + count;
    }

    // by_platform agrupa por Plataforma
    const platKey = plat || 'Otros';
    byPlatform[platKey] = (byPlatform[platKey] || 0) + count;

    // by_campaign_code agrupa por Código Campaña (solo si existe la columna)
    if (code) {
      if (!byCampaignCode[code]) {
        byCampaignCode[code] = { campaign: camp, plataforma: platKey, cotas: 0 };
      }
      byCampaignCode[code].cotas += count;
    }
  }

  // Redondear cotas de cada código
  for (const k of Object.keys(byCampaignCode)) {
    byCampaignCode[k].cotas = Math.round(byCampaignCode[k].cotas);
  }

  return { total: Math.round(total), by_platform: byPlatform, by_campaign_code: byCampaignCode, daily };
}

function normalizeDate(raw) {
  // Acepta formatos: DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY
  if (!raw) return null;
  const parts = raw.split(/[-/]/);
  if (parts.length !== 3) return null;

  let y, m, d;
  if (parts[0].length === 4) { [y, m, d] = parts; }
  else if (parseInt(parts[0]) > 12) { [d, m, y] = parts; }
  else { [m, d, y] = parts; }

  if (!y || !m || !d) return null;
  return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}
