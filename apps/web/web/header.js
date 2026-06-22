/* ============================================================
   IziPizi — kopīgā galvene (header + mobile menu)
   Ielādē automātiski: <body data-page="pasutit">
   Aktīvā lapa tiek noteikta no data-page atribūta.
   ============================================================ */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { href: 'pasutit.html', key: 'pasutit', label: 'Sūtīt' },
    { href: 'zonas-cenas.html', key: 'zonas-cenas', label: 'Zonas/Cenas' },
    { href: 'pakomati.html', key: 'pakomati', label: 'Termo Pakomāts' },
    { href: 'par-izipizi.html', key: 'par-izipizi', label: 'Par izipizi' },
    { href: 'fransize.html', key: 'fransize', label: 'Franšīze' }
  ];

  var SHOP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M5.6 10h12.8l-1.1 8.1a1.3 1.3 0 0 1-1.3 1.1H8a1.3 1.3 0 0 1-1.3-1.1L5.6 10Z"/><path d="M4 10h16"/><path d="M9 10l1.4-4.6M15 10l-1.4-4.6"/><path d="M10 13.4v3M14 13.4v3"/></svg>';
  var ACC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5"/></svg>';

  var page = document.body.getAttribute('data-page') || '';

  function act(key) { return key === page ? ' act' : ''; }

  function buildNavLinks(mobile) {
    return NAV_ITEMS.map(function (n) {
      return '<a href="' + n.href + '"' + (act(n.key) ? ' class="act"' : '') + '>' + n.label + '</a>';
    }).join('');
  }

  // Header HTML
  var headerHTML = '' +
    '<header class="hdr">' +
    '  <a class="logo" href="index.html">izipizi</a>' +
    '  <nav class="main">' + buildNavLinks() + '</nav>' +
    '  <div class="cluster">' +
    '    <a class="shop" href="https://tirgus.izipizi.lv">' + SHOP_SVG + 'Ražotāju tirgus</a>' +
    '    <a class="acc" href="https://business.izipizi.lv">' + ACC_SVG + 'Mans konts</a>' +
    '  </div>' +
    '  <button class="burger" id="hdr-burger" aria-label="Atvērt izvēlni" aria-expanded="false">' +
    '    <span></span><span></span><span></span>' +
    '  </button>' +
    '</header>' +
    '<div class="mmenu" id="hdr-mmenu">' +
    '  <a class="mshop" href="https://tirgus.izipizi.lv">' + SHOP_SVG + 'Ražotāju tirgus</a>' +
    buildNavLinks(true) +
    '  <a class="macc" href="https://business.izipizi.lv">' + ACC_SVG + 'Mans konts</a>' +
    '</div>';

  // Inject at top of body
  var wrapper = document.createElement('div');
  wrapper.innerHTML = headerHTML;
  var body = document.body;
  while (wrapper.firstChild) {
    body.insertBefore(wrapper.firstChild, body.firstChild);
  }

  // Burger toggle
  var burger = document.getElementById('hdr-burger');
  var mmenu = document.getElementById('hdr-mmenu');
  if (burger && mmenu) {
    burger.addEventListener('click', function () {
      var open = mmenu.classList.toggle('open');
      burger.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!burger.contains(e.target) && !mmenu.contains(e.target)) {
        mmenu.classList.remove('open');
        burger.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();
