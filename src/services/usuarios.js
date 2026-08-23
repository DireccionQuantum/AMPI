'use strict';

/**
 * Gestión de usuarios del panel — AMPI 2026
 *
 * Sirve para dar de alta a los practicantes que van a operar la mesa de
 * entrega el día del evento, sin tocar la base a mano.
 *
 * Dos roles:
 *   staff → mesa de entrega, estación de registro, impresión de etiquetas
 *   admin → todo lo anterior, más importar, configurar y crear usuarios
 *
 * Protecciones que no se pueden desactivar desde la interfaz:
 *   - nadie puede desactivarse ni degradarse a sí mismo (te dejaría fuera)
 *   - siempre debe quedar al menos un administrador activo
 */

const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'staff'];
const MIN_PASS = 8;

function limpiarEmail(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) && v.length <= 120 ? v : null;
}

function limpiarNombre(raw) {
  const v = String(raw || '').trim().replace(/\s+/g, ' ');
  return v.length >= 2 && v.length <= 60 ? v : null;
}

/**
 * La contraseña la teclea alguien con prisa en un celular: pedimos longitud,
 * no una combinación imposible de símbolos que acabe escrita en un papel.
 */
function revisarPassword(raw) {
  const v = String(raw || '');
  if (v.length < MIN_PASS) return { ok: false, motivo: `Mínimo ${MIN_PASS} caracteres` };
  if (v.length > 200) return { ok: false, motivo: 'Demasiado larga' };
  if (/^\d+$/.test(v)) return { ok: false, motivo: 'No puede ser sólo números' };
  return { ok: true, valor: v };
}

async function listar(db) {
  const { rows } = await db.query(
    `SELECT id, email, nombre, rol, activo, creado_en
       FROM usuarios ORDER BY rol, nombre`
  );
  return rows;
}

async function contarAdmins(db, exceptoId) {
  const { rows } = await db.query(
    `SELECT count(*)::int n FROM usuarios
      WHERE rol = 'admin' AND activo = true AND ($1::int IS NULL OR id <> $1)`,
    [exceptoId || null]
  );
  return rows[0].n;
}

async function crear(db, { email, nombre, password, rol }) {
  const e = limpiarEmail(email);
  if (!e) return { error: 'Correo inválido' };
  const n = limpiarNombre(nombre);
  if (!n) return { error: 'El nombre debe tener al menos 2 letras' };
  const p = revisarPassword(password);
  if (!p.ok) return { error: p.motivo };
  const r = ROLES.includes(rol) ? rol : 'staff';

  try {
    const { rows } = await db.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, nombre, rol, activo, creado_en`,
      [e, n, await bcrypt.hash(p.valor, 10), r]
    );
    return { usuario: rows[0] };
  } catch (err) {
    if (err.code === '23505') return { error: 'Ese correo ya está registrado' };
    throw err;
  }
}

/** Cambia la contraseña de cualquiera. Sólo un admin llega hasta aquí. */
async function cambiarPassword(db, id, password) {
  const p = revisarPassword(password);
  if (!p.ok) return { error: p.motivo };
  const { rows } = await db.query(
    `UPDATE usuarios SET password_hash = $2 WHERE id = $1 RETURNING id, email, nombre`,
    [id, await bcrypt.hash(p.valor, 10)]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

/** Activa o desactiva. Desactivar es preferible a borrar: conserva la bitácora. */
async function cambiarActivo(db, id, activo, idQuienPide) {
  if (id === idQuienPide && !activo) {
    return { error: 'No puedes desactivar tu propia cuenta' };
  }
  if (!activo) {
    const { rows } = await db.query('SELECT rol FROM usuarios WHERE id = $1', [id]);
    if (rows[0] && rows[0].rol === 'admin' && (await contarAdmins(db, id)) === 0) {
      return { error: 'Debe quedar al menos un administrador activo' };
    }
  }
  const { rows } = await db.query(
    `UPDATE usuarios SET activo = $2 WHERE id = $1
     RETURNING id, email, nombre, rol, activo`,
    [id, !!activo]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

async function cambiarRol(db, id, rol, idQuienPide) {
  if (!ROLES.includes(rol)) return { error: 'Rol inválido' };
  if (id === idQuienPide && rol !== 'admin') {
    return { error: 'No puedes quitarte a ti mismo el rol de administrador' };
  }
  if (rol !== 'admin' && (await contarAdmins(db, id)) === 0) {
    return { error: 'Debe quedar al menos un administrador activo' };
  }
  const { rows } = await db.query(
    `UPDATE usuarios SET rol = $2 WHERE id = $1
     RETURNING id, email, nombre, rol, activo`,
    [id, rol]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

/**
 * Genera una contraseña fácil de dictar en voz alta y de teclear en un
 * celular: dos palabras y dos dígitos. Para los practicantes, que reciben
 * su cuenta el día anterior y no van a memorizar nada complicado.
 */
const PALABRAS = [
  'atomo', 'brisa', 'cactus', 'delta', 'enero', 'faro', 'globo', 'huerto',
  'iglu', 'jade', 'lago', 'mango', 'nopal', 'olivo', 'pino', 'quinta',
  'rio', 'sierra', 'tigre', 'uva', 'valle', 'yuca', 'zorro', 'nube',
];

function passwordSugerida() {
  const crypto = require('crypto');
  const elige = (a) => a[crypto.randomInt(a.length)];
  return `${elige(PALABRAS)}-${elige(PALABRAS)}-${crypto.randomInt(10, 100)}`;
}

module.exports = {
  ROLES,
  MIN_PASS,
  limpiarEmail,
  limpiarNombre,
  revisarPassword,
  listar,
  crear,
  cambiarPassword,
  cambiarActivo,
  cambiarRol,
  contarAdmins,
  passwordSugerida,
};
