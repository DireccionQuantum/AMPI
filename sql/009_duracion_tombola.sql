-- =====================================================================
-- 009 · Duración de la tómbola por rifa
-- AMPI Realty Summit 2026
--
-- El premio grande merece más tensión que uno de cortesía. La duración
-- se guarda por rifa y no en la configuración general para poder darle
-- 15 segundos al principal y 5 a los rápidos, sin tocar nada entre uno
-- y otro durante el evento.
--
-- En segundos porque es como lo piensa quien programa la rifa; la
-- pantalla lo convierte a milisegundos.
--
-- Idempotente.
-- =====================================================================

ALTER TABLE rifas
  ADD COLUMN IF NOT EXISTS duracion_seg INT NOT NULL DEFAULT 9
    CHECK (duracion_seg BETWEEN 3 AND 60);

COMMENT ON COLUMN rifas.duracion_seg IS
  'Cuánto gira la tómbola antes de revelar al ganador, en segundos.';
