-- =====================================================================
-- 005 · Lugares asignados
-- AMPI Realty Summit 2026
--
-- El salón tiene nueve filas de veinte asientos (AAA, AA, A, B … G) y a
-- cada persona se le asigna uno. AMPI no nos pidió controlar el acceso a
-- la sala: sólo que el lugar venga impreso en el gafete para que la gente
-- sepa dónde sentarse y quien orienta lo lea de lejos.
--
-- Por eso NO hay tabla de asientos ni validación de aforo: son dos
-- columnas descriptivas. Meter un modelo de butacas completo sería
-- construir algo que nadie va a usar.
--
-- Idempotente: se puede correr varias veces.
-- =====================================================================

ALTER TABLE asistentes
  ADD COLUMN IF NOT EXISTS fila    TEXT,
  ADD COLUMN IF NOT EXISTS asiento INT;

-- Se permite repetir lugar a propósito: en la lista de Summit hay una
-- persona con dos asientos comprados. Bloquearlo obligaría a corregir el
-- archivo del cliente antes de poder importarlo.
CREATE INDEX IF NOT EXISTS asistentes_lugar_idx
  ON asistentes (fila, asiento) WHERE fila IS NOT NULL;

-- El panorama del módulo ahora también dice cuántos traen lugar, para
-- detectar de un vistazo si faltó asignar a alguien.
CREATE OR REPLACE VIEW v_operacion_modulo AS
SELECT
  count(*)::int                                                AS total,
  count(*) FILTER (WHERE origen = 'csv')::int                  AS de_lista_previa,
  count(*) FILTER (WHERE origen <> 'csv')::int                 AS altas_en_vivo,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NOT NULL)::int AS etiquetas_impresas,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NULL)::int     AS etiquetas_pendientes,
  count(*) FILTER (WHERE entregado_en IS NOT NULL)::int        AS entregados,
  count(*) FILTER (WHERE entregado_en IS NULL)::int            AS sin_entregar,
  count(*) FILTER (WHERE fila IS NOT NULL)::int                AS con_lugar,
  count(*) FILTER (WHERE fila IS NULL)::int                    AS sin_lugar
FROM asistentes;

-- Orden natural del salón para imprimir por lugar.
--
-- El orden alfabético simple pondría A antes que AA y AAA, pero en el
-- salón las filas van AAA (adelante), AA, A, B, C … G (atrás). Se ordena
-- por largo descendente y luego alfabético, que reproduce ese acomodo.
CREATE OR REPLACE FUNCTION orden_fila(f TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN f IS NULL OR f = '' THEN 'ZZZZ'
    ELSE lpad('', 4 - least(length(f), 3), '0') || upper(f)
  END;
$$ LANGUAGE SQL IMMUTABLE;
