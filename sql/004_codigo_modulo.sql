-- =====================================================================
-- 004 · Código de acceso único por módulo
-- Gamificación AMPI 2026
--
-- Antes, el expositor entraba por su liga larga (/s/<24 hex>) y el PIN
-- sólo confirmaba identidad. En el piso eso resultó incómodo: obliga a
-- distribuir una URL distinta por stand y no se puede dictar en voz alta.
--
-- Ahora todos entran a la MISMA dirección (/scan) y se identifican con un
-- código de 6 caracteres, único por módulo.
--
-- Por qué 6 caracteres y no el PIN de 4 dígitos:
--   · El PIN sólo tiene 10,000 combinaciones y con 40 módulos la
--     probabilidad de que dos coincidan ronda el 8%. Como identificador
--     único, no sirve.
--   · El alfabeto de 31 caracteres (sin 0/O/1/I/L, que se confunden al
--     leer) da ~887 millones de combinaciones.
--
-- La liga /s/<token> sigue funcionando: las que ya se hayan repartido no
-- se rompen.
-- =====================================================================

ALTER TABLE expositores
  ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Se genera para los módulos que ya existen. Reintenta ante colisión.
DO $$
DECLARE
  fila     RECORD;
  alfabeto TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  intento  TEXT;
  i        INT;
BEGIN
  FOR fila IN SELECT id FROM expositores WHERE codigo IS NULL LOOP
    LOOP
      intento := '';
      FOR i IN 1..6 LOOP
        intento := intento || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM expositores WHERE codigo = intento);
    END LOOP;
    UPDATE expositores SET codigo = intento WHERE id = fila.id;
  END LOOP;
END $$;

ALTER TABLE expositores
  ALTER COLUMN codigo SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expositores_codigo_key ON expositores (codigo);

-- La vista que alimenta el panel debe traer el código, o la tabla de
-- módulos lo mostraría vacío.
-- Postgres no permite insertar una columna a media vista con CREATE OR
-- REPLACE, así que se recrea. No se pierde nada: es una vista, los datos
-- viven en las tablas.
DROP VIEW IF EXISTS v_expositores;
CREATE VIEW v_expositores AS
SELECT x.id, x.nombre, x.empresa, x.codigo, x.puntos, x.activo,
       COUNT(e.id) AS visitas,
       MAX(e.creado_en) AS ultima_visita
  FROM expositores x
  LEFT JOIN escaneos e ON e.expositor_id = x.id
 GROUP BY x.id
 ORDER BY visitas DESC;
