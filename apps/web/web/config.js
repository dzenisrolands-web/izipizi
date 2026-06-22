/* ============================================================
   Supabase konfigurācija
   ------------------------------------------------------------
   AIZVIETO šīs divas vērtības ar savām no Supabase paneļa:
   Project Settings → API → Project URL un publishable/anon key

   DROŠĪBA: anon (publishable) atslēga ir DROŠA ievietot
   priekšgala kodā — tā strādā tikai caur RLS politikām,
   ko mēs iestatām supabase-setup.sql failā.
   NEKAD šeit neliec service_role atslēgu!
   ============================================================ */

window.IZIPIZI_CONFIG = {
  SUPABASE_URL: 'https://wepyslyqcxpszobfkzzs.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BMqu4RvrA4cl72OJQQakLA_8Amc2F8-'
};
