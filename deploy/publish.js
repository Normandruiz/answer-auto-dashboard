// Commit + push del HTML generado al repo GitHub → activa GitHub Pages.
// Requiere que el repo ya tenga `origin` apuntando a github.com/normandruiz/answer-auto-dashboard
// y que `gh auth status` esté OK o que git tenga credenciales configuradas.

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const run = (cmd) => {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });
};

const runCapture = (cmd) => execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

const today = new Date().toISOString().slice(0, 10);
const status = runCapture('git status --porcelain');
if (!status) {
  console.log('Sin cambios para commitear. Salida.');
  process.exit(0);
}

run('git add index.html archive/ data/ README.md');
try {
  run(`git commit -m "Reporte Auto ${today}"`);
} catch (e) {
  console.log('Nada nuevo que commitear después del add.');
  process.exit(0);
}

run('git push origin HEAD');
console.log('\n✓ Deploy completado');
console.log('URL pública: https://normandruiz.github.io/answer-auto-dashboard/');
