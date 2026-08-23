'use strict';

/**
 * Sesión y recuperación — Gamificación AMPI 2026
 *
 * Tres capas para que nadie pierda sus puntos al cerrar el navegador:
 *
 *   1. Liga permanente  — token largo en la URL + localStorage. Invisible.
 *   2. Teléfono + código corto — si cambió de dispositivo o borró datos.
 *   3. Personal del stand — búsqueda por teléfono y reemisión de liga.
 */

const crypto = require('crypto');

// Alfabeto sin caracteres que se confunden al dictar o teclear:
// nada de 0/O, 1/I/L. Lo que se lee es lo que se escribe.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LARGO_CODIGO = 6;

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

/** Token de sesión: 32 hex (128 bits). Va en la liga del asistente. */
function generarToken() {
  return crypto.randomBytes(16).toString('hex');
}

/** Guardamos sólo el hash. El token en claro nunca toca la base. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Código corto legible. 31^6 ≈ 887 millones de combinaciones.
 *
 * Usamos rechazo de muestras en vez de `% 31`: como 256 no es múltiplo
 * de 31, el módulo directo haría un 12% más probables los primeros ocho
 * caracteres del alfabeto. Descartar el sobrante deja la distribución plana.
 */
function generarCodigoCorto() {
  const N = ALFABETO.length;               // 31
  const LIMITE = 256 - (256 % N);          // 248
  let out = '';
  while (out.length < LARGO_CODIGO) {
    for (const b of crypto.randomBytes(LARGO_CODIGO * 2)) {
      if (b >= LIMITE) continue;           // descartamos 248–255
      out += ALFABETO[b % N];
      if (out.length === LARGO_CODIGO) break;
    }
  }
  return out;
}

/**
 * Normaliza lo que teclea el usuario. Como el alfabeto no incluye
 * 0/O/1/I/L, cualquiera de esos caracteres es un error de lectura:
 * los mapeamos al carácter real más parecido.
 */
function limpiarCodigo(raw) {
  if (typeof raw !== 'string') return null;
  let v = raw.toUpperCase().replace(/[\s\-_.]/g, '');
  // Caracteres que NO están en el alfabeto pero el usuario podría teclear,
  // mapeados a su parecido más probable.
  v = v.replace(/O/g, 'Q').replace(/0/g, 'Q')
       .replace(/I/g, 'J').replace(/1/g, 'J')
       .replace(/L/g, 'J');
  if (v.length !== LARGO_CODIGO) return null;
  for (const c of v) if (!ALFABETO.includes(c)) return null;
  return v;
}

/**
 * Emite token y código corto para un asistente, con reintento en caso
 * de colisión del código (poco probable, pero barato de cubrir).
 */
async function emitirCredenciales(client, asistenteId) {
  if (!Number.isInteger(Number(asistenteId))) {
    throw new TypeError('emitirCredenciales requiere el id del asistente');
  }
  for (let intento = 0; intento < 6; intento++) {
    const token = generarToken();
    const codigo = generarCodigoCorto();
    try {
      const { rows } = await client.query(
        `UPDATE asistentes
            SET token_hash = $2, codigo_corto = $3, visto_en = now()
          WHERE id = $1
      RETURNING id, nombre, codigo_corto`,
        [asistenteId, hashToken(token), codigo]
      );
      if (!rows.length) return null;
      return { token, codigo, asistente: rows[0] };
    } catch (err) {
      // 23505 = unique_violation: el código ya existía, reintentamos.
      if (err.code !== '23505') throw err;
    }
  }
  throw new Error('No se pudo generar un código único');
}

/** Restaura la sesión a partir del token de la liga. */
async function porToken(db, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/i.test(token.trim())) {
    return null;
  }
  const { rows } = await db.query(
    `UPDATE asistentes SET visto_en = now()
      WHERE token_hash = $1
  RETURNING id, qr_id, nombre, apellido, codigo_corto, estado`,
    [hashToken(token.trim().toLowerCase())]
  );
  return rows[0] || null;
}

/**
 * Recuperación por teléfono + código corto.
 * Dos factores: algo que sabe (su número) y algo que tiene (el código).
 * Con bloqueo progresivo para que nadie adivine códigos a fuerza.
 */
async function recuperar(client, { telefono, codigo }, parseTelefono) {
  const tel = parseTelefono(telefono);
  const cod = limpiarCodigo(codigo);

  if (!tel) return { ok: false, motivo: 'telefono_invalido' };
  if (!cod) return { ok: false, motivo: 'codigo_invalido' };

  const { rows } = await client.query(
    `SELECT id, nombre, codigo_corto, intentos, bloqueo_en
       FROM asistentes WHERE telefono = $1`,
    [tel]
  );

  // Respuesta genérica: no revelamos si el teléfono existe o no.
  if (!rows.length) return { ok: false, motivo: 'no_coincide' };

  const a = rows[0];

  if (a.bloqueo_en && new Date(a.bloqueo_en) > new Date()) {
    const min = Math.ceil((new Date(a.bloqueo_en) - new Date()) / 60000);
    return { ok: false, motivo: 'bloqueado', minutos: min };
  }

  // Comparación en tiempo constante.
  const guardado = Buffer.from(a.codigo_corto || '');
  const recibido = Buffer.from(cod);
  const coincide =
    guardado.length === recibido.length &&
    crypto.timingSafeEqual(guardado, recibido);

  if (!coincide) {
    const intentos = a.intentos + 1;
    const bloqueo =
      intentos >= MAX_INTENTOS
        ? new Date(Date.now() + MINUTOS_BLOQUEO * 60000)
        : null;
    await client.query(
      `UPDATE asistentes SET intentos = $2, bloqueo_en = $3 WHERE id = $1`,
      [a.id, bloqueo ? 0 : intentos, bloqueo]
    );
    return {
      ok: false,
      motivo: bloqueo ? 'bloqueado' : 'no_coincide',
      minutos: bloqueo ? MINUTOS_BLOQUEO : undefined,
      restantes: bloqueo ? 0 : MAX_INTENTOS - intentos,
    };
  }

  // Acierto: limpiamos intentos y emitimos token nuevo.
  // El token viejo deja de servir — sesión única por asistente.
  await client.query(
    `UPDATE asistentes SET intentos = 0, bloqueo_en = NULL WHERE id = $1`,
    [a.id]
  );
  const cred = await emitirCredenciales(client, a.id);
  return { ok: true, token: cred.token, codigo: a.codigo_corto, nombre: a.nombre };
}

/**
 * Búsqueda del personal del stand (capa 3): sólo por teléfono, sin código.
 * Requiere sesión de staff — reemite la liga para mostrarla en la tablet.
 */
async function reemitirComoStaff(client, telefono, parseTelefono) {
  const tel = parseTelefono(telefono);
  if (!tel) return { ok: false, motivo: 'telefono_invalido' };

  const { rows } = await client.query(
    `SELECT id, qr_id, nombre, apellido FROM asistentes WHERE telefono = $1`,
    [tel]
  );
  if (!rows.length) return { ok: false, motivo: 'no_encontrado' };

  const cred = await emitirCredenciales(client, rows[0].id);
  return {
    ok: true,
    token: cred.token,
    codigo: cred.codigo,
    // El qr_id NO cambia al reemitir: es el mismo que ya trae impreso en su
    // etiqueta. Se devuelve para que la estación dibuje el QR correcto.
    qr_id: rows[0].qr_id,
    nombre: rows[0].nombre,
    apellido: rows[0].apellido,
  };
}

module.exports = {
  ALFABETO,
  LARGO_CODIGO,
  MAX_INTENTOS,
  generarToken,
  hashToken,
  generarCodigoCorto,
  limpiarCodigo,
  emitirCredenciales,
  porToken,
  recuperar,
  reemitirComoStaff,
};
