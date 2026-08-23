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
  soloAdmin,
  soloStaff,
  soloExpositor,
  verificarPassword,
  hashearPassword,
  manejadorErrores,
};
