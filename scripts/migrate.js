'use strict';

/**
 * Aplica los archivos de sql/ en orden. Se ejecuta en cada despliegue
 * (pre-deploy de Railway), así que todos los archivos están escritos para
 * poder correr muchas veces sin romper nada.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

// En Railway, la red privada del contenedor tarda unos segundos en quedar
// lista. El pre-deploy arranca antes de eso, así que el primer intento de
// conexión puede fallar aunque la base esté perfectamente. Reintentamos en
// lugar de tumbar el despliegue por unos segundos de diferencia.
const INTENTOS = 8;
const ESPERA_MS = 3000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarBase() {
  for (let i = 1; i <= INTENTOS; i++) {
    try {
      await pool.query('SELECT 1');
      if (i > 1) console.log(`  Base disponible en el intento ${i}.`);
      return true;
    } catch (err) {
      const ultimo = i === INTENTOS;
      console.log(
        `  Base no disponible (intento ${i}/${INTENTOS}): ${err.code || err.message}` +
        (ultimo ? '' : ` — reintento en ${ESPERA_MS / 1000}s`)
      );
      if (ultimo) {
        console.error('\n  No se pudo conectar a la base de datos.');
        console.error('  Revisa que DATABASE_URL esté definida en las variables');
        console.error('  del servicio y que apunte al Postgres del proyecto.');
        const url = process.env.DATABASE_URL || '';
        console.error(`  DATABASE_URL ${url ? 'sí está definida' : 'NO está definida'}` +
                      (url ? ` (host: ${(url.split('@')[1] || '').split(':')[0] || '?'})` : ''));
        return false;
      }
      await dormir(ESPERA_MS);
    }
  }
  return false;
}

(async () => {
  if (!(await esperarBase())) {
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const dir = path.join(__dirname, '..', 'sql');
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const archivo of archivos) {
    process.stdout.write(`  ${archivo} … `);
    const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');
    try {
      await pool.query(sql);
      console.log('ok');
    } catch (err) {
      console.log('ERROR');
      // Detalle completo: en el log del despliegue esto es lo único que
      // se ve, así que conviene que diga todo lo que se sabe.
      console.error(`  mensaje : ${err.message}`);
      if (err.code)   console.error(`  código  : ${err.code}`);
      if (err.detail) console.error(`  detalle : ${err.detail}`);
      if (err.hint)   console.error(`  sugerencia: ${err.hint}`);
      if (err.position) console.error(`  posición: ${err.position}`);
      await pool.end().catch(() => {});
      process.exit(1);
    }
  }

  console.log('\nMigración completa.');
  await pool.end();
})().catch(async (err) => {
  console.error('\nError inesperado en la migración:', err && err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
