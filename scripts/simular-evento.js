'use strict';

/**
 * Simulación de evento completo contra la base real.
 * Ejercita: registro, escaneos, duplicados, boletos, sorteos y reglas.
 */

require('dotenv').config();
const { pool, enTransaccion, leerConfig } = require('../src/db');
const v = require('../src/services/vinculacion');
const sesion = require('../src/services/sesion');
const puntos = require('../src/services/puntos');
const sorteo = require('../src/services/sorteo');

let ok = 0, fallas = 0;
function chk(desc, cond, extra = '') {
  if (cond) { ok++; console.log(`  ok    ${desc}${extra ? ' — ' + extra : ''}`); }
  else { fallas++; console.log(`  FALLA ${desc}${extra ? ' — ' + extra : ''}`); }
}
const titulo = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  // Limpieza de datos transaccionales, conservando el catálogo.
  await pool.query(`TRUNCATE ganadores, boletos, escaneos, asistentes RESTART IDENTITY CASCADE`);
  await pool.query(`UPDATE rifas SET estado='pendiente', sorteada_en=NULL, auto=true`);
  await pool.query(`ALTER SEQUENCE seq_folio RESTART WITH 1`);

  const { rows: expos } = await pool.query(
    'SELECT id, nombre FROM expositores WHERE activo ORDER BY id'
  );
  chk('catálogo de expositores cargado', expos.length === 40, `${expos.length} módulos`);

  // ---------------------------------------------------------
  titulo('1. Registro de asistentes en el stand');

  const NOMBRES = ['María', 'José', 'Ana', 'Luis', 'Carmen', 'Jorge', 'Sofía',
    'Miguel', 'Lucía', 'Carlos', 'Elena', 'Ricardo', 'Paola', 'Fernando', 'Adriana'];
  const APELLIDOS = ['Hernández', 'García', 'Muñoz', 'Ríos', 'Vega', 'Castillo',
    'Navarro', 'Lozano', 'Serrano', 'Ibarra'];

  const gente = [];
  for (let i = 1; i <= 60; i++) {
    const r = await enTransaccion(async (c) => {
      const reg = await v.registrarNuevo(c, {
        nombre: NOMBRES[i % NOMBRES.length],
        apellido: APELLIDOS[i % APELLIDOS.length],
        telefono: `664${String(1000000 + i).slice(-7)}`,
      });
      if (!reg.ok) throw new Error('registro rechazado: ' + JSON.stringify(reg.errores));
      const cred = await sesion.emitirCredenciales(c, reg.id);
      return { ...reg, ...cred };
    });
    gente.push({ qr: r.qr_id, token: r.token, codigo: r.codigo, i });
  }
  chk('60 asistentes registrados', gente.length === 60);
  chk('todos con qr_id de 24 hex', gente.every((g) => /^[a-f0-9]{24}$/.test(g.qr)));
  chk('todos con código corto único', new Set(gente.map((g) => g.codigo)).size === 60);

  // Registro duplicado por teléfono
  const dup = await enTransaccion((c) => v.registrarNuevo(c, {
    nombre: 'Otro', apellido: 'Nombre', telefono: '6641000001',
  }));
  chk('teléfono repetido devuelve la cuenta original',
      dup.yaExistia === true && dup.qr_id === gente[0].qr);

  const { rows: cuenta } = await pool.query('SELECT COUNT(*)::int n FROM asistentes');
  chk('no se creó cuenta duplicada', cuenta[0].n === 60, `${cuenta[0].n} asistentes`);

  // ---------------------------------------------------------
  titulo('2. Escaneos en los módulos');

  let totalEscaneos = 0;
  for (const g of gente) {
    // Cada quien visita una cantidad distinta de módulos.
    const cuantos = 1 + (g.i * 7) % 25;
    for (let k = 0; k < cuantos; k++) {
      const expo = expos[(g.i * 3 + k * 5) % expos.length];
      const r = await enTransaccion((c) =>
        puntos.registrarEscaneo(c, { qrId: g.qr, expositorId: expo.id })
      );
      if (r.resultado === 'ok') totalEscaneos++;
    }
  }
  const { rows: e1 } = await pool.query('SELECT COUNT(*)::int n FROM escaneos');
  chk('escaneos registrados', e1[0].n === totalEscaneos, `${e1[0].n} escaneos`);

  // Duplicado: mismo asistente, mismo módulo
  const rDup = await enTransaccion((c) =>
    puntos.registrarEscaneo(c, { qrId: gente[0].qr, expositorId: expos[0].id })
  );
  const rDup2 = await enTransaccion((c) =>
    puntos.registrarEscaneo(c, { qrId: gente[0].qr, expositorId: expos[0].id })
  );
  chk('segundo escaneo del mismo módulo se rechaza', rDup2.resultado === 'duplicado');

  const { rows: e2 } = await pool.query(`
    SELECT COUNT(*)::int n FROM (
      SELECT asistente_id, expositor_id FROM escaneos
      GROUP BY 1,2 HAVING COUNT(*) > 1) t`);
  chk('no existe ningún par asistente+módulo repetido', e2[0].n === 0);

  // ---------------------------------------------------------
  titulo('3. Coherencia puntos ↔ boletos');

  const cfg = await leerConfig(pool);
  const ppb = Number(cfg.puntos_por_boleto);
  const { rows: desc } = await pool.query(`
    SELECT COUNT(*)::int n FROM v_asistentes
     WHERE boletos <> floor(puntos::numeric / ${ppb})`);
  chk('cada asistente tiene los boletos que le tocan', desc[0].n === 0);

  const { rows: fol } = await pool.query(`
    SELECT COUNT(*)::int total, COUNT(DISTINCT folio)::int unicos FROM boletos`);
  chk('folios únicos', fol[0].total === fol[0].unicos, `${fol[0].total} boletos`);

  const { rows: huerf } = await pool.query(`
    SELECT COUNT(*)::int n FROM boletos b
     WHERE NOT EXISTS (SELECT 1 FROM asistentes a WHERE a.id = b.asistente_id)`);
  chk('sin boletos huérfanos', huerf[0].n === 0);

  // ---------------------------------------------------------
  titulo('4. Asistente sin identificar (plan B)');

  const qrFantasma = v.generarQrId();
  const rF = await enTransaccion((c) =>
    puntos.registrarEscaneo(c, { qrId: qrFantasma, expositorId: expos[0].id })
  );
  chk('escaneo de QR desconocido se acepta', rF.resultado === 'ok');
  chk('se marca que requiere datos', rF.requiereDatos === true);
  chk('el punto sí se sumó', rF.asistente.puntos === 1);

  const estadoF = await v.consultarEstado(pool, qrFantasma);
  chk('queda en estado pendiente', estadoF.estado === 'pendiente');

  const vinc = await enTransaccion((c) => v.vincularDatos(c, qrFantasma, {
    nombre: 'Rescatado', apellido: 'Tarde', telefono: '6649999999',
  }));
  chk('completar datos lo verifica', vinc.ok && vinc.datos.estado === 'verificado');
  chk('conserva sus puntos previos', vinc.datos.puntos === 1);

  // ---------------------------------------------------------
  titulo('5. Recuperación de sesión');

  const porTk = await sesion.porToken(pool, gente[5].token);
  chk('restaurar por token de la liga', porTk && porTk.qr_id === gente[5].qr);
  chk('token inválido no entra', (await sesion.porToken(pool, 'a'.repeat(32))) === null);

  const rec = await enTransaccion((c) => sesion.recuperar(c,
    { telefono: '664' + String(1000006).slice(-7), codigo: gente[5].codigo },
    v.parseTelefono));
  chk('recuperar con teléfono + código', rec.ok === true);
  chk('emite token nuevo', rec.ok && rec.token !== gente[5].token);
  chk('el token viejo deja de servir',
      (await sesion.porToken(pool, gente[5].token)) === null);

  const malo = await enTransaccion((c) => sesion.recuperar(c,
    { telefono: '6641000007', codigo: 'ZZZZZZ' }, v.parseTelefono));
  chk('código equivocado se rechaza', malo.ok === false);

  // Bloqueo por intentos
  let bloqueado = false;
  for (let i = 0; i < 6; i++) {
    const r = await enTransaccion((c) => sesion.recuperar(c,
      { telefono: '6641000008', codigo: 'ZZZZZZ' }, v.parseTelefono));
    if (r.motivo === 'bloqueado') bloqueado = true;
  }
  chk('se bloquea tras varios intentos fallidos', bloqueado);

  // ---------------------------------------------------------
  titulo('6. Sorteos');

  const { rows: rifas } = await pool.query('SELECT * FROM rifas ORDER BY hora');

  const previa = await sorteo.previaElegibles(pool, rifas[0].id);
  chk('previa cuenta participantes',
      previa.personas > 0 && previa.boletos >= previa.personas,
      `${previa.personas} personas / ${previa.boletos} boletos`);

  const s1 = await enTransaccion((c) => sorteo.sortear(c, rifas[0].id, { actor: 'prueba' }));
  chk('primera rifa se sortea', s1.ok === true);
  chk('entrega el número de ganadores pedido',
      s1.ok && s1.ganadores.length === rifas[0].num_ganadores);
  chk('el ganador tiene datos de contacto',
      s1.ok && !!s1.ganadores[0].nombre && !!s1.ganadores[0].telefono);

  const s1b = await enTransaccion((c) => sorteo.sortear(c, rifas[0].id, { actor: 'prueba' }));
  chk('no se puede sortear dos veces', s1b.ok === false && s1b.motivo === 'ya_sorteada');

  const s2 = await enTransaccion((c) => sorteo.sortear(c, rifas[1].id, { actor: 'prueba' }));
  chk('segunda rifa con 2 ganadores', s2.ok && s2.ganadores.length === 2);
  chk('los 2 ganadores son personas distintas',
      s2.ok && s2.ganadores[0].asistente_id !== s2.ganadores[1].asistente_id);

  const ganadoresPrevios = [s1.ganadores, s2.ganadores].flat().map((g) => g.asistente_id);
  const s3 = await enTransaccion((c) => sorteo.sortear(c, rifas[2].id, { actor: 'prueba' }));
  chk('un ganador previo no vuelve a ganar',
      s3.ok && !ganadoresPrevios.includes(s3.ganadores[0].asistente_id));

  // Sólo verificados participan
  const { rows: gp } = await pool.query(`
    SELECT COUNT(*)::int n FROM ganadores g
     JOIN asistentes a ON a.id = g.asistente_id WHERE a.estado <> 'verificado'`);
  chk('ningún ganador está sin verificar', gp[0].n === 0);

  // ---------------------------------------------------------
  titulo('7. Ponderación por boletos');

  await pool.query(`TRUNCATE ganadores RESTART IDENTITY`);
  await pool.query(`UPDATE config SET valor='no' WHERE clave='excluir_ganadores'`);
  await pool.query(`UPDATE rifas SET estado='pendiente' WHERE id=$1`, [rifas[3].id]);

  const { rows: topBol } = await pool.query(
    `SELECT id, boletos FROM v_asistentes ORDER BY boletos DESC LIMIT 1`);
  const { rows: totBol } = await pool.query(`
    SELECT COUNT(*)::int n FROM boletos b JOIN asistentes a ON a.id=b.asistente_id
     WHERE a.estado='verificado'`);

  const CORRIDAS = 3000;
  let vecesTop = 0;
  for (let i = 0; i < CORRIDAS; i++) {
    const r = await enTransaccion(async (c) => {
      const { rows: rf } = await c.query('SELECT * FROM rifas WHERE id=$1', [rifas[3].id]);
      const cfg2 = await leerConfig(c);
      const el = await sorteo.boletosElegibles(c, rf[0], cfg2);
      return el[sorteo.aleatorioSeguro(el.length)];
    });
    if (r.asistente_id === topBol[0].id) vecesTop++;
  }
  const esperado = topBol[0].boletos / totBol[0].n;
  const observado = vecesTop / CORRIDAS;
  const desvio = Math.abs(observado - esperado) / esperado;
  chk('probabilidad proporcional a los boletos', desvio < 0.20,
      `esperado ${(esperado * 100).toFixed(2)}% / observado ${(observado * 100).toFixed(2)}%`);

  await pool.query(`UPDATE config SET valor='si' WHERE clave='excluir_ganadores'`);

  // ---------------------------------------------------------
  titulo('8. Rifa sin participantes elegibles');

  await pool.query(`UPDATE config SET valor='40' WHERE clave='min_modulos_rifa'`);
  await pool.query(`UPDATE rifas SET estado='pendiente' WHERE id=$1`, [rifas[3].id]);
  const sVacia = await enTransaccion((c) => sorteo.sortear(c, rifas[3].id, { actor: 'prueba' }));
  chk('avisa cuando nadie califica',
      sVacia.ok === false && sVacia.motivo === 'sin_participantes');
  const { rows: est } = await pool.query('SELECT estado FROM rifas WHERE id=$1', [rifas[3].id]);
  chk('la rifa NO se marca finalizada si no hubo sorteo', est[0].estado === 'pendiente');
  await pool.query(`UPDATE config SET valor='0' WHERE clave='min_modulos_rifa'`);

  // ---------------------------------------------------------
  titulo('9. Métricas y vistas');

  const m = await puntos.metricas(pool);
  chk('métricas coherentes',
      m.asistentes === 61 && m.escaneos > 0 && m.boletos > 0,
      `${m.asistentes} asistentes, ${m.escaneos} escaneos, ${m.boletos} boletos`);

  const prog = await puntos.progresoDe(pool, gente[0].qr);
  chk('progreso lista los 40 módulos', prog.length === 40);
  chk('marca correctamente los visitados',
      prog.filter((p) => p.visitado).length > 0,
      `${prog.filter((p) => p.visitado).length} visitados`);

  const { rows: rank } = await pool.query('SELECT * FROM v_ranking LIMIT 5');
  chk('ranking ordenado de mayor a menor',
      rank.every((r, i) => i === 0 || Number(rank[i - 1].puntos) >= Number(r.puntos)));

  // ---------------------------------------------------------
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${ok} pruebas pasaron, ${fallas} fallaron`);
  console.log('='.repeat(52) + '\n');

  await pool.end();
  process.exit(fallas ? 1 : 0);
})().catch((err) => {
  console.error('\nError en la simulación:', err);
  process.exit(1);
});
