/**
 * run.js — Pipeline diario completo
 *
 * Orden: extract → merge → generate → (deploy → email, opcional)
 *
 * Uso manual:    node run.js
 * Solo extract:  node run.js --extract-only
 * Sin deploy:    node run.js --no-deploy
 * Sin email:     node run.js --no-email
 */

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname }  from 'node:path';
import { fileURLToPath }     from 'node:url';
import { execSync }          from 'node:child_process';

import { extractGoogleAds }  from './extract/google-ads.js';
import { extractMetaAds }    from './extract/meta-ads.js';
import { extractGoogleSheet } from './extract/google-sheet.js';
import { mergeData }         from './process/merge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;

const args        = process.argv.slice(2);
const EXTRACT_ONLY = args.includes('--extract-only');
const NO_DEPLOY    = args.includes('--no-deploy');
const NO_EMAIL     = args.includes('--no-email');

// ── Fechas ──────────────────────────────────────────────────────────────────
const today     = new Date();
today.setHours(0, 0, 0, 0);

const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

const mtdFrom   = new Date(today.getFullYear(), today.getMonth(), 1);

const fmt       = (d) => d.toISOString().slice(0, 10);
const DATE_AYER = fmt(yesterday);
const DATE_MTD  = fmt(mtdFrom);

console.log(`\n═══════════════════════════════════════`);
console.log(` Answer Seguros — Pipeline AUTO`);
console.log(` Ayer: ${DATE_AYER} | MTD desde: ${DATE_MTD}`);
console.log(`═══════════════════════════════════════\n`);

// ── 1. EXTRACT ───────────────────────────────────────────────────────────────
console.log('[ 1/4 ] Extrayendo datos...\n');

let googleAds, metaAds, sheet;

try {
  console.log('  → Google Ads...');
  googleAds = await extractGoogleAds(DATE_AYER, DATE_MTD);
  console.log(`     ✓ Ayer: ${googleAds.ayer.length} campañas | MTD: ${googleAds.mtd.length} campañas`);
} catch (e) {
  console.error('  ✗ Google Ads falló:', e.message);
  googleAds = { ayer: [], mtd: [] };
}

try {
  console.log('  → Meta Ads...');
  metaAds = await extractMetaAds(DATE_AYER, DATE_MTD);
  console.log(`     ✓ Ayer: ${metaAds.ayer.length} campañas | MTD: ${metaAds.mtd.length} campañas`);
} catch (e) {
  console.error('  ✗ Meta Ads falló:', e.message);
  metaAds = { ayer: [], mtd: [] };
}

try {
  console.log('  → Google Sheet (cotas/solas)...');
  sheet = await extractGoogleSheet();
  console.log(`     ✓ Cotas: ${sheet.cotas.total} | Solas: ${sheet.solas.total}`);
} catch (e) {
  console.error('  ✗ Google Sheet falló:', e.message);
  sheet = { cotas: { total: 0, by_platform: {}, daily: {} }, solas: { total: 0, by_platform: {}, daily: {} } };
}

// ── Fallback histórico: si campañas o sheet vacíos, usar último JSON bueno ────
async function loadLastGoodJSON(excludeDate) {
  const dataDir = resolve(ROOT, 'data');
  try {
    const files = (await readdir(dataDir))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${excludeDate}.json`)
      .sort().reverse();
    for (const f of files) {
      const raw = JSON.parse(await readFile(resolve(dataDir, f), 'utf8'));
      if (raw.google_ads?.length || raw.meta_ads?.length) {
        return { date: f.replace('.json', ''), data: raw };
      }
    }
  } catch {}
  return null;
}

const needsCampaignFallback = !googleAds.mtd.length && !metaAds.mtd.length;
const needsSheetFallback    = sheet.cotas.total === 0;

if (needsCampaignFallback || needsSheetFallback) {
  const fallback = await loadLastGoodJSON(DATE_AYER);
  if (fallback) {
    if (needsCampaignFallback && (fallback.data.google_ads?.length || fallback.data.meta_ads?.length)) {
      googleAds = {
        mtd:  fallback.data.google_ads       || [],
        ayer: fallback.data.google_ads_ayer  || []
      };
      metaAds = {
        mtd:  fallback.data.meta_ads         || [],
        ayer: fallback.data.meta_ads_ayer    || []
      };
      console.log(`  → Campañas: usando datos históricos de ${fallback.date} (scraping vacío hoy)`);
    }
    if (needsSheetFallback && fallback.data.cotas?.total > 0) {
      sheet = { cotas: fallback.data.cotas, solas: fallback.data.solas };
      console.log(`  → Cotas/Solas: usando datos históricos de ${fallback.date} (Sheet no disponible hoy)`);
    }
  }
}

// Guardar snapshot raw
await mkdir(resolve(ROOT, 'data'), { recursive: true });
const rawPath = resolve(ROOT, `data/${DATE_AYER}.json`);
const merged  = mergeData({ googleAds, metaAds, sheet });
await writeFile(rawPath, JSON.stringify(merged, null, 2), 'utf8');
console.log(`\n  ✓ Datos guardados en data/${DATE_AYER}.json`);

if (EXTRACT_ONLY) {
  console.log('\n  --extract-only: terminado.\n');
  process.exit(0);
}

// ── 2. GENERATE ─────────────────────────────────────────────────────────────
console.log('\n[ 2/4 ] Generando dashboard...');
execSync(`node generate/build-report.js data/${DATE_AYER}.json`, { cwd: ROOT, stdio: 'inherit' });

// ── 3. DEPLOY ───────────────────────────────────────────────────────────────
if (!NO_DEPLOY) {
  console.log('\n[ 3/4 ] Publicando en GitHub Pages...');
  try {
    execSync('node deploy/publish.js', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('  ⚠ Deploy falló (no crítico):', e.message);
  }
} else {
  console.log('\n[ 3/4 ] Deploy omitido (--no-deploy).');
}

// ── 4. EMAIL ────────────────────────────────────────────────────────────────
if (!NO_EMAIL) {
  console.log('\n[ 4/4 ] Enviando email...');
  try {
    execSync('node send/email.js', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('  ⚠ Email falló (no crítico):', e.message);
  }
} else {
  console.log('\n[ 4/4 ] Email omitido (--no-email).');
}

console.log('\n✓ Pipeline completado.\n');
