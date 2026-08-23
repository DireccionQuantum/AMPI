'use strict';

/**
 * Motor de escaneo, puntos y boletos — Gamificación AMPI 2026
 *
 * Regla no negociable: los puntos SIEMPRE se leen de la base de datos.
 * Nunca se acepta un valor de puntos enviado por el navegador.
 */

const { leerConfig } = require('../db');
const { resolverAsistente } = require('./vinculacion');

/** Folio legible y correlativo: AMPI-000042 */
async function siguienteFolio(client) {
  const { rows } = await client.query(`SELECT nextval('seq_folio') AS n`);
  return 'AMPI-' + String(rows[0].n).padStart(6, '0');
}

/**
 * Genera los boletos que le correspondan al asistente según sus puntos
 * acumulados, descontando los que ya tiene. Idempotente por diseño:
 * si se llama dos veces, la segunda no crea nada de más.
 */
async function sincronizarBoletos(client, asistenteId, puntosPorBoleto, escaneoId) {
  const { rows } = await client.query(
    `SELECT COALESCE((SELECT SUM(puntos) FROM escaneos WHERE asistente_id = $1), 0) AS puntos,
            (SELECT COUNT(*) FROM boletos  WHERE asistente_id = $1) AS boletos`,
    [asistenteId]
  );

  const puntos = Number(rows[0].puntos);
  const actuales = Number(rows[0].boletos);
  const objetivo = Math.floor(puntos / puntosPorBoleto);
  const faltantes = objetivo - actuales;
  if (faltantes <= 0) return [];

  const nuevos = [];
  for (let i = 0; i < faltantes; i++) {
    const folio = await siguienteFolio(client);
    const { rows: r } = await client.query(
      `INSERT INTO boletos (asistente_id, escaneo_id, folio)
            VALUES ($1, $2, $3) RETURNING id, folio`,
      [asistenteId, escaneoId || null, folio]
    );
    nuevos.push(r[0]);
  }
  return nuevos;
}

/**
 * Registra un escaneo completo. Todo ocurre en una transacción para que
 * nunca queden puntos sin boleto ni boletos sin punto.
 *
 * Códigos de resultado:
 *   ok             — escaneo válido, puntos sumados
 *   duplicado      — ese asistente ya visitó ese módulo
 *   expositor      — token de expositor inválido o inactivo
 */
async function registrarEscaneo(client, { qrId, expositorId, origen = 'scanner' }) {
  const cfg = await leerConfig(client);
  const puntosPorBoleto = Math.max(1, Number(cfg.puntos_por_boleto || 1));

  // Bloqueamos la fila del expositor: evita carreras si dos scanners
  // del mismo módulo procesan a la vez.
  const expo = await client.query(
    `SELECT id, nombre, puntos, activo FROM expositores
      WHERE id = $1 FOR UPDATE`,
    [expositorId]
  );
  if (!expo.rows.length || !expo.rows[0].activo) {
    return { resultado: 'expositor' };
  }
  const expositor = expo.rows[0];

  // Crea al asistente si no lo conocemos: el punto no se pierde.
  const { asistente, esNuevo, requiereDatos } = await resolverAsistente(client, qrId);

  // ON CONFLICT DO NOTHING implementa la regla "una vez por módulo".
  const ins = await client.query(
    `INSERT INTO escaneos (asistente_id, expositor_id, puntos, origen)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT ON CONSTRAINT uq_escaneo DO NOTHING
      RETURNING id`,
    [asistente.id, expositor.id, expositor.puntos, origen]
  );

  if (!ins.rows.length) {
    const totales = await totalesDe(client, asistente.id);
    return {
      resultado: 'duplicado',
      asistente: { ...asistente, ...totales },
      expositor: { id: expositor.id, nombre: expositor.nombre },
      requiereDatos,
    };
  }

  const escaneoId = ins.rows[0].id;
  const boletosNuevos = await sincronizarBoletos(
    client, asistente.id, puntosPorBoleto, escaneoId
  );
  const totales = await totalesDe(client, asistente.id);

  return {
    resultado: 'ok',
    escaneoId,
    esNuevo,
    requiereDatos,
    puntosGanados: expositor.puntos,
    boletosNuevos,
    asistente: { ...asistente, ...totales },
    expositor: { id: expositor.id, nombre: expositor.nombre },
  };
}

/** Totales actuales de un asistente. */
async function totalesDe(ejecutor, asistenteId) {
  const { rows } = await ejecutor.query(
    `SELECT modulos, puntos, boletos FROM v_asistentes WHERE id = $1`,
    [asistenteId]
  );
  const r = rows[0] || {};
  return {
    modulos: Number(r.modulos || 0),
    puntos: Number(r.puntos || 0),
    boletos: Number(r.boletos || 0),
  };
}

/** Módulos visitados y pendientes — lo que empuja al asistente a caminar. */
async function progresoDe(ejecutor, qrId) {
  const { rows } = await ejecutor.query(
    `SELECT x.id, x.nombre, x.empresa, x.puntos,
            (e.id IS NOT NULL) AS visitado, e.creado_en AS visitado_en
       FROM expositores x
       LEFT JOIN escaneos e
              ON e.expositor_id = x.id
             AND e.asistente_id = (SELECT id FROM asistentes WHERE qr_id = $1)
      WHERE x.activo = true
      ORDER BY x.orden, x.nombre`,
    [qrId]
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    empresa: r.empresa,
    puntos: r.puntos,
    visitado: r.visitado,
    visitado_en: r.visitado_en,
  }));
}

/** Métricas globales para el dashboard y la pantalla de proyección. */
async function metricas(ejecutor) {
  const { rows } = await ejecutor.query(`
    SELECT
      (SELECT COUNT(*) FROM asistentes)                          AS asistentes,
      (SELECT COUNT(*) FROM asistentes WHERE estado='verificado') AS verificados,
      (SELECT COUNT(*) FROM asistentes WHERE estado='pendiente')  AS pendientes,
      (SELECT COUNT(*) FROM escaneos)                            AS escaneos,
      (SELECT COUNT(*) FROM boletos)                             AS boletos,
      (SELECT COUNT(*) FROM expositores WHERE activo)            AS expositores,
      (SELECT COUNT(*) FROM rifas WHERE estado='pendiente')      AS rifas_pendientes,
      (SELECT COUNT(*) FROM ganadores)                           AS ganadores,
      (SELECT COUNT(*) FROM escaneos
         WHERE creado_en > now() - interval '15 minutes')        AS escaneos_15min
  `);
  const r = rows[0];
  const out = {};
  for (const k of Object.keys(r)) out[k] = Number(r[k]);
  return out;
}

module.exports = {
  siguienteFolio,
  sincronizarBoletos,
  registrarEscaneo,
  totalesDe,
  progresoDe,
  metricas,
};
