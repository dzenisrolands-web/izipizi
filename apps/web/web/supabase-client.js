/* ============================================================
   Supabase savienojums sūtījumu pieteikumiem
   ------------------------------------------------------------
   Nodrošina globālo funkciju window.izipiziSaveOrder(record),
   ko izsauc pasutit.js. Ja Supabase nav nokonfigurēts
   (config.js vēl satur vietturus), funkcija atgriež false,
   un forma pārslēdzas uz e-pasta rezerves variantu.
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.IZIPIZI_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('TAVS-PROJEKTS') &&
    !cfg.SUPABASE_ANON_KEY.includes('TAVS_ANON_KEY');

  let client = null;
  if (configured && window.supabase) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  /* Saglabā pieteikumu. Atgriež true, ja izdevās, citādi false. */
  window.izipiziSaveOrder = async function (record) {
    if (!client) {
      console.warn('Supabase nav nokonfigurēts — izmanto e-pasta rezervi.');
      return false;
    }
    const { error } = await client.from('sutijumi').insert([record]);
    if (error) {
      console.error('Supabase insert kļūda:', error.message);
      return false;
    }
    return true;
  };
})();
