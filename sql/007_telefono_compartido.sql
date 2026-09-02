-- =====================================================================
-- 007 · Varias personas pueden compartir teléfono
-- AMPI Realty Summit 2026
--
-- El índice `ix_asis_tel` era ÚNICO sobre `telefono`, así que la base
-- impedía dar de alta a dos personas con el mismo número.
--
-- Eso rompía un caso real y frecuente: los compañeros de una oficina
-- registran el conmutador de su empresa. En la lista de Summit, cinco
-- personas de Next Bienes Raíces y tres de Notaría 8 comparten número.
-- Seis de ellas se quedaban fuera de la fila E y nadie entendía por qué:
-- el importador ya no las rechazaba, pero la base las bloqueaba después.
--
-- El teléfono se sigue usando para reconocer a alguien al reimportar,
-- sólo que combinado con el nombre. Deja de ser identificador único.
--
-- Idempotente.
-- =====================================================================

DROP INDEX IF EXISTS ix_asis_tel;

-- Se mantiene el índice, pero SIN unicidad: sirve igual para buscar por
-- teléfono, que es para lo que hace falta.
CREATE INDEX IF NOT EXISTS ix_asis_tel
  ON asistentes(telefono) WHERE telefono IS NOT NULL;

-- Lo que sí debe ser único es la persona: mismo nombre, mismo apellido
-- y mismo teléfono ya es un duplicado de verdad, no un compañero.
CREATE UNIQUE INDEX IF NOT EXISTS ix_asis_persona
  ON asistentes (
    unaccent_simple(coalesce(nombre, '')),
    unaccent_simple(coalesce(apellido, '')),
    telefono
  )
  WHERE telefono IS NOT NULL AND telefono <> '';
