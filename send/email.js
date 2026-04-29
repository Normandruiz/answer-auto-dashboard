/**
 * send/email.js — Envía el reporte diario por email usando nodemailer + Gmail.
 * Requiere .env con: GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_RECIPIENTS
 */

import nodemailer from 'nodemailer';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(ROOT, '.env') });

const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_RECIPIENTS } = process.env;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('  ✗ Email: faltan GMAIL_USER o GMAIL_APP_PASSWORD en .env');
  process.exit(1);
}

// Lee el JSON del día para incluir métricas en el cuerpo
const config  = JSON.parse(await readFile(resolve(ROOT, 'config.json'), 'utf8'));
const pagesUrl = config.github.pages_url;

// Busca el último JSON en data/
const dataDir = resolve(ROOT, 'data');
let data = null;
try {
  const today = new Date();
  today.setHours(0,0,0,0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0,10);
  data = JSON.parse(await readFile(resolve(dataDir, `${dateStr}.json`), 'utf8'));
} catch {
  // fallback: no adjuntar métricas
}

const fmtARS = n => n ? `$${Math.round(n).toLocaleString('es-AR')}` : '—';
const fmtNum = n => n != null ? Math.round(n).toLocaleString('es-AR') : '—';

const gSpend = data?.google_ads?.reduce((s,c) => s + c.spend, 0) ?? 0;
const mSpend = data?.meta_ads?.reduce((s,c) => s + c.spend, 0) ?? 0;
const gConv  = data?.google_ads?.reduce((s,c) => s + c.conversions, 0) ?? 0;
const mConv  = data?.meta_ads?.reduce((s,c) => s + (c.results || 0), 0) ?? 0;
const cotas  = data?.cotas?.total ?? 0;
const solas  = data?.solas?.total ?? 0;
const dateLabel = data?.date_range?.label ?? new Date().toLocaleDateString('es-AR');

const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <h2 style="background:#003399;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;margin:0">
    Answer Seguros Auto — ${dateLabel}
  </h2>
  <div style="padding:20px;background:#f9f9f9;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#e8f0fe">
        <th style="padding:8px;text-align:left;border:1px solid #ccc">Plataforma</th>
        <th style="padding:8px;text-align:right;border:1px solid #ccc">Gasto MTD</th>
        <th style="padding:8px;text-align:right;border:1px solid #ccc">Conversiones MTD</th>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #ccc">Google Ads</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtARS(gSpend)}</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtNum(gConv)}</td>
      </tr>
      <tr style="background:#f5f5f5">
        <td style="padding:8px;border:1px solid #ccc">Meta Ads</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtARS(mSpend)}</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtNum(mConv)}</td>
      </tr>
      <tr style="font-weight:bold;background:#e8f0fe">
        <td style="padding:8px;border:1px solid #ccc">Total</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtARS(gSpend + mSpend)}</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtNum(gConv + mConv)}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#e8f0fe">
        <th style="padding:8px;text-align:left;border:1px solid #ccc">Sheet</th>
        <th style="padding:8px;text-align:right;border:1px solid #ccc">Total MTD</th>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #ccc">Cotas</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtNum(cotas)}</td>
      </tr>
      <tr style="background:#f5f5f5">
        <td style="padding:8px;border:1px solid #ccc">Solas Ecommerce</td>
        <td style="padding:8px;text-align:right;border:1px solid #ccc">${fmtNum(solas)}</td>
      </tr>
    </table>
    <p style="text-align:center;margin-top:24px">
      <a href="${pagesUrl}" style="background:#003399;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-weight:bold">
        Ver Dashboard Completo
      </a>
    </p>
    <p style="font-size:11px;color:#999;margin-top:16px;text-align:center">
      Generado automáticamente por el pipeline Answer Auto · Beyond Media Agency
    </p>
  </div>
</div>`;

const recipients = EMAIL_RECIPIENTS
  ? EMAIL_RECIPIENTS.split(',').map(e => e.trim())
  : [GMAIL_USER];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

await transporter.sendMail({
  from: `"Answer Auto Dashboard" <${GMAIL_USER}>`,
  to: recipients.join(', '),
  subject: `Answer Auto — ${dateLabel}`,
  html,
});

console.log(`  ✓ Email enviado a: ${recipients.join(', ')}`);
