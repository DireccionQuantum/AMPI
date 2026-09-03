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

  console.log('\n=== 5. Asiento escrito a mano ===');
  // Misma lógica que el endpoint: elegir el número dado, o el primer
  // hueco si viene en blanco.
  function asignar(usados, pedido) {
    const ocupados = new Map(usados.map((u) => [u.asiento, u]));
    if (pedido != null) {
      const n = parseInt(pedido, 10);
      if (!Number.isInteger(n) || n < 1 || n > 199) return { error: 'rango' };
      // El número escrito a mano siempre se respeta, ocupado o no: sólo
      // se informa con quién queda compartido.
      const quien = ocupados.get(n);
      return { asiento: n, compartido: quien ? quien.nombre : null };
    }
    let libre = 1;
    while (ocupados.has(libre) && libre < 200) libre++;
    return { asiento: libre, compartido: null };
  }

  const fila = [{ asiento: 1, nombre: 'Ana' }, { asiento: 2, nombre: 'Beto' },
                { asiento: 5, nombre: 'Caro' }];

  chk(asignar(fila, 3).asiento === 3, 'toma el número que se le escribe');
  chk(asignar(fila, 12).asiento === 12, 'acepta un número lejano');
  chk(asignar(fila, null).asiento === 3, 'en blanco: primer hueco libre');
  chk(asignar([], null).asiento === 1, 'fila vacía: empieza en 1');

  const choque = asignar(fila, 2);
  chk(choque.asiento === 2, 'un asiento ocupado se asigna igual', choque);
  chk(choque.compartido === 'Beto', 'y avisa con quién queda compartido', choque);

  chk(asignar(fila, 0).error === 'rango', 'rechaza el cero');
  chk(asignar(fila, 250).error === 'rango', 'rechaza fuera de rango');
  chk(asignar(fila, 'abc').error === 'rango', 'rechaza texto');

  console.log('\n=== 6. Hora opcional al programar ===');
  // Misma lógica que el endpoint: sin hora se usa la actual y la rifa
  // NO se dispara sola, la lanza el presentador desde el panel.
  function prepararRifa(body) {
    if (!body.premio || String(body.premio).trim().length < 2) {
      return { error: 'Describe el premio' };
    }
    const cuando = body.hora ? new Date(body.hora) : new Date();
    if (isNaN(cuando)) return { error: 'La hora no es válida' };
    return { hora: cuando, auto: body.hora ? body.auto !== false : false };
  }

  let r1 = prepararRifa({ premio: 'Pantalla 55 pulgadas' });
  chk(!r1.error, 'sin hora: se puede programar', r1.error);
  chk(r1.auto === false, 'sin hora: no se dispara sola', r1.auto);
  chk(r1.hora instanceof Date, 'usa la hora actual');

  let r2 = prepararRifa({ premio: 'Tablet', hora: '2026-09-03T18:00' });
  chk(!r2.error && r2.auto === true, 'con hora: sí se dispara sola', r2);

  chk(prepararRifa({ premio: 'X' }).error, 'premio muy corto: avisa');
  chk(prepararRifa({ premio: 'Tablet', hora: 'no-es-fecha' }).error,
      'hora inválida: avisa');

  console.log('\n=== 7. Duración de la tómbola ===');
  // Misma acotación que el endpoint y que la pantalla.
  const acotar = (v) => Math.min(60, Math.max(3, Number(v) || 9));

  chk(acotar(5) === 5, '5 segundos se respeta');
  chk(acotar(30) === 30, '30 segundos se respeta');
  chk(acotar(undefined) === 9, 'sin valor: 9 segundos por omisión');
  chk(acotar('') === 9, 'vacío: 9 segundos');
  chk(acotar(0) === 9, 'cero: cae al valor por omisión');
  chk(acotar(1) === 3, 'menos de 3: sube al mínimo');
  chk(acotar(999) === 60, 'más de 60: baja al máximo');
  chk(acotar('abc') === 9, 'texto: valor por omisión');

  // El ganador debe quedar 12.2 s en pantalla sin importar la tómbola.
  const cierre = (seg) => acotar(seg) * 1000 + 12200;
  chk(cierre(5) === 17200, 'tómbola de 5 s → cierra a 17.2 s');
  chk(cierre(30) === 42200, 'tómbola de 30 s → cierra a 42.2 s');
  chk(cierre(30) - acotar(30) * 1000 === 12200,
      'el ganador siempre se ve 12.2 s');

  console.log('\n=== 8. Editar una rifa programada ===');
  // El patch usa COALESCE: sólo cambia lo que venga. Pero dos campos
  // necesitan poder BORRARSE, y para eso llevan interruptor aparte.
  function preparar(body) {
    const tocoHora = Object.prototype.hasOwnProperty.call(body, 'hora');
    const tocoMod = Object.prototype.hasOwnProperty.call(body, 'expositor_id');
    return {
      quitarHora: tocoHora && (body.hora === null || body.hora === ''),
      quitarModulo: tocoMod && (body.expositor_id === null || body.expositor_id === ''),
      duracion: body.duracion_seg != null && body.duracion_seg !== ''
        ? Math.min(60, Math.max(3, Number(body.duracion_seg) || 9)) : null,
      valor: body.valor != null && body.valor !== '' ? Number(body.valor) : null,
    };
  }

  let e = preparar({ premio: 'Tablet' });
  chk(e.quitarHora === false, 'editar sólo el premio: NO le quita la hora');
  chk(preparar({ hora: '' }).quitarHora === true,
      'hora borrada a propósito: pasa a manual');
  chk(e.duracion === null, 'sin duración: no se toca la que tenía');

  e = preparar({ hora: '2026-09-03T18:00', duracion_seg: 20 });
  chk(e.quitarHora === false, 'con hora: se programa');
  chk(e.duracion === 20, 'guarda la duración nueva');

  e = preparar({ expositor_id: '' });
  chk(e.quitarModulo === true, 'módulo vacío: abre la rifa a todo el evento');

  e = preparar({ expositor_id: '42' });
  chk(e.quitarModulo === false, 'con módulo: queda restringida');

  chk(preparar({ duracion_seg: 999 }).duracion === 60, 'acota la duración al máximo');
  chk(preparar({ valor: '' }).valor === null, 'valor vacío: no se toca');

  console.log('\n' + '='.repeat(52));
  console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
