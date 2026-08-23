-- =====================================================================
-- 003 · Impresión de etiquetas y entrega en el módulo Quantum
-- Gamificación AMPI 2026
--
-- Flujo que soporta:
--   1. Se importa la base previa y se imprimen etiquetas hasta un día antes.
--   2. El día del evento, los practicantes buscan al asistente por nombre,
--      le entregan su carnet con la etiqueta pegada y marcan la entrega.
--   3. Quien no venía en la lista se da de alta en vivo y se le imprime
--      su etiqueta en el momento.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =====================================================================

ALTER TABLE asistentes
  ADD COLUMN IF NOT EXISTS etiqueta_impresa_en timestamptz,
  ADD COLUMN IF NOT EXISTS entregado_en        timestamptz,
  ADD COLUMN IF NOT EXISTS entregado_por       text;

-- Búsqueda por nombre en la mesa de entrega: tiene que ser instantánea
-- aunque haya 400 personas y el practicante escriba con una sola mano.
--
-- No usamos la extensión unaccent porque requiere permisos de superusuario
-- que Railway no siempre concede. Esta función hace lo mismo para el
-- español y es inmutable, así que puede indexarse.
CREATE OR REPLACE FUNCTION unaccent_simple(txt text)
RETURNS text AS $$
  SELECT lower(translate(
    coalesce(txt, ''),
    'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
    'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'
  ));
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX IF NOT EXISTS asistentes_busqueda_idx
  ON asistentes (unaccent_simple(
    coalesce(nombre, '') || ' ' || coalesce(apellido, '') || ' ' || coalesce(empresa, '')));

-- Para listar pendientes de impresión y de entrega sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS asistentes_impresa_idx  ON asistentes (etiqueta_impresa_en);
CREATE INDEX IF NOT EXISTS asistentes_entrega_idx  ON asistentes (entregado_en);

-- Panorama de la operación del módulo, en una sola consulta.
CREATE OR REPLACE VIEW v_operacion_modulo AS
SELECT
  count(*)::int                                                         AS total,
  count(*) FILTER (WHERE origen = 'csv')::int                           AS de_lista_previa,
  count(*) FILTER (WHERE origen <> 'csv')::int                          AS altas_en_vivo,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NOT NULL)::int          AS etiquetas_impresas,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NULL)::int              AS etiquetas_pendientes,
  count(*) FILTER (WHERE entregado_en IS NOT NULL)::int                 AS entregados,
  count(*) FILTER (WHERE entregado_en IS NULL)::int                     AS sin_entregar
FROM asistentes;
