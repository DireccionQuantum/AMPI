-- =====================================================================
-- 006 · Asistentes sin código QR
-- AMPI Realty Summit 2026
--
-- Las autoridades e invitados de honor de las filas AAA y AA reciben su
-- carnet con nombre y asiento impresos, pero SIN código QR: no visitan
-- módulos ni participan en las rifas.
--
-- Se resuelve con una bandera en lugar de dejar el qr_id vacío, por dos
-- razones. Primero, `qr_id` es NOT NULL y sostiene el escaneo entero.
-- Segundo, un registro sin código sería indistinguible de uno a medio
-- capturar: la bandera dice que es a propósito.
--
-- Idempotente.
-- =====================================================================

ALTER TABLE asistentes
  ADD COLUMN IF NOT EXISTS sin_qr BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN asistentes.sin_qr IS
  'Invitado de honor: su etiqueta no lleva QR y no participa en rifas.';

-- Los que no llevan QR quedan fuera del sorteo. Se filtra aquí, en la
-- vista que ya alimenta las rifas, para no tener que recordarlo en cada
-- consulta que se escriba después.
-- DROP antes de crear: la vista cambia de columnas entre
-- migraciones y CREATE OR REPLACE sólo admite la misma forma.
DROP VIEW IF EXISTS v_elegibles_rifa;
CREATE VIEW v_elegibles_rifa AS
SELECT a.id, a.nombre, a.apellido, a.empresa, a.codigo_corto
  FROM asistentes a
 WHERE NOT a.sin_qr
   AND a.estado = 'verificado';

-- El panorama del módulo distingue unos de otros: al imprimir por lote
-- conviene saber cuántas etiquetas llevan código y cuántas no.
-- DROP antes de crear: la vista cambia de columnas entre
-- migraciones y CREATE OR REPLACE sólo admite la misma forma.
DROP VIEW IF EXISTS v_operacion_modulo;
CREATE VIEW v_operacion_modulo AS
SELECT
  count(*)::int                                                AS total,
  count(*) FILTER (WHERE origen = 'csv')::int                  AS de_lista_previa,
  count(*) FILTER (WHERE origen <> 'csv')::int                 AS altas_en_vivo,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NOT NULL)::int AS etiquetas_impresas,
  count(*) FILTER (WHERE etiqueta_impresa_en IS NULL)::int     AS etiquetas_pendientes,
  count(*) FILTER (WHERE entregado_en IS NOT NULL)::int        AS entregados,
  count(*) FILTER (WHERE entregado_en IS NULL)::int            AS sin_entregar,
  count(*) FILTER (WHERE fila IS NOT NULL)::int                AS con_lugar,
  count(*) FILTER (WHERE fila IS NULL)::int                    AS sin_lugar,
  count(*) FILTER (WHERE sin_qr)::int                          AS invitados_sin_qr
FROM asistentes;
