-- =====================================================================
-- 008 · Rifas de patrocinador ligadas a su stand
-- AMPI Realty Summit 2026
--
-- Un patrocinador que pone un regalo quiere sortearlo entre quienes de
-- verdad visitaron SU módulo, no entre todo el evento. Es la razón por
-- la que puso el premio.
--
-- Se resuelve con `expositor_id` en la rifa. Se apunta al expositor y no
-- al patrocinador porque los escaneos se registran contra expositores:
-- son dos tablas distintas y sólo una tiene el dato de quién pasó.
--
-- En NULL, la rifa se sortea entre todos los elegibles, como hasta ahora.
--
-- Idempotente.
-- =====================================================================

ALTER TABLE rifas
  ADD COLUMN IF NOT EXISTS expositor_id INT
    REFERENCES expositores(id) ON DELETE SET NULL;

COMMENT ON COLUMN rifas.expositor_id IS
  'Si se indica, sólo participan quienes escanearon el QR de ese módulo.';

CREATE INDEX IF NOT EXISTS ix_rifa_expositor
  ON rifas(expositor_id) WHERE expositor_id IS NOT NULL;
