'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool:', err.message);
});

/** Ejecuta una función dentro de una transacción, con rollback automático. */
async function enTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lee toda la tabla config como objeto plano. */
async function leerConfig(ejecutor = pool) {
  const { rows } = await ejecutor.query('SELECT clave, valor FROM config');
  const out = {};
  for (const r of rows) out[r.clave] = r.valor;
  return out;
}

const esSi = (v) => String(v).toLowerCase() === 'si';

module.exports = { pool, enTransaccion, leerConfig, esSi };
