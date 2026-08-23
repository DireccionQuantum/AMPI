'use strict';

const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

/** Limita los intentos de login para que nadie adivine PINs por fuerza bruta. */
const limiteLogin = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

/**
 * Límite para el acceso de expositores al escáner.
 *
 * OJO con por qué es distinto al de arriba: en el salón, los 40 módulos
 * están en el mismo WiFi y salen por UNA sola IP pública. Con el tope de
 * 15 por IP, a partir del expositor número 15 se bloquearían entre sí,
 * justo en el momento de mayor prisa. Aquí el tope es por código
 * intentado, no por IP, así que un módulo que se equivoca no arrastra a
 * los demás. Sigue cortando a quien intente adivinar códigos ajenos.
 */
const limiteLoginExpositor = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const c = (req.body && (req.body.codigo || req.body.token)) || '';
    // Si no mandan nada identificable, caemos a la IP.
    return String(c).trim().toUpperCase().slice(0, 40) || req.ip;
  },
  message: { error: 'Demasiados intentos con este código. Espera unos minutos.' },
});

/** Exige sesión de administrador. */
function soloAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') return next();
  res.status(403).json({ error: 'Requiere sesión de administrador' });
}

/** Exige sesión de admin o staff (el staff opera la estación de registro). */
function soloStaff(req, res, next) {
  const u = req.session && req.session.usuario;
  if (u && (u.rol === 'admin' || u.rol === 'staff')) return next();
  res.status(403).json({ error: 'Requiere sesión de staff' });
}

/** Exige sesión de expositor (el scanner del módulo). */
function soloExpositor(req, res, next) {
  if (req.session && req.session.expositor) return next();
  res.status(403).json({ error: 'Inicia sesión en tu módulo' });
}

async function verificarPassword(plano, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plano), hash);
}

async function hashearPassword(plano) {
  return bcrypt.hash(String(plano), 10);
}

/** Manejador central de errores: nunca filtra stack traces al cliente. */
function manejadorErrores(err, req, res, _next) {
  console.error('[error]', req.method, req.originalUrl, '-', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Ocurrió un error. Inténtalo de nuevo.' });
}

module.exports = {
  limiteLogin,
  limiteLoginExpositor,
  soloAdmin,
  soloStaff,
  soloExpositor,
  verificarPassword,
  hashearPassword,
  manejadorErrores,
};
