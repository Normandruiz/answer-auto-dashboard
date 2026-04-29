/**
 * setup-auth.js — Ejecutar UNA SOLA VEZ para guardar la sesión de Chrome.
 *
 * Cómo usar:
 *   node extract/setup-auth.js
 *
 * Abre Chrome, iniciá sesión en Google Ads y en Meta Ads Manager,
 * después presioná ENTER en la terminal. El script guarda la sesión
 * en .auth-profile/ para que los extractores la reusen sin login manual.
 *
 * Repetir solo si la sesión expira (normalmente dura varias semanas).
 */

import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dirname, '..');
const AUTH_DIR = resolve(ROOT, '.auth-profile');

const config = JSON.parse(await readFile(resolve(ROOT, 'config.json'), 'utf8'));

await mkdir(AUTH_DIR, { recursive: true });

const browser = await chromium.launchPersistentContext(AUTH_DIR, {
  channel:  'chrome',
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
});

const page = await browser.newPage();

// 1. Google Ads
const gaParams = new URLSearchParams({
  ocid: config.google_ads.ocid,
  ...config.google_ads.auth_params,
});
console.log('\n→ Abriendo Google Ads...');
await page.goto(`${config.google_ads.base_url}?${gaParams}`);

await ask('\n[1/2] Iniciá sesión en Google Ads si no estás logueado.\nCuando veas las campañas, presioná ENTER aquí...');

// 2. Meta Ads
const metaUrl = `${config.meta_ads.base_url}?act=${config.meta_ads.ad_account_id}`;
console.log('\n→ Abriendo Meta Ads Manager...');
await page.goto(metaUrl);

await ask('\n[2/2] Iniciá sesión en Meta Ads Manager si no estás logueado.\nCuando veas las campañas, presioná ENTER aquí...');

await browser.close();
console.log('\n✓ Sesión guardada en .auth-profile/ — el extractor la usará automáticamente.\n');

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => { rl.close(); resolve(); });
  });
}
