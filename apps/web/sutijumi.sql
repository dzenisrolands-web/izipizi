-- ============================================================
-- IziPizi — sutijumi tabulas migrācija (v2)
-- ------------------------------------------------------------
-- Atjaunina tabulu no vecā zip-kodu formāta uz jauno
-- pakomātu/kurjera formātu.
--
-- Kā lietot:
-- 1. Atver Supabase projektu: https://wepyslyqcxpszobfkzzs.supabase.co
-- 2. Ej uz "SQL Editor" (kreisajā izvēlnē)
-- 3. Iekopē visu šo failu un nospied "Run"
-- ============================================================

-- Nomet veco tabulu (ja nav svarīgu datu)
drop table if exists public.sutijumi cascade;

-- Jauna tabula ar pakomātu/kurjera laukiem
create table public.sutijumi (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- Piegādes veids
  delivery_type   text not null default 'locker',  -- locker / courier

  -- Maršruts (pakomāts)
  from_locker       text,                           -- pakomāta id (piem., 'brivibas')
  from_locker_name  text,                           -- cilvēklasāms (piem., 'Rīga, Brīvības iela 253')
  to_locker         text,                           -- mērķa pakomāta id
  to_locker_name    text,
  same_locker       boolean not null default false,  -- saņēmējs tajā pašā pakomātā

  -- Maršruts (kurjers)
  courier_address   text,                           -- piegādes adrese (kurjeram)
  courier_zip       text,                           -- pasta indekss (kurjeram)

  -- Sūtījums
  size              text not null default 'M',      -- M / L / XL
  temp_mode         text,                           -- '+2...+6 °C' / '−18 °C'

  -- Sūtītājs
  sender_name       text not null,
  sender_phone      text not null,
  sender_email      text,                           -- neobligāts

  -- Saņēmējs
  recipient_name    text not null,
  recipient_phone   text not null,
  note              text,                           -- sūtījuma apraksts

  -- Cena (€ ar PVN)
  price_total       numeric(8,2),

  -- Statuss
  status            text not null default 'new',    -- new / confirmed / paid / delivered / cancelled

  -- NĀKAMAIS SOLIS: Paysera apmaksas integrācija
  -- payment_id      text,                          -- Paysera darījuma ID
  -- payment_status  text default 'pending',        -- pending / paid / failed
  -- paid_at         timestamptz                    -- apmaksas laiks
);

-- RLS (Row Level Security)
alter table public.sutijumi enable row level security;

-- Anon drīkst tikai INSERT (forma iesūta pieteikumu)
drop policy if exists "Atļaut publisku pieteikuma iesniegšanu" on public.sutijumi;
create policy "Atļaut publisku pieteikuma iesniegšanu"
  on public.sutijumi
  for insert
  to anon
  with check (true);

-- Autentificētie (admin) drīkst lasīt
drop policy if exists "Tikai administratori lasa pieteikumus" on public.sutijumi;
create policy "Tikai administratori lasa pieteikumus"
  on public.sutijumi
  for select
  to authenticated
  using (true);

-- Autentificētie drīkst atjaunot statusu
create policy "Administratori atjaunina statusu"
  on public.sutijumi
  for update
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- GATAVS. Forma var iesniegt pieteikumus ar anon atslēgu.
-- Pieteikumus apskati: Table Editor → sutijumi
--
-- NĀKAMAIS SOLIS: Paysera apmaksa
-- Kad integrēsim Paysera, nokomentē payment_* kolonnas augstāk
-- un pievieno webhook endpoint, kas atjaunina payment_status.
-- ============================================================
