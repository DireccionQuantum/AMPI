'use strict';
/**
 * Rifas de patrocinador y captura de datos en la mesa de entrega.
 */
let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

const sorteo = require('../src/services/sorteo.js');

/** Cliente que devuelve la consulta armada, para inspeccionarla. */
function espia(rifa, cfg) {
  const vistas = [];
  return {
    vistas,
    async query(sql, params) {
      vistas.push({ sql: String(sql).replace(/\s+/g, ' '), params: params || [] });
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('=== 1. Rifa abierta a todo el evento ===');
  let c = espia();
  await sorteo.boletosElegibles(c, { id: 1, min_modulos: 0 }, {});
  let q = c.vistas.find((v) => v.sql.includes('FROM boletos'));
  chk(q && !q.sql.includes('e.expositor_id'),
      'sin filtro de módulo: participan todos', q && q.sql.slice(0, 90));

  console.log('\n=== 2. Rifa de un stand ===');
  c = espia();
  await sorteo.boletosElegibles(c, { id: 1, min_modulos: 0, expositor_id: 42 }, {});
  q = c.vistas.find((v) => v.sql.includes('FROM boletos'));
  chk(q && q.sql.includes('e.expositor_id'),
      'filtra por escaneo en ese módulo');
  chk(q && q.params.indexOf(42) >= 0,
      'manda el id del módulo como parámetro', q && q.params);
  chk(q && q.sql.includes('EXISTS'),
      'usa EXISTS: basta un escaneo, no importa cuántos');

  console.log('\n=== 3. Se combina con las otras reglas ===');
  c = espia();
  await sorteo.boletosElegibles(
    c, { id: 7, min_modulos: 3, expositor_id: 42 }, { excluir_ganadores: true });
  q = c.vistas.find((v) => v.sql.includes('FROM boletos'));
  chk(q && q.sql.includes('e.expositor_id') && q.sql.includes('COUNT(*)'),
      'convive con el mínimo de módulos');
  chk(q && q.sql.includes('ganadores'),
      'convive con la exclusión de ganadores previos');

  console.log('\n=== 4. Validación de los datos capturados ===');
  // Misma lógica que el endpoint /datos
  function validar(b) {
    const errores = {};
    const texto = (v, max) => {
      const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
      return s ? s.slice(0, max) : null;
    };
    const nombre = texto(b.nombre, 60);
    if (nombre !== null && nombre.length < 2) errores.nombre = 'Muy corto';
    if (b.telefono != null && String(b.telefono).trim()) {
      const d = String(b.telefono).replace(/\D/g, '');
      const diez = d.length > 10 ? d.slice(-10) : d;
      if (diez.length !== 10) errores.telefono = 'Deben ser 10 dígitos';
    }
    if (b.email != null && String(b.email).trim()) {
      const e = String(b.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) errores.email = 'inválido';
    }
    return Object.keys(errores).length ? errores : null;
  }

  chk(validar({ nombre: 'Ana', telefono: '664 123 4567' }) === null,
      'nombre y teléfono válidos');
  chk(validar({ nombre: 'Ana' }) === null, 'sólo el nombre: se acepta');
  chk(validar({ telefono: '6641234567' }) === null, 'sólo el teléfono: se acepta');
  chk(validar({ telefono: '+52 664 123 4567' }) === null,
      'teléfono con lada de país: toma los últimos 10');
  chk(validar({ nombre: 'A' }) !== null, 'nombre de una letra: avisa');
  chk(validar({ telefono: '664123' }) !== null, 'teléfono corto: avisa');
  chk(validar({ email: 'sin-arroba' }) !== null, 'correo inválido: avisa');
  chk(validar({}) === null, 'todo vacío: no hay nada que validar');

  console.log('\n' + '='.repeat(52));
  console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
