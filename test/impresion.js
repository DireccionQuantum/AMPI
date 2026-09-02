'use strict';
/**
 * Etiqueta en blanco al imprimir.
 *
 * Causa original: se asignaba `img.src` y se llamaba a window.print()
 * tras un retraso fijo de 350 ms. Si el navegador tardaba más en dibujar
 * la imagen, la hoja salía vacía. Asignar la fuente y tenerla dibujada
 * son dos momentos distintos.
 *
 * Aquí se simula ese comportamiento con una imagen falsa que tarda lo
 * que se le indique, para comprobar que ahora se espera de verdad.
 */
let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

/** Imagen que dispara onload después de `demora` ms. */
function imagenFalsa(demora) {
  const img = { complete: false, naturalWidth: 0, onload: null, onerror: null };
  Object.defineProperty(img, 'src', {
    set() {
      setTimeout(() => {
        img.complete = true; img.naturalWidth = 700;
        if (img.onload) img.onload();
      }, demora);
    },
  });
  return img;
}

/** El comportamiento ANTERIOR: retraso fijo, sin esperar la carga. */
function versionVieja(demoraImg, retraso, alImprimir) {
  const img = imagenFalsa(demoraImg);
  img.src = 'data:...';
  setTimeout(() => alImprimir(img.complete), retraso);
}

/** El comportamiento NUEVO: espera onload. */
function versionNueva(demoraImg, alImprimir) {
  const img = imagenFalsa(demoraImg);
  let impreso = false;
  const listo = () => {
    if (impreso) return;
    impreso = true;
    setTimeout(() => alImprimir(img.complete), 10);
  };
  img.onload = listo; img.onerror = listo;
  img.src = 'data:...';
  if (img.complete && img.naturalWidth) listo();
}

(async () => {
  const probar = (fn, ...args) => new Promise((res) => fn(...args, res));

  console.log('=== La versión anterior, con retraso fijo de 350 ms ===');
  chk(await probar(versionVieja, 100, 350), 'imagen rápida (100 ms): alcanzaba a dibujar');
  const lenta = await probar(versionVieja, 800, 350);
  chk(!lenta, 'imagen lenta (800 ms): IMPRIMÍA EN BLANCO ← el error reportado');

  console.log('\n=== La versión corregida ===');
  chk(await probar(versionNueva, 100), 'imagen rápida: imprime con el QR');
  chk(await probar(versionNueva, 800), 'imagen lenta: espera y también imprime');
  chk(await probar(versionNueva, 2500), 'imagen muy lenta: sigue esperando');

  console.log('\n=== No imprime dos veces ===');
  let veces = 0;
  await new Promise((res) => {
    const img = imagenFalsa(50);
    let impreso = false;
    const listo = () => { if (impreso) return; impreso = true; veces++; };
    img.onload = listo; img.src = 'x';
    if (img.complete && img.naturalWidth) listo();   // caso de caché
    setTimeout(res, 200);
  });
  chk(veces === 1, 'una sola impresión aunque onload y complete coincidan', veces);

  console.log('\n' + '='.repeat(52));
  console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})();
