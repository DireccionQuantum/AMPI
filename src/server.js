'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');

const { pool } = require('./db');
const { manejadorErrores } = require('./middleware/auth');
const scheduler = require('./services/scheduler');
const sockets = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const PUERTO = process.env.PORT || 3000;
const PRODUCCION = process.env.NODE_ENV === 'production';

// ---------- Seguridad y utilidades ----------
app.set('trust proxy', 1);   // Railway va detrás de proxy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      mediaSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: PRODUCCION,
    sameSite: 'lax',
    maxAge: 14 * 60 * 60 * 1000,   // 14 h: cubre el día completo del evento
  },
}));

// ---------- Rutas de API ----------
app.use('/api/marca',     require('./routes/marca')(pool));
app.use('/api/publico',   require('./routes/publico')(pool));
app.use('/api/scan',      require('./routes/scan')(pool, io));
app.use('/api/asistente', require('./routes/asistente')(pool, io));
app.use('/api/admin/marca', require('./routes/marca').admin(pool));
app.use('/api/admin',     require('./routes/admin')(pool, io));

app.get('/api/salud', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, hora: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Base de datos no disponible' });
  }
});

// ---------- Páginas ----------
const PUBLICO = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLICO, { maxAge: PRODUCCION ? '1h' : 0 }));

const pagina = (archivo) => (req, res) => res.sendFile(path.join(PUBLICO, archivo));

app.get('/',           pagina('index.html'));
app.get('/registro',   pagina('registro.html'));
app.get('/mi',         pagina('panel.html'));
app.get('/p/:token',   pagina('panel.html'));     // liga persistente
app.get('/a/:qr_id',   pagina('panel.html'));     // acceso directo por QR
app.get('/scan',       pagina('scan.html'));      // scanner del expositor
app.get('/s/:token',   pagina('scan.html'));      // liga directa del módulo
app.get('/estacion',   pagina('estacion.html'));  // tablet del staff
app.get('/admin',      pagina('admin.html'));
app.get('/pantalla',   pagina('pantalla.html'));  // proyección en vivo
app.get('/instructivo', pagina('instructivo.html'));  // hoja para expositores
app.get('/etiqueta',   pagina('etiqueta.html'));      // sticker del asistente
app.get('/etiquetas',  pagina('etiquetas-lote.html'));// impresión por lote
app.get('/entrega',    pagina('entrega.html'));       // mesa de entrega del módulo

app.use((req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use(manejadorErrores);

// ---------- Arranque ----------
sockets.configurar(io, pool);

server.listen(PUERTO, () => {
  console.log(`\n  Gamificación AMPI 2026`);
  console.log(`  Servidor en http://localhost:${PUERTO}`);
  console.log(`  Entorno: ${PRODUCCION ? 'producción' : 'desarrollo'}\n`);
  scheduler.iniciar(io);
});

// Apagado ordenado: Railway manda SIGTERM en cada deploy.
function apagar(senal) {
  console.log(`\n[${senal}] cerrando…`);
  scheduler.detener();
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

module.exports = { app, server, io };
