// Inyecta el JSON de datos en template.html y produce:
//   - <repo>/index.html              (dashboard vigente)
//   - <repo>/archive/YYYY-MM-DD.html (snapshot del día)
// Uso: node generate/build-report.js [ruta-json]  (default: data/mock.json)

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const dataPath = resolve(REPO_ROOT, process.argv[2] || 'data/mock.json');
const templatePath = resolve(REPO_ROOT, 'generate/template.html');

const [rawData, template] = await Promise.all([
  readFile(dataPath, 'utf8'),
  readFile(templatePath, 'utf8')
]);

const data = JSON.parse(rawData);
// Escapar </script> y caracteres problemáticos dentro del JSON embebido
const safeJson = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const html = template.replace('__DATA_JSON__', safeJson);

const indexPath = resolve(REPO_ROOT, 'index.html');
await writeFile(indexPath, html, 'utf8');

const dateStamp = (data.date_range?.to || new Date().toISOString().slice(0, 10));
const archiveDir = resolve(REPO_ROOT, 'archive');
await mkdir(archiveDir, { recursive: true });
const archivePath = resolve(archiveDir, `${dateStamp}.html`);
await copyFile(indexPath, archivePath);

console.log(`✓ index.html generado (${html.length.toLocaleString()} chars)`);
console.log(`✓ archivo histórico: archive/${dateStamp}.html`);
