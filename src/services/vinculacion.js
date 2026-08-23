'use strict';

/**
 * Identidad y vinculación de asistentes — Gamificación AMPI 2026
 *
 * Un asistente se identifica siempre por `qr_id`: 24 caracteres hex.
 * Ese identificador puede venir de dos lados y el scanner no distingue:
 *
 *   - WeChamber:  ObjectId del gafete impreso (69a6430d0cd0da0015a69dd2)
 *   - Nosotros:   generado al registrarse en el stand
 *
 * Un solo formato, un solo parser, cero retrabajo si el cliente cambia
 * de opinión sobre los gafetes físicos.
 */

const crypto = require('crypto');

const QR_PATTERN = /^[a-f0-9]{24}$/i;

/** Genera un identificador propio con el mismo formato que WeChamber. */
function generarQrId() {
  return crypto.randomBytes(12).toString('hex');
}

/** Normaliza y valida el contenido de un QR. Devuelve null si no sirve. */
function parseQr(raw) {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  // Tolerancia: si el QR trae una URL, extraemos el identificador.
  const enUrl = v.match(/([a-f0-9]{24})(?:[/?#]|$)/i);
  if (enUrl) v = enUrl[1];
  return QR_PATTERN.test(v) ? v.toLowerCase() : null;
}

/** Teléfono mexicano a 10 dígitos. Acepta +52, lada 01, guiones, paréntesis. */
function parseTelefono(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('01')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return /^[2-9][0-9]{9}$/.test(d) ? d : null;
}

function limpiarNombre(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length < 2 || v.length > 60) return null;
  return /^[\p{L}][\p{L}\s'’.-]*$/u.test(v) ? v : null;
}

function limpiarEmail(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v) && v.length <= 120 ? v : null;
}

/**
 * Resuelve el asistente dueño de un QR durante un escaneo.
 * Si el identificador no existe, lo crea como 'pendiente': el escaneo
 * NUNCA se pierde, aunque no sepamos todavía quién es la persona.
 */
async function resolverAsistente(client, qrId) {
  // Guarda defensiva: sin identificador válido no se toca la base.
  const limpio = parseQr(qrId);
  if (!limpio) throw new TypeError('resolverAsistente requiere un qr_id válido');

  const { rows } = await client.query(
    `INSERT INTO asistentes (qr_id, origen, estado)
          VALUES ($1, 'autoregistro', 'pendiente')
     ON CONFLICT (qr_id) DO UPDATE SET qr_id = EXCLUDED.qr_id
      RETURNING id, qr_id, nombre, apellido, estado, (xmax = 0) AS recien_creado`,
    [limpio]
  );
  const a = rows[0];
  return { asistente: a, esNuevo: a.recien_creado, requiereDatos: a.estado === 'pendiente' };
}

/** Estado público de un asistente, para su panel y la página de registro. */
async function consultarEstado(ejecutor, qrId) {
  const { rows } = await ejecutor.query(
    `SELECT id, qr_id, codigo_corto, nombre, apellido, telefono,
            estado, modulos, puntos, boletos
       FROM v_asistentes WHERE qr_id = $1`,
    [qrId]
  );
  if (!rows.length) return { existe: false, estado: 'desconocido' };

  const r = rows[0];
  return {
    existe: true,
    id: r.id,
    qr_id: r.qr_id,
    codigo: r.codigo_corto,
    estado: r.estado,
    nombre: r.nombre,
    apellido: r.apellido,
    // Nunca exponemos el teléfono completo al navegador.
    telefonoParcial: r.telefono ? `•••• ${r.telefono.slice(-4)}` : null,
    modulos: Number(r.modulos),
    puntos: Number(r.puntos),
    boletos: Number(r.boletos),
  };
}

/** Valida un paquete de datos personales. Devuelve {datos} o {errores}. */
function validarDatos({ nombre, apellido, telefono, email, empresa } = {}) {
  const n = limpiarNombre(nombre);
  const a = apellido ? limpiarNombre(apellido) : null;
  const t = parseTelefono(telefono);
  const e = email ? limpiarEmail(email) : null;

  const errores = {};
  if (!n) errores.nombre = 'Escribe tu nombre';
  if (apellido && !a) errores.apellido = 'Revisa tu apellido';
  if (!t) errores.telefono = 'Necesitamos 10 dígitos, ej. 6641234567';
  if (email && !e) errores.email = 'Revisa tu correo';

  if (Object.keys(errores).length) return { errores };
  return {
    datos: {
      nombre: n,
      apellido: a,
      telefono: t,
      email: e,
      empresa: typeof empresa === 'string' ? empresa.trim().slice(0, 80) || null : null,
    },
  };
}

/**
 * Completa los datos de un asistente que ya existe (llegó por escaneo
 * sin identificar). No sobrescribe a alguien ya verificado.
 */
async function vincularDatos(client, qrId, entrada) {
  const v = validarDatos(entrada);
  if (v.errores) return { ok: false, errores: v.errores };
  const d = v.datos;

  // Si el teléfono ya pertenece a OTRA cuenta, no partimos los puntos:
  // avisamos para que recupere la suya.
  const dup = await client.query(
    `SELECT qr_id FROM asistentes WHERE telefono = $1 AND qr_id <> $2`,
    [d.telefono, qrId]
  );
  if (dup.rows.length) return { ok: false, telefonoEnUso: true };

  const { rows } = await client.query(
    `UPDATE asistentes
        SET nombre = $2, apellido = $3, telefono = $4,
            email = COALESCE($5, email), empresa = COALESCE($6, empresa)
      WHERE qr_id = $1 AND estado = 'pendiente'
      RETURNING id`,
    [qrId, d.nombre, d.apellido, d.telefono, d.email, d.empresa]
  );

  if (!rows.length) {
    const actual = await consultarEstado(client, qrId);
    if (actual.existe && actual.estado === 'verificado') {
      return { ok: false, yaVerificado: true, datos: actual };
    }
    return { ok: false, noEncontrado: true };
  }

  return { ok: true, id: rows[0].id, datos: await consultarEstado(client, qrId) };
}

/**
 * Registro nuevo desde el stand: generamos identidad propia.
 * Si el teléfono ya existe, devolvemos la cuenta existente en lugar
 * de crear una segunda — en eventos la gente se registra dos veces.
 */
async function registrarNuevo(client, entrada) {
  const v = validarDatos(entrada);
  if (v.errores) return { ok: false, errores: v.errores };
  const d = v.datos;

  const existente = await client.query(
    `SELECT qr_id FROM asistentes WHERE telefono = $1`,
    [d.telefono]
  );
  if (existente.rows.length) {
    return {
      ok: true,
      yaExistia: true,
      qr_id: existente.rows[0].qr_id,
      datos: await consultarEstado(client, existente.rows[0].qr_id),
    };
  }

  // Reintento por si el identificador aleatorio colisiona (improbable).
  for (let i = 0; i < 5; i++) {
    const qrId = generarQrId();
    try {
      const { rows } = await client.query(
        `INSERT INTO asistentes
                (qr_id, nombre, apellido, telefono, email, empresa, origen)
         VALUES ($1, $2, $3, $4, $5, $6, 'stand')
         RETURNING id, qr_id`,
        [qrId, d.nombre, d.apellido, d.telefono, d.email, d.empresa]
      );
      return { ok: true, yaExistia: false, id: rows[0].id, qr_id: rows[0].qr_id };
    } catch (err) {
      if (err.code !== '23505') throw err;
      // Carrera con otro registro del mismo teléfono: devolvemos el suyo.
      const otra = await client.query(
        `SELECT qr_id FROM asistentes WHERE telefono = $1`, [d.telefono]
      );
      if (otra.rows.length) {
        return {
          ok: true, yaExistia: true, qr_id: otra.rows[0].qr_id,
          datos: await consultarEstado(client, otra.rows[0].qr_id),
        };
      }
    }
  }
  throw new Error('No se pudo generar un identificador único');
}

module.exports = {
  QR_PATTERN,
  generarQrId,
  parseQr,
  parseTelefono,
  limpiarNombre,
  limpiarEmail,
  validarDatos,
  resolverAsistente,
  consultarEstado,
  vincularDatos,
  registrarNuevo,
};
