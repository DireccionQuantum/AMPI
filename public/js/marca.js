/**
 * Marca compartida — Gamificación AMPI 2026
 *
 * Inyecta el crédito de Quantum en todas las pantallas de forma
 * consistente, y resuelve los logos: si el administrador subió uno
 * desde el panel se usa ése; si no, cae al que viene con el sistema.
 *
 * Uso: <script src="/js/marca.js" data-marca="claro|oscuro"></script>
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var tema = (script && script.dataset.marca) || 'claro';
  var posicion = (script && script.dataset.pos) || 'fijo';

  var LOGO_POR_DEFECTO = tema === 'oscuro'
    ? '/img/quantum-claro-sm.png'
    : '/img/quantum-h-sm.png';

  /**
   * Devuelve la URL del logo de la agencia. Intenta el subido por el
   * admin y, si no existe, usa el que viene incluido.
   */
  function urlLogoAgencia(cb) {
    var clave = tema === 'oscuro' ? 'logo_agencia_claro' : 'logo_agencia';
    var img = new Image();
    img.onload = function () { cb('/api/marca/' + clave); };
    img.onerror = function () { cb(LOGO_POR_DEFECTO); };
    img.src = '/api/marca/' + clave;
  }

  /** Logo del evento (cliente). Devuelve null si no hay ninguno cargado. */
  window.logoEvento = function (cb) {
    var img = new Image();
    img.onload = function () { cb('/api/marca/logo_evento'); };
    img.onerror = function () { cb(null); };
    img.src = '/api/marca/logo_evento';
  };

  function estilos() {
    if (document.getElementById('css-marca')) return;
    var css = document.createElement('style');
    css.id = 'css-marca';
    css.textContent = [
      '.q-credito{',
      '  display:flex;align-items:center;justify-content:center;gap:9px;',
      '  padding:18px 16px calc(env(safe-area-inset-bottom, 0px) + 18px);',
      '  text-decoration:none;opacity:.55;transition:opacity .2s;',
      '}',
      '.q-credito:hover{opacity:1}',
      '.q-credito img{height:19px;width:auto;display:block}',
      '.q-credito .q-txt{',
      '  font-family:"Nunito Sans",system-ui,sans-serif;',
      '  font-size:9.5px;font-weight:800;letter-spacing:.17em;',
      '  text-transform:uppercase;white-space:nowrap;',
      '}',
      '.q-credito.q-claro .q-txt{color:#6b7b8f}',
      '.q-credito.q-oscuro .q-txt{color:rgba(255,255,255,.6)}',
      '.q-credito .q-sep{',
      '  width:1px;height:15px;flex:0 0 1px;',
      '}',
      '.q-credito.q-claro .q-sep{background:#dde4ea}',
      '.q-credito.q-oscuro .q-sep{background:rgba(255,255,255,.22)}',
      '@media(max-width:360px){.q-credito .q-txt{font-size:8.5px;letter-spacing:.12em}}',
    ].join('\n');
    document.head.appendChild(css);
  }

  function montar() {
    estilos();

    var a = document.createElement('a');
    a.className = 'q-credito ' + (tema === 'oscuro' ? 'q-oscuro' : 'q-claro');
    a.href = 'https://quantummkt.mx';
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'Desarrollado por Quantum Marketing & Advertising');

    var txt = document.createElement('span');
    txt.className = 'q-txt';
    txt.textContent = 'Powered by';

    var sep = document.createElement('span');
    sep.className = 'q-sep';

    var img = document.createElement('img');
    img.alt = 'Quantum Marketing & Advertising';
    img.decoding = 'async';
    img.loading = 'lazy';

    a.appendChild(txt);
    a.appendChild(sep);
    a.appendChild(img);

    urlLogoAgencia(function (url) { img.src = url; });

    var destino = document.querySelector('[data-credito]');
    if (destino) destino.appendChild(a);
    else if (posicion === 'fijo') document.body.appendChild(a);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
