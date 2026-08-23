'use strict';

/**
 * Motor de sorteos — Gamificación AMPI 2026
 *
 * Reglas de diseño:
 *
 *  1. Se sortea por BOLETO, no por persona. Quien visitó 20 módulos tiene
 *     20 veces más probabilidad que quien visitó uno. Es lo que hace que
 *     valga la pena caminar.
 *  2. Aleatoriedad con crypto, no con Math.random.
 *  3. Un asistente no puede salir dos veces en la misma rifa.
 *  4. Sólo participa quien podemos contactar (verificado), configurable.
 *  5. La rifa se bloquea en la base durante el sorteo: aunque el admin
 *     dé doble clic o el scheduler coincida, se ejecuta una sola vez.
 */

const crypto = require('crypto');
const { leerConfig, esSi } = require('../db');

/** Entero aleatorio en [0, max) sin sesgo de módulo. */
function aleatorioSeguro(max) {
  if (max <= 0) throw new RangeError('max debe ser positivo');
  if (max === 1) return 0;
  const bytes = 6;                       // 48 bits de entropía
  const rango = 2 ** (bytes * 8);
  const limite = rango - (rango % max);
  let v;
  do {
    v = crypto.randomBytes(bytes).readUIntBE(0, bytes);
  } while (v >= limite);
  return v % max;
}

/**
 * Boletos elegibles para una rifa, ya filtrados por las reglas activas.
 * Devuelve una fila por boleto: así el sorteo queda ponderado solo.
 */
async function boletosElegibles(client, rifa, cfg) {
  const soloVerificados = esSi(cfg.solo_verificados);
  const excluirGanadores = esSi(cfg.excluir_ganadores);
  const minModulos = Math.max(
    Number(rifa.min_modulos || 0),
    Number(cfg.min_modulos_rifa || 0)
  );

  const filtros = ['1=1'];
  const params = [];

  if (soloVerificados) filtros.push(`a.estado = 'verificado'`);

  if (minModulos > 0) {
    params.push(minModulos);
    filtros.push(`(SELECT COUNT(*) FROM escaneos e WHERE e.asistente_id = a.id) >= $${params.length}`);
  }

  if (excluirGanadores) {
    filtros.push(`NOT EXISTS (SELECT 1 FROM ganadores g WHERE g.asistente_id = a.id)`);
  } else {
    // Aunque se permita repetir entre rifas, nunca dentro de la misma.
    params.push(rifa.id);
    filtros.push(`NOT EXISTS (SELECT 1 FROM ganadores g
                               WHERE g.asistente_id = a.id AND g.rifa_id = $${params.length})`);
  }

  const { rows } = await client.query(
    `SELECT b.id AS boleto_id, b.folio, a.id AS asistente_id,
            a.nombre, a.apellido, a.telefono, a.qr_id
       FROM boletos b
       JOIN asistentes a ON a.id = b.asistente_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY b.id`,
    params
  );
  return rows;
}

/**
 * Ejecuta el sorteo de una rifa. Devuelve la lista de ganadores.
 * Debe llamarse dentro de una transacción.
 */
async function sortear(client, rifaId, { actor = 'sistema' } = {}) {
  // FOR UPDATE bloquea la rifa: doble clic o scheduler simultáneo no la duplican.
  const { rows: rr } = await client.query(
    `SELECT * FROM rifas WHERE id = $1 FOR UPDATE`, [rifaId]
  );
  if (!rr.length) return { ok: false, motivo: 'no_existe' };

  const rifa = rr[0];
  if (rifa.estado === 'finalizada') return { ok: false, motivo: 'ya_sorteada' };
  if (rifa.estado === 'cancelada')  return { ok: false, motivo: 'cancelada' };

  const cfg = await leerConfig(client);
  const elegibles = await boletosElegibles(client, rifa, cfg);

  if (!elegibles.length) {
    return { ok: false, motivo: 'sin_participantes', rifa };
  }

  // Selección sin reemplazo a nivel persona: al sacar un ganador,
  // retiramos TODOS sus boletos de la urna antes del siguiente.
  let urna = elegibles.slice();
  const ganadores = [];
  const cupos = Math.min(rifa.num_ganadores, new Set(urna.map((b) => b.asistente_id)).size);

  for (let pos = 1; pos <= cupos; pos++) {
    const elegido = urna[aleatorioSeguro(urna.length)];

    const { rows: g } = await client.query(
      `INSERT INTO ganadores (rifa_id, asistente_id, boleto_id, posicion)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT uq_ganador DO NOTHING
        RETURNING id`,
      [rifa.id, elegido.asistente_id, elegido.boleto_id, pos]
    );
    if (!g.length) {   // carrera improbable: lo saltamos
      urna = urna.filter((b) => b.asistente_id !== elegido.asistente_id);
      pos--;
      if (!urna.length) break;
      continue;
    }

    ganadores.push({
      id: g[0].id,
      posicion: pos,
      asistente_id: elegido.asistente_id,
      nombre: elegido.nombre,
      apellido: elegido.apellido,
      telefono: elegido.telefono,
      folio: elegido.folio,
    });

    urna = urna.filter((b) => b.asistente_id !== elegido.asistente_id);
    if (!urna.length) break;
  }

  await client.query(
    `UPDATE rifas SET estado = 'finalizada', sorteada_en = now() WHERE id = $1`,
    [rifa.id]
  );

  await client.query(
    `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1, 'sorteo', $2)`,
    [actor, JSON.stringify({
      rifa_id: rifa.id,
      premio: rifa.premio,
      boletos_en_urna: elegibles.length,
      personas: new Set(elegibles.map((b) => b.asistente_id)).size,
      ganadores: ganadores.map((g) => ({ id: g.asistente_id, folio: g.folio })),
    })]
  );

  return {
    ok: true,
    rifa,
    ganadores,
    estadisticas: {
      boletos: elegibles.length,
      personas: new Set(elegibles.map((b) => b.asistente_id)).size,
    },
  };
}

/** Cuántos participan ahora mismo — para mostrarlo antes de sortear. */
async function previaElegibles(client, rifaId) {
  const { rows: rr } = await client.query(`SELECT * FROM rifas WHERE id = $1`, [rifaId]);
  if (!rr.length) return null;
  const cfg = await leerConfig(client);
  const elegibles = await boletosElegibles(client, rr[0], cfg);
  return {
    boletos: elegibles.length,
    personas: new Set(elegibles.map((b) => b.asistente_id)).size,
  };
}

/** Rifas pendientes cuya hora ya pasó y están marcadas como automáticas. */
async function rifasVencidas(ejecutor) {
  const { rows } = await ejecutor.query(
    `SELECT id, nombre, premio, hora FROM rifas
      WHERE estado = 'pendiente' AND auto = true AND hora <= now()
      ORDER BY hora`
  );
  return rows;
}

/** Próximas rifas, para countdowns en el panel y la pantalla. */
async function proximasRifas(ejecutor, limite = 5) {
  const { rows } = await ejecutor.query(
    `SELECT r.id, r.nombre, r.premio, r.valor, r.hora, r.num_ganadores, r.estado,
            p.nombre AS patrocinador, p.logo_url AS patrocinador_logo
       FROM rifas r
       LEFT JOIN patrocinadores p ON p.id = r.patrocinador_id
      WHERE r.estado IN ('pendiente','en_curso')
      ORDER BY r.hora
      LIMIT $1`,
    [limite]
  );
  return rows;
}

module.exports = {
  aleatorioSeguro,
  boletosElegibles,
  sortear,
  previaElegibles,
  rifasVencidas,
  proximasRifas,
};
