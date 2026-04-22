// Inyecta el JSON de datos en template.html y produce:
//   - <repo>/index.html              (dashboard vigente)
//   - <repo>/archive/YYYY-MM-DD.html (snapshot del día)
// Uso: node generate/build-report.js [ruta-json]  (default: data/mock.json)

import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const dataPath = resolve(REPO_ROOT, process.argv[2] || 'data/mock.json');
const templatePath           = resolve(REPO_ROOT, 'generate/template.html');
const cotasSolasTemplatePath = resolve(REPO_ROOT, 'generate/cotas-solas-template.html');
const crossTemplatePath      = resolve(REPO_ROOT, 'generate/cross-template.html');

const [rawData, template, cotasSolasTemplate, crossTemplate] = await Promise.all([
  readFile(dataPath, 'utf8'),
  readFile(templatePath, 'utf8'),
  readFile(cotasSolasTemplatePath, 'utf8').catch(() => null),
  readFile(crossTemplatePath, 'utf8').catch(() => null)
]);

const data = JSON.parse(rawData);

// Acumula daily de archivos históricos para poblar gráfico de evolución mensual
const dataDir = resolve(REPO_ROOT, 'data');
try {
  const files = (await readdir(dataDir)).filter(f => f.endsWith('.json') && f !== basename(dataPath)).sort();
  for (const file of files) {
    try {
      const prev = JSON.parse(await readFile(resolve(dataDir, file), 'utf8'));
      for (const [k, v] of Object.entries(prev.cotas?.daily || {})) {
        if (!(k in data.cotas.daily)) data.cotas.daily[k] = v;
      }
      for (const [k, v] of Object.entries(prev.solas?.daily || {})) {
        if (!(k in data.solas.daily)) data.solas.daily[k] = v;
      }
    } catch { /* archivo corrupto, ignorar */ }
  }
  if (files.length) console.log(`  ✓ Acumulados ${files.length} archivos históricos`);
} catch { /* carpeta data vacía */ }

// Recalcular totals MTD a partir del daily acumulado (mes actual solamente)
const curMonth = (data.date_range?.from || data.date_range?.to || '').slice(0, 7);
if (curMonth) {
  const mtdCotas = Object.entries(data.cotas.daily).filter(([k]) => k.startsWith(curMonth)).reduce((s, [, v]) => s + v, 0);
  const mtdSolas = Object.entries(data.solas.daily).filter(([k]) => k.startsWith(curMonth)).reduce((s, [, v]) => s + v, 0);
  if (mtdCotas > 0) data.cotas.total = Math.round(mtdCotas);
  if (mtdSolas > 0) data.solas.total = Math.round(mtdSolas);
}
// Escapar </script> y caracteres problemáticos dentro del JSON embebido
const safeJson = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const html = template.replace('__DATA_JSON__', safeJson);

const indexPath = resolve(REPO_ROOT, 'index.html');
await writeFile(indexPath, html, 'utf8');

// Generar cotas-solas.html
if (cotasSolasTemplate) {
  const cotasSolasHtml = cotasSolasTemplate.replace('__DATA_JSON__', safeJson);
  const cotasSolasPath = resolve(REPO_ROOT, 'cotas-solas.html');
  await writeFile(cotasSolasPath, cotasSolasHtml, 'utf8');
  console.log(`✓ cotas-solas.html generado (${cotasSolasHtml.length.toLocaleString()} chars)`);
} else {
  console.warn('  ⚠ cotas-solas-template.html no encontrado — omitido');
}

// Generar cross.html
if (crossTemplate) {
  const crossHtml = crossTemplate.replace('__DATA_JSON__', safeJson);
  const crossPath = resolve(REPO_ROOT, 'cross.html');
  await writeFile(crossPath, crossHtml, 'utf8');
  console.log(`✓ cross.html generado (${crossHtml.length.toLocaleString()} chars)`);
} else {
  console.warn('  ⚠ cross-template.html no encontrado — omitido');
}

const dateStamp = (data.date_range?.to || new Date().toISOString().slice(0, 10));
const archiveDir = resolve(REPO_ROOT, 'archive');
await mkdir(archiveDir, { recursive: true });
const archivePath = resolve(archiveDir, `${dateStamp}.html`);
await copyFile(indexPath, archivePath);

console.log(`✓ index.html generado (${html.length.toLocaleString()} chars)`);
console.log(`✓ archivo histórico: archive/${dateStamp}.html`);
