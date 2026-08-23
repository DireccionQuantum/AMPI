'use strict';

/**
 * Operación del módulo Quantum — AMPI 2026
 *
 * Cubre lo que pasa en la mesa el día del evento:
 *   - buscar al asistente por nombre para entregarle su carnet
 *   - marcar la entrega (quién la hizo y cuándo)
 *   - saber qué etiquetas faltan por imprimir
 *   - marcar impresas por lote, para no reimprimir de más
 *
 * Todo lo delicado se resuelve del lado del servidor: el navegador nunca
 * decide quién ya recibió su etiqueta.
 */

const LIMITE_BUSQUEDA = 25;
const LOTE_MAX = 500;

/** Normaliza lo que teclea el practicante: sin acentos, sin ruido. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Busca por nombre, apellido, empresa o código corto.
 * Pensado para escribir poco: "her" ya encuentra a Hernández.
 */
async function buscar(db, termino) {
  const q = normalizar(termino);
  if (q.length < 2) return [];

  const palabras = q.split(' ').slice(0, 4);
  // Cada palabra debe aparecer en algún campo. Prefijo, no palabra exacta.
  const condiciones = palabras.map((_, i) => `
    (unaccent_simple(coalesce(nombre,'') || ' ' || coalesce(apellido,'') || ' ' || coalesce(empresa,''))
       LIKE '%' || $${i + 1} || '%')`).join(' AND ');

  const { rows } = await db.query(
    `SELECT id, qr_id, nombre, apellido, empresa, codigo_corto, telefono,
            estado, origen, etiqueta_impresa_en, entregado_en, entregado_por
       FROM asistentes
      WHERE ${condiciones}
         OR upper(coalesce(codigo_corto,'')) = upper($${palabras.length + 1})
      ORDER BY entregado_en NULLS FIRST, apellido, nombre
      LIMIT ${LIMITE_BUSQUEDA}`,
    [...palabras, termino.trim()]
  );
  return rows;
}

/** Marca la entrega del carnet. Idempotente: reentregar no duplica nada. */
async function entregar(db, id, quien) {
  const { rows } = await db.query(
    `UPDATE asistentes
        SET entregado_en  = COALESCE(entregado_en, now()),
            entregado_por = COALESCE(entregado_por, $2)
      WHERE id = $1
      RETURNING id, nombre, apellido, entregado_en, entregado_por`,
    [id, String(quien || 'módulo').slice(0, 40)]
  );
  return rows[0] || null;
}

/** Deshace una entrega marcada por error. */
async function desentregar(db, id) {
  const { rows } = await db.query(
    `UPDATE asistentes SET entregado_en = NULL, entregado_por = NULL
      WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Lista para imprimir etiquetas.
 * @param {string} filtro  'pendientes' | 'todos'
 */
async function paraImprimir(db, { filtro = 'pendientes', limite = LOTE_MAX } = {}) {
  const lim = Math.min(Math.max(parseInt(limite, 10) || LOTE_MAX, 1), LOTE_MAX);
  const cond = filtro === 'todos' ? '' : 'WHERE etiqueta_impresa_en IS NULL';
  const { rows } = await db.query(
    `SELECT id, qr_id, nombre, apellido, empresa, codigo_corto, etiqueta_impresa_en
       FROM asistentes
       ${cond}
      ORDER BY apellido NULLS LAST, nombre
      LIMIT ${lim}`
  );
  return rows;
}

/** Marca un lote como impreso. Recibe ids; ignora los que no existan. */
async function marcarImpresas(db, ids) {
  const limpios = (Array.isArray(ids) ? ids : [])
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, LOTE_MAX);
  if (!limpios.length) return { marcadas: 0 };

  const { rowCount } = await db.query(
    `UPDATE asistentes
        SET etiqueta_impresa_en = COALESCE(etiqueta_impresa_en, now())
      WHERE id = ANY($1::int[])`,
    [limpios]
  );
  return { marcadas: rowCount };
}

/** Panorama para el tablero del módulo. */
async function panorama(db) {
  const { rows } = await db.query('SELECT * FROM v_operacion_modulo');
  return rows[0];
}

module.exports = {
  normalizar,
  buscar,
  entregar,
  desentregar,
  paraImprimir,
  marcarImpresas,
  panorama,
  LIMITE_BUSQUEDA,
  LOTE_MAX,
};
