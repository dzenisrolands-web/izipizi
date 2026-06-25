-- ============================================================
-- IziPizi — Migration 0002: Admin + Franšīzes sistēma
-- Priekšnosacījums: 0001_foundation.sql (pakomati, franchise_partners, sutijumi, user_roles)
-- ============================================================

-- 1.1 Pakomātu papildinājumi
ALTER TABLE public.pakomati ADD COLUMN IF NOT EXISTS has_warehouse boolean NOT NULL DEFAULT false;
ALTER TABLE public.pakomati ADD COLUMN IF NOT EXISTS is_hub boolean NOT NULL DEFAULT false;
ALTER TABLE public.pakomati ADD COLUMN IF NOT EXISTS note text;

-- 1.2 Helper: pašreizējā lietotāja partnera id
CREATE OR REPLACE FUNCTION public.current_partner_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.franchise_partners WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 1.3 Franšīzes pieteikumi (publiskā forma)
CREATE TABLE IF NOT EXISTS public.franchise_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL,
  company_name text,
  email        text NOT NULL,
  phone        text,
  city         text,
  message      text,
  status       text NOT NULL DEFAULT 'jauns',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 1.4 Ieņēmumu sadalījums
CREATE TABLE IF NOT EXISTS public.revenue_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sutijums_id     uuid NOT NULL,
  partner_id      uuid REFERENCES public.franchise_partners(id),
  pakomats_id     uuid REFERENCES public.pakomati(id),
  role            text NOT NULL,
  gross           numeric(10,2) NOT NULL,
  vat             numeric(10,2) NOT NULL DEFAULT 0,
  net             numeric(10,2) NOT NULL,
  partner_amount  numeric(10,2) NOT NULL DEFAULT 0,
  izipizi_amount  numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revenue_alloc_partner_idx ON public.revenue_allocations(partner_id);
CREATE INDEX IF NOT EXISTS revenue_alloc_sutijums_idx ON public.revenue_allocations(sutijums_id);

-- 1.5 Partneru izmaksas
CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES public.franchise_partners(id),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  amount       numeric(10,2) NOT NULL,
  status       text NOT NULL DEFAULT 'gaida',
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. RLS
-- ============================================================
ALTER TABLE public.franchise_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_allocations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payouts        ENABLE ROW LEVEL SECURITY;

-- Franšīzes pieteikumi: ikviens drīkst IESNIEGT; lasa tikai admin
DROP POLICY IF EXISTS "applications_insert_any" ON public.franchise_applications;
CREATE POLICY "applications_insert_any" ON public.franchise_applications
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "applications_admin_read" ON public.franchise_applications;
CREATE POLICY "applications_admin_read" ON public.franchise_applications
  FOR SELECT USING (public.has_role('admin'));

DROP POLICY IF EXISTS "applications_admin_manage" ON public.franchise_applications;
CREATE POLICY "applications_admin_manage" ON public.franchise_applications
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Pakomāti: admin pārvalda; partneris lasa savus
DROP POLICY IF EXISTS "pakomati_admin_manage" ON public.pakomati;
CREATE POLICY "pakomati_admin_manage" ON public.pakomati
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Ieņēmumu sadalījums: admin visu; partneris savu
DROP POLICY IF EXISTS "alloc_admin_all" ON public.revenue_allocations;
CREATE POLICY "alloc_admin_all" ON public.revenue_allocations
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

DROP POLICY IF EXISTS "alloc_partner_read" ON public.revenue_allocations;
CREATE POLICY "alloc_partner_read" ON public.revenue_allocations
  FOR SELECT USING (public.has_role('admin') OR partner_id = public.current_partner_id());

-- Izmaksas: admin visu; partneris savu
DROP POLICY IF EXISTS "payouts_admin_all" ON public.partner_payouts;
CREATE POLICY "payouts_admin_all" ON public.partner_payouts
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

DROP POLICY IF EXISTS "payouts_partner_read" ON public.partner_payouts;
CREATE POLICY "payouts_partner_read" ON public.partner_payouts
  FOR SELECT USING (public.has_role('admin') OR partner_id = public.current_partner_id());

-- ============================================================
-- 3. allocate_revenue() — ieņēmumu sadalīšana
-- Izsauc kad sūtījuma statuss = 'izsniegts'
-- Idempotenta: ja jau sadalīts, neko nedara
-- ============================================================
CREATE OR REPLACE FUNCTION public.allocate_revenue(_sutijums_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  net_amount numeric(10,2);
  vat_amount numeric(10,2);
  pickup_pak record;
  dropoff_pak record;
  pickup_partner record;
  dropoff_partner record;
  logistics_fee numeric(10,2) := 1.50;
  remaining numeric(10,2);
  partners_pool numeric(10,2);
  each_end numeric(10,2);
  izipizi_total numeric(10,2);
BEGIN
  -- Idempotence check
  IF EXISTS (SELECT 1 FROM public.revenue_allocations WHERE sutijums_id = _sutijums_id) THEN
    RETURN;
  END IF;

  -- Get shipment
  SELECT * INTO s FROM public.shipments WHERE id = _sutijums_id;
  IF s IS NULL THEN
    -- Try legacy sutijumi table
    RETURN;
  END IF;

  net_amount := round(s.price / 1.21, 2);
  vat_amount := s.price - net_amount;

  IF s.order_type = 'single_locker' THEN
    -- Single locker: one pakomāts
    SELECT * INTO pickup_pak FROM public.pakomati WHERE id = COALESCE(s.pickup_pakomats_id, s.dropoff_pakomats_id);

    IF pickup_pak.franchise_partner_id IS NOT NULL THEN
      SELECT * INTO pickup_partner FROM public.franchise_partners WHERE id = pickup_pak.franchise_partner_id;
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, pickup_partner.id, pickup_pak.id, 'single',
         s.price, vat_amount, net_amount,
         round(net_amount * pickup_partner.revenue_share_pct / 100, 2),
         round(net_amount * (100 - pickup_partner.revenue_share_pct) / 100, 2));
    ELSE
      -- IziPizi own locker — all to IziPizi
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, NULL, pickup_pak.id, 'single',
         s.price, vat_amount, net_amount, 0, net_amount);
    END IF;

  ELSE
    -- Inter-locker: pickup + dropoff
    SELECT * INTO pickup_pak FROM public.pakomati WHERE id = s.pickup_pakomats_id;
    SELECT * INTO dropoff_pak FROM public.pakomati WHERE id = s.dropoff_pakomats_id;

    remaining := net_amount - logistics_fee;
    partners_pool := round(remaining * 0.50, 2);
    each_end := round(partners_pool / 2, 2);
    izipizi_total := logistics_fee + round(remaining * 0.50, 2);

    -- Logistics fee → IziPizi
    INSERT INTO public.revenue_allocations
      (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
    VALUES
      (_sutijums_id, NULL, NULL, 'logistics',
       0, 0, logistics_fee, 0, logistics_fee);

    -- Pickup end
    IF pickup_pak IS NOT NULL AND pickup_pak.franchise_partner_id IS NOT NULL THEN
      SELECT * INTO pickup_partner FROM public.franchise_partners WHERE id = pickup_pak.franchise_partner_id;
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, pickup_partner.id, pickup_pak.id, 'pickup',
         0, 0, each_end, each_end, 0);
    ELSE
      -- No partner at pickup → IziPizi keeps it
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, NULL, CASE WHEN pickup_pak IS NOT NULL THEN pickup_pak.id ELSE NULL END, 'pickup',
         0, 0, each_end, 0, each_end);
      izipizi_total := izipizi_total + each_end;
    END IF;

    -- Dropoff end
    IF dropoff_pak IS NOT NULL AND dropoff_pak.franchise_partner_id IS NOT NULL THEN
      SELECT * INTO dropoff_partner FROM public.franchise_partners WHERE id = dropoff_pak.franchise_partner_id;
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, dropoff_partner.id, dropoff_pak.id, 'dropoff',
         0, 0, each_end, each_end, 0);
    ELSE
      INSERT INTO public.revenue_allocations
        (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
      VALUES
        (_sutijums_id, NULL, CASE WHEN dropoff_pak IS NOT NULL THEN dropoff_pak.id ELSE NULL END, 'dropoff',
         0, 0, each_end, 0, each_end);
    END IF;

    -- IziPizi platform share (remaining 50%)
    INSERT INTO public.revenue_allocations
      (sutijums_id, partner_id, pakomats_id, role, gross, vat, net, partner_amount, izipizi_amount)
    VALUES
      (_sutijums_id, NULL, NULL, 'izipizi',
       s.price, vat_amount, round(remaining * 0.50, 2), 0, round(remaining * 0.50, 2));

  END IF;
END;
$$;
