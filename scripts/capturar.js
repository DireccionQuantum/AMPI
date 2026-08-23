require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'http://localhost:3000';
const OUT = '/home/claude/ampi/capturas';

const PANTALLAS = [
  { url: '/',          nombre: 'portada',   w: 430,  h: 932 },
  { url: '/registro',  nombre: 'registro',  w: 430,  h: 932 },
  { url: '/scan',      nombre: 'scanner',   w: 430,  h: 932 },
  { url: '/estacion',  nombre: 'estacion',  w: 820,  h: 1100 },
  { url: '/admin',     nombre: 'admin',     w: 1440, h: 950 },
  { url: '/pantalla',  nombre: 'proyeccion',w: 1920, h: 1080 },
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'shell',
    executablePath: '/home/claude/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const errores = [];

  for (const p of PANTALLAS) {
    const page = await browser.newPage();
    await page.setViewport({ width: p.w, height: p.h, deviceScaleFactor: 1 });

    page.on('pageerror', (e) => errores.push(`${p.nombre}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|net::ERR/.test(m.text())) {
        errores.push(`${p.nombre} [consola]: ${m.text()}`);
      }
    });
    page.on('requestfailed', (r) => errores.push(`${p.nombre} [falla] ${r.url()}`));
    page.on('response', (r) => {
      if (r.status() >= 400) errores.push(`${p.nombre} [HTTP ${r.status()}] ${r.url()}`);
    });

    await page.goto(BASE + p.url, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1800));
    await page.screenshot({ path: `${OUT}/${p.nombre}.png` });
    console.log(`  ${p.nombre}.png (${p.w}x${p.h})`);
    await page.close();
  }

  // Estados con sesión iniciada
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await page.type('#email', 'admin@quantummkt.mx');
  await page.type('#pass', 'ampi2026');
  await page.click('#btn-login');
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/admin-tablero.png` });
  console.log('  admin-tablero.png');

  await page.click('.tab[data-p="rifas"]');
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: `${OUT}/admin-rifas.png` });
  console.log('  admin-rifas.png');

  await page.close();

  // Panel del asistente con datos reales
  const { pool } = require('/home/claude/ampi/src/db');
  const { rows } = await pool.query(
    `SELECT qr_id FROM v_asistentes WHERE estado='verificado' AND puntos > 5
      ORDER BY puntos DESC LIMIT 1`);
  if (rows.length) {
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 430, height: 1400 });
    await p2.goto(`${BASE}/a/${rows[0].qr_id}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2500));
    await p2.screenshot({ path: `${OUT}/panel-asistente.png` });
    console.log('  panel-asistente.png');
    await p2.close();
  }
  await pool.end();

  await browser.close();

  if (errores.length) {
    console.log('\n  ERRORES DE JAVASCRIPT:');
    [...new Set(errores)].forEach((e) => console.log('    - ' + e));
  } else {
    console.log('\n  Sin errores de JavaScript en ninguna pantalla.');
  }
})();
