-- ============================================================
--  Marca e identidad visual — Gamificación AMPI 2026
--  Permite subir logos desde el panel sin volver a desplegar.
-- ============================================================

-- Los logos viven en la base, no en disco: Railway reinicia el
-- sistema de archivos en cada despliegue y se perderían.
CREATE TABLE IF NOT EXISTS marca (
  clave        TEXT PRIMARY KEY,
  mime         TEXT NOT NULL,
  datos        BYTEA NOT NULL,
  nombre_orig  TEXT,
  bytes        INT NOT NULL,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT
);

COMMENT ON TABLE marca IS
  'Logos e imágenes de identidad. Claves usadas: logo_evento, logo_agencia, logo_agencia_claro.';

-- Textos de marca, editables desde el panel.
INSERT INTO config (clave, valor, descripcion) VALUES
  ('agencia_nombre', 'Quantum Marketing & Advertising',
   'Nombre de la agencia mostrado en el pie de todas las pantallas'),
  ('agencia_sitio', 'quantummkt.mx',
   'Sitio web de la agencia'),
  ('agencia_credito', 'Powered by Quantum Marketing',
   'Texto del crédito discreto en cada pantalla'),
  ('evento_sede', 'Tijuana, Baja California',
   'Sede mostrada en la pantalla de proyección')
ON CONFLICT (clave) DO NOTHING;
