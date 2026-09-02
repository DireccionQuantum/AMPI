'use strict';
/**
 * Captura del correo en la mesa de entrega.
 * Se valida la misma regla que aplica el endpoint, sin base de datos.
 */
let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

// Copia exacta de la validación del endpoint
function validar(crudo) {
  const s = String(crudo || '').trim().toLowerCase();
  if (!s) return { ok: true, email: null };          // vacío borra
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) || s.length > 120) {
    return { ok: false };
  }
  return { ok: true, email: s };
}

console.log('=== Correos que se aceptan ===');
[
  ['juan@empresa.mx', 'juan@empresa.mx'],
  ['  JUAN@Empresa.MX  ', 'juan@empresa.mx'],
  ['maria.lopez@sub.dominio.com.mx', 'maria.lopez@sub.dominio.com.mx'],
  ['a+b@c.io', 'a+b@c.io'],
].forEach(([e, esperado]) => {
  const r = validar(e);
  chk(r.ok && r.email === esperado, `«${e.trim()}» → ${esperado}`, r);
});

console.log('\n=== Se rechazan ===');
['sin-arroba', 'falta@dominio', '@solodominio', 'espacio @ mal.com',
 'x'.repeat(115) + '@larguisimo.com',
].forEach((e) => {
  chk(!validar(e).ok, `«${e.slice(0, 26)}»`, validar(e));
});

console.log('\n=== Vacío borra el correo ===');
[['', null], ['   ', null], [null, null]].forEach(([e, esperado]) => {
  const r = validar(e);
  chk(r.ok && r.email === esperado, `«${e}» → borra`, r);
});

console.log('\n' + '='.repeat(50));
console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
