/* ============================================================
   IziPizi — adrešu autocomplete (Nominatim / OpenStreetMap)
   Sāk meklēt pēc 3 simboliem, 400ms debounce.
   Rezultāts: adrese + pasta indekss.

   Lietošana:
     izipiziAutocomplete(inputEl, {
       onSelect: function(parsed) { ... }
     });
   parsed = { fullText, street, city, postalCode }
   ============================================================ */
(function () {
  'use strict';

  // --- CSS (inject once) ---
  var styleId = 'izp-ac-style';
  if (!document.getElementById(styleId)) {
    var css = document.createElement('style');
    css.id = styleId;
    css.textContent =
      '.izp-ac-wrap{position:relative}' +
      '.izp-ac-list{position:absolute;z-index:50;left:0;right:0;margin-top:4px;max-height:260px;overflow-y:auto;' +
      'background:#fff;border:1.5px solid #c6d3cc;border-radius:14px;box-shadow:0 8px 28px -8px rgba(25,38,53,.22);list-style:none;padding:4px}' +
      '.izp-ac-list li{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:background .1s}' +
      '.izp-ac-list li:hover{background:#f1fdf7}' +
      '.izp-ac-pin{flex:none;width:16px;height:16px;margin-top:2px;color:#8696a0}' +
      '.izp-ac-primary{font-size:14px;font-weight:600;color:#192635;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.izp-ac-secondary{font-size:12px;color:#8696a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}' +
      '.izp-ac-spin{position:absolute;right:12px;top:50%;margin-top:-8px;width:16px;height:16px;border:2px solid #dde7e1;border-top-color:#53F3A4;border-radius:50%;animation:izp-spin .6s linear infinite}' +
      '@keyframes izp-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(css);
  }

  var PIN_SVG = '<svg class="izp-ac-pin" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>';

  function parseResult(r) {
    var a = r.address || {};
    var road = a.road || a.pedestrian || '';
    var street = [road, a.house_number].filter(Boolean).join(' ').trim();
    var city = a.city || a.town || a.village || a.municipality || a.suburb || a.neighbourhood || a.county || '';
    var postalCode = (a.postcode || '').replace(/^LV[-\s]?/i, '').replace(/\D/g, '').slice(0, 4);
    return { fullText: r.display_name, street: street, city: city, postalCode: postalCode };
  }

  window.izipiziAutocomplete = function (input, opts) {
    opts = opts || {};
    var onSelect = opts.onSelect || function () {};
    var debounceMs = opts.debounce || 400;
    var minChars = opts.minChars || 3;

    // Wrap input
    var wrap = document.createElement('div');
    wrap.className = 'izp-ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var list = document.createElement('ul');
    list.className = 'izp-ac-list';
    list.style.display = 'none';
    wrap.appendChild(list);

    var spinner = null;
    var timer = null;
    var abortCtrl = null;
    var justPicked = false;

    function showSpinner() {
      if (spinner) return;
      spinner = document.createElement('div');
      spinner.className = 'izp-ac-spin';
      wrap.appendChild(spinner);
    }
    function hideSpinner() {
      if (spinner) { spinner.remove(); spinner = null; }
    }

    function close() {
      list.style.display = 'none';
      list.innerHTML = '';
    }

    function pick(r) {
      var parsed = parseResult(r);
      justPicked = true;
      input.value = parsed.street ? (parsed.street + ', ' + parsed.city) : parsed.fullText.split(',').slice(0, 2).join(',');
      close();
      onSelect(parsed);
      // Trigger input event for any listeners
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(function(){ justPicked = false; }, 300);
    }

    function search(query) {
      if (abortCtrl) abortCtrl.abort();
      var ctrl = new AbortController();
      abortCtrl = ctrl;
      showSpinner();

      var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=lv&addressdetails=1&limit=6&accept-language=lv&q=' + encodeURIComponent(query);

      fetch(url, { signal: ctrl.signal })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          hideSpinner();
          if (!data || !data.length) { close(); return; }
          list.innerHTML = '';
          data.forEach(function (r) {
            var parsed = parseResult(r);
            var primary = parsed.street || r.display_name.split(',')[0] || r.display_name;
            var parts = [parsed.city];
            if (parsed.postalCode) parts.push('LV-' + parsed.postalCode);
            var secondary = parts.filter(Boolean).join(', ');

            var li = document.createElement('li');
            li.innerHTML = PIN_SVG +
              '<div style="min-width:0;flex:1">' +
              '<div class="izp-ac-primary">' + escHtml(primary) + '</div>' +
              (secondary ? '<div class="izp-ac-secondary">' + escHtml(secondary) + '</div>' : '') +
              '</div>';
            li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(r); });
            list.appendChild(li);
          });
          list.style.display = 'block';
        })
        .catch(function (err) {
          hideSpinner();
          if (err.name !== 'AbortError') console.error('Autocomplete error:', err);
        });
    }

    input.addEventListener('input', function () {
      if (justPicked) return;
      var v = input.value.trim();
      if (v.length < minChars) { close(); hideSpinner(); return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { search(v); }, debounceMs);
    });

    input.addEventListener('focus', function () {
      if (list.children.length > 0) list.style.display = 'block';
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });
  };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
