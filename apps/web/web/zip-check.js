/* Pasta indeksu pārbaude — īstie dati no www.izipizi.lv/zonas-cenas */
(function () {
  'use strict';

  const ZONES = {
    0: {
      name: 'Rīgas centrs',
      indices: ['1001','1002','1003','1004','1009','1010','1011','1012','1013','1019','1045','1046','1048','1050']
    },
    1: {
      name: 'Rīgas mikrorajoni',
      indices: ['1005','1006','1007','1014','1015','1021','1023','1024','1026','1029','1034','1035','1039','1053','1055','1057','1058','1063','1064','1067','1069','1073','1076','1079','1082','1083','1084','2101','2108','2111','2112','2119','2128','2130','2167']
    },
    2: {
      name: 'Tuvā Pierīga',
      indices: ['1016','1030','2103','2107','2114','2117','2118','2121','2123','2127','2137','2163','2164','2166','2169']
    },
    3: {
      name: 'Tālā Pierīga',
      indices: ['2008','2010','2011','2012','2015','2016','2105','5001','5015','5016','5041','5052','5060','5070','5071']
    }
  };

  const PRICES = {
    0: { std: { single: '6,40' }, exp: { single: '7,50' } },
    1: { std: { single: '6,40' }, exp: { single: '9,00' } },
    2: { std: { single: '8,40' }, exp: { single: '12,50' } },
    3: { std: { single: '9,90' }, exp: null }
  };

  function findZone(zip) {
    zip = String(zip).replace(/\D/g, '').slice(0, 4);
    if (zip.length !== 4) return null;
    for (const z in ZONES) {
      if (ZONES[z].indices.includes(zip)) return parseInt(z, 10);
    }
    return null;
  }

  function render(zone, zip) {
    const r = document.getElementById('zipResult');
    if (zone === null) {
      r.className = 'zip-result';
      r.innerHTML = `
        <strong>Pasta indekss ${zip} nav atrasts 0.–3. zonā.</strong><br>
        <span style="color: var(--izp-gray); font-size: 13px;">Iespējams, tas pieder 4. zonai (pārējā Latvija). Sazinies ar mums individuālam cenas piedāvājumam.</span><br>
        <a href="mailto:birojs@izipizi.lv?subject=Cenas%20piedāvājums%20-%204.%20zona" style="display: inline-block; margin-top: 12px; color: var(--izp-orange); font-weight: 600; font-size: 14px;">birojs@izipizi.lv →</a>
      `;
      return;
    }

    const p = PRICES[zone];
    r.className = 'zip-result';
    let expText = p.exp ? `, ekspress no <strong>${p.exp.single} €</strong>` : ', <strong>ekspress nav pieejams</strong>';
    r.innerHTML = `
      <div class="zip-result-zone">Zona ${zone}</div>
      <div style="font-size: 16px; margin-bottom: 8px;"><strong>${zip}</strong> — ${ZONES[zone].name}</div>
      <p style="margin: 0; color: var(--izp-gray); font-size: 14px;">
        Standarta piegāde no <strong style="color: var(--izp-black);">${p.std.single} €</strong> termo režīmā${expText}.
      </p>
      <p style="margin: 8px 0 0; font-size: 12px; color: var(--izp-gray);">
        Pilna cenu tabula ↓ zemāk šajā lapā.
      </p>
    `;
  }

  function check() {
    const zip = document.getElementById('zipInput').value.trim();
    if (!zip) return;
    const zone = findZone(zip);
    render(zone, zip);
  }

  document.getElementById('zipBtn').addEventListener('click', check);
  document.getElementById('zipInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') check();
  });
  document.getElementById('zipInput').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) check();
  });
})();
