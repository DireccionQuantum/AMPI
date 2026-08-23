require('dotenv').config();
const puppeteer = require('puppeteer');
const { pool } = require('/home/claude/ampi/src/db');
const bcrypt = require('bcryptjs');

const BASE = 'http://localhost:3000';
const OUT = '/home/claude/ampi/capturas';
const CHROME = '/home/claude/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  // PIN conocido para poder entrar al escáner
  const pin = '4321';
  const { rows } = await pool.query(
    `UPDATE expositores SET pin_hash = $1
      WHERE id = (SELECT id FROM expositores ORDER BY id LIMIT 1)
      RETURNING token, nombre`,
    [await bcrypt.hash(pin, 10)]
  );
  const expo = rows[0];

  const browser = await puppeteer.launch({
    headless: 'shell', executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  // ---- Escáner con sesión activa ----
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 430, height: 932 });
  await p1.goto(`${BASE}/s/${expo.token}`, { waitUntil: 'networkidle2' });
  await p1.type('#pin', pin);
  await new Promise((r) => setTimeout(r, 3000));
  await p1.screenshot({ path: `${OUT}/scanner-activo.png` });
  console.log('  scanner-activo.png —', expo.nombre);

  // Simular el resultado de un escaneo exitoso para revisar la retroalimentación
  await p1.evaluate(() => {
    const el = document.getElementById('resultado');
    el.className = 'resultado r-ok';
    el.innerHTML = '<div class="icono">✓</div>' +
      '<div class="nombre">José García</div>' +
      '<div class="detalle">+1 punto · 9 boletos</div>';
    document.getElementById('c-total').textContent = '17';
    document.getElementById('c-hora').textContent = '6';
  });
  await new Promise((r) => setTimeout(r, 400));
  await p1.screenshot({ path: `${OUT}/scanner-exito.png` });
  console.log('  scanner-exito.png');

  // Estado duplicado
  await p1.evaluate(() => {
    const el = document.getElementById('resultado');
    el.className = 'resultado r-dup';
    el.innerHTML = '<div class="icono">↺</div>' +
      '<div class="nombre">Ana Muñoz</div>' +
      '<div class="detalle">Esta persona ya visitó tu módulo</div>';
    document.getElementById('aviso-datos').classList.remove('oculto');
  });
  await new Promise((r) => setTimeout(r, 400));
  await p1.screenshot({ path: `${OUT}/scanner-duplicado.png` });
  console.log('  scanner-duplicado.png');
  await p1.close();

  // ---- Estación con sesión de staff ----
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 820, height: 1150 });
  await p2.goto(`${BASE}/estacion`, { waitUntil: 'networkidle2' });
  await p2.type('#email', 'registro@quantummkt.mx');
  await p2.type('#pass', 'staff2026');
  await p2.click('#btn-login');
  await new Promise((r) => setTimeout(r, 2000));
  await p2.screenshot({ path: `${OUT}/estacion-activa.png` });
  console.log('  estacion-activa.png');

  // Registrar a alguien para ver la pantalla de entrega del código
  const tel = '664' + Math.floor(1000000 + Math.random() * 8999999);
  await p2.type('#nombre', 'Valeria');
  await p2.type('#apellido', 'Fuentes');
  await p2.type('#telefono', tel);
  await p2.click('#btn-registrar');
  await new Promise((r) => setTimeout(r, 2800));
  await p2.screenshot({ path: `${OUT}/estacion-codigo.png` });
  console.log('  estacion-codigo.png');
  await p2.close();

  // ---- Registro público ----
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 430, height: 1000 });
  await p3.goto(`${BASE}/registro`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await p3.screenshot({ path: `${OUT}/registro-form.png` });
  console.log('  registro-form.png');
  await p3.close();

  await browser.close();
  await pool.end();
})();
