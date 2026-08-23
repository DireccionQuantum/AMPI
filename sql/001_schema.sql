-- ============================================================
--  Gamificación AMPI Tijuana 2026 — Esquema completo
--  PostgreSQL 14+
-- ============================================================

-- ---------- Configuración global (editable desde el admin) ----------
CREATE TABLE IF NOT EXISTS config (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT
);

INSERT INTO config (clave, valor, descripcion) VALUES
  ('puntos_por_boleto',   '1',  'Puntos necesarios para generar un boleto'),
  ('min_modulos_rifa',    '0',  'Módulos mínimos visitados para entrar al sorteo (0 = sin mínimo)'),
  ('excluir_ganadores',   'si', 'Un ganador queda fuera de las siguientes rifas'),
  ('solo_verificados',    'si', 'Sólo participan asistentes con nombre y teléfono'),
  ('nombre_evento',       'AMPI Tijuana 2026', 'Nombre mostrado en las pantallas'),
  ('fecha_evento',        '2026-09-03', 'Fecha del evento')
ON CONFLICT (clave) DO NOTHING;


-- ---------- Asistentes ----------
CREATE TABLE IF NOT EXISTS asistentes (
  id           SERIAL PRIMARY KEY,
  -- Identidad escaneable: 24 hex. Puede venir de WeChamber (ObjectId)
  -- o generarse aquí al registrarse en el stand. Un solo formato.
  qr_id        TEXT UNIQUE NOT NULL,
  codigo_corto TEXT,          -- 6 caracteres legibles, respaldo del QR
  token_hash   TEXT,          -- SHA-256 del token de sesión
  nombre       TEXT,
  apellido     TEXT,
  telefono     TEXT,
  email        TEXT,
  empresa      TEXT,
  estado       TEXT NOT NULL DEFAULT 'pendiente'
               CHECK (estado IN ('pendiente','verificado')),
  origen       TEXT NOT NULL DEFAULT 'stand'
               CHECK (origen IN ('csv','stand','autoregistro')),
  intentos     INT NOT NULL DEFAULT 0,
  bloqueo_en   TIMESTAMPTZ,
  datos_en     TIMESTAMPTZ,
  visto_en     TIMESTAMPTZ,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_asis_token
  ON asistentes(token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ix_asis_codigo
  ON asistentes(codigo_corto) WHERE codigo_corto IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ix_asis_tel
  ON asistentes(telefono) WHERE telefono IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asis_estado ON asistentes(estado);

-- Un asistente se considera identificable sólo con nombre Y teléfono.
CREATE OR REPLACE FUNCTION fn_verificar_asistente() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.nombre IS NOT NULL AND btrim(NEW.nombre) <> ''
     AND NEW.telefono IS NOT NULL AND btrim(NEW.telefono) <> '' THEN
    NEW.estado   := 'verificado';
    NEW.datos_en := COALESCE(NEW.datos_en, now());
  ELSE
    NEW.estado := 'pendiente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verificar ON asistentes;
CREATE TRIGGER trg_verificar
  BEFORE INSERT OR UPDATE OF nombre, telefono ON asistentes
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_asistente();


-- ---------- Expositores (módulos) ----------
CREATE TABLE IF NOT EXISTS expositores (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  empresa   TEXT,
  contacto  TEXT,
  telefono  TEXT,
  pin_hash  TEXT NOT NULL,
  token     TEXT UNIQUE NOT NULL,   -- liga directa al scanner
  puntos    INT  NOT NULL DEFAULT 1 CHECK (puntos > 0),
  orden     INT  NOT NULL DEFAULT 0,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_expo_activo ON expositores(activo);


-- ---------- Escaneos ----------
CREATE TABLE IF NOT EXISTS escaneos (
  id           SERIAL PRIMARY KEY,
  asistente_id INT NOT NULL REFERENCES asistentes(id)  ON DELETE CASCADE,
  expositor_id INT NOT NULL REFERENCES expositores(id) ON DELETE CASCADE,
  puntos       INT NOT NULL,
  origen       TEXT NOT NULL DEFAULT 'scanner',
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Regla antifraude: un asistente sólo suma una vez por módulo.
  CONSTRAINT uq_escaneo UNIQUE (asistente_id, expositor_id)
);
CREATE INDEX IF NOT EXISTS ix_esc_asis  ON escaneos(asistente_id);
CREATE INDEX IF NOT EXISTS ix_esc_expo  ON escaneos(expositor_id);
CREATE INDEX IF NOT EXISTS ix_esc_fecha ON escaneos(creado_en);


-- ---------- Boletos ----------
CREATE TABLE IF NOT EXISTS boletos (
  id           SERIAL PRIMARY KEY,
  asistente_id INT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  escaneo_id   INT REFERENCES escaneos(id) ON DELETE SET NULL,
  folio        TEXT UNIQUE NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bol_asis ON boletos(asistente_id);

CREATE SEQUENCE IF NOT EXISTS seq_folio START 1;


-- ---------- Patrocinadores ----------
CREATE TABLE IF NOT EXISTS patrocinadores (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  logo_url  TEXT,
  sitio_url TEXT,
  orden     INT NOT NULL DEFAULT 0,
  activo    BOOLEAN NOT NULL DEFAULT true
);


-- ---------- Rifas ----------
CREATE TABLE IF NOT EXISTS rifas (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  premio          TEXT NOT NULL,
  valor           NUMERIC(10,2),
  patrocinador_id INT REFERENCES patrocinadores(id) ON DELETE SET NULL,
  hora            TIMESTAMPTZ NOT NULL,
  num_ganadores   INT NOT NULL DEFAULT 1 CHECK (num_ganadores > 0),
  min_modulos     INT NOT NULL DEFAULT 0,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','en_curso','finalizada','cancelada')),
  auto            BOOLEAN NOT NULL DEFAULT true,  -- se dispara sola a su hora
  sorteada_en     TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rifa_estado ON rifas(estado, hora);


-- ---------- Ganadores ----------
CREATE TABLE IF NOT EXISTS ganadores (
  id           SERIAL PRIMARY KEY,
  rifa_id      INT NOT NULL REFERENCES rifas(id)      ON DELETE CASCADE,
  asistente_id INT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  boleto_id    INT REFERENCES boletos(id) ON DELETE SET NULL,
  posicion     INT NOT NULL DEFAULT 1,
  entregado    BOOLEAN NOT NULL DEFAULT false,
  entregado_en TIMESTAMPTZ,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ganador UNIQUE (rifa_id, asistente_id)
);
CREATE INDEX IF NOT EXISTS ix_gan_rifa ON ganadores(rifa_id);


-- ---------- Usuarios del sistema ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'staff'
                CHECK (rol IN ('admin','staff')),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones de express-session (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    TEXT PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_session_expire ON session(expire);


-- ---------- Bitácora de auditoría ----------
CREATE TABLE IF NOT EXISTS bitacora (
  id         SERIAL PRIMARY KEY,
  actor      TEXT,
  accion     TEXT NOT NULL,
  detalle    JSONB,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bit_fecha ON bitacora(creado_en);


-- ============================================================
--  Vistas de apoyo
-- ============================================================

-- Resumen por asistente: puntos, boletos, módulos visitados.
CREATE OR REPLACE VIEW v_asistentes AS
SELECT a.id, a.qr_id, a.codigo_corto, a.nombre, a.apellido, a.telefono,
       a.estado, a.origen, a.creado_en,
       COALESCE(e.escaneos, 0) AS modulos,
       COALESCE(e.puntos,   0) AS puntos,
       COALESCE(b.boletos,  0) AS boletos,
       g.premios
  FROM asistentes a
  LEFT JOIN (
        SELECT asistente_id, COUNT(*) escaneos, SUM(puntos) puntos
          FROM escaneos GROUP BY asistente_id
       ) e ON e.asistente_id = a.id
  LEFT JOIN (
        SELECT asistente_id, COUNT(*) boletos
          FROM boletos GROUP BY asistente_id
       ) b ON b.asistente_id = a.id
  LEFT JOIN (
        SELECT asistente_id, COUNT(*) premios
          FROM ganadores GROUP BY asistente_id
       ) g ON g.asistente_id = a.id;

-- Ranking para la pantalla de proyección.
CREATE OR REPLACE VIEW v_ranking AS
SELECT nombre, apellido, modulos, puntos, boletos
  FROM v_asistentes
 WHERE estado = 'verificado' AND puntos > 0
 ORDER BY puntos DESC, modulos DESC, id ASC;

-- Desempeño por expositor.
CREATE OR REPLACE VIEW v_expositores AS
SELECT x.id, x.nombre, x.empresa, x.puntos, x.activo,
       COUNT(e.id) AS visitas,
       MAX(e.creado_en) AS ultima_visita
  FROM expositores x
  LEFT JOIN escaneos e ON e.expositor_id = x.id
 GROUP BY x.id
 ORDER BY visitas DESC;

-- Quién falta por identificar (tiene puntos pero no datos).
CREATE OR REPLACE VIEW v_pendientes AS
SELECT id, qr_id, codigo_corto, modulos, puntos, creado_en
  FROM v_asistentes
 WHERE estado = 'pendiente'
 ORDER BY puntos DESC;
