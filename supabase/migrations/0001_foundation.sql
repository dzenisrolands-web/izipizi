-- ============================================================
-- IziPizi — Foundation Migration (0001)
-- Unified schema for all 6 surfaces.
-- Run on a clean Supabase or on existing tirgus DB (safe: uses IF NOT EXISTS).
-- ============================================================

-- 3.1 Enums
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM
    ('customer', 'buyer', 'seller', 'business', 'courier', 'franchise', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.shipment_size AS ENUM ('M', 'L', 'XL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.temp_mode AS ENUM ('istabas', 'atdzesets', 'saldets', 'karsts');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.shipment_status AS ENUM
    ('izveidots', 'apmaksats', 'pienemts', 'cela', 'pakomata', 'izsniegts', 'atcelts');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_status AS ENUM
    ('pieejams', 'rezervets', 'savakts', 'piegadats', 'atcelts');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM
    ('gaida', 'apmaksats', 'atmaksats', 'neizdevas');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.compartment_status AS ENUM ('brivs', 'rezervets', 'aiznemts', 'serviss');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3.2 Profiles (may already exist in tirgus)
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- User roles join table (NEW — core of the unified role system)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.user_role NOT NULL,
  entity_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, entity_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles(user_id);

-- 3.3 RLS helper functions
CREATE OR REPLACE FUNCTION public.has_role(_role public.user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false)
    OR exists (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = _role
    );
$$;

CREATE OR REPLACE FUNCTION public.current_roles()
RETURNS SETOF public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;

-- 3.4 Signup trigger (default customer role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'customer')
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$;

-- Drop existing trigger if present, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3.5 RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Profiles: read/update own; admin sees all
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
CREATE POLICY "profiles_self_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.has_role('admin'));

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- User roles: user sees own; admin manages all
DROP POLICY IF EXISTS "user_roles_self_select" ON public.user_roles;
CREATE POLICY "user_roles_self_select" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.has_role('admin'));

DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- ============================================================
-- 3.6 Base tables for future modules
-- ============================================================

-- Pakomāti (M5)
CREATE TABLE IF NOT EXISTS public.pakomati (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text UNIQUE NOT NULL,
  name                  text NOT NULL,
  address               text,
  postal_code           text,
  lat                   double precision,
  lng                   double precision,
  franchise_partner_id  uuid,
  status                text NOT NULL DEFAULT 'aktivs',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.compartments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pakomats_id  uuid NOT NULL REFERENCES public.pakomati(id) ON DELETE CASCADE,
  code         text NOT NULL,
  size         public.shipment_size NOT NULL,
  temp_mode    public.temp_mode NOT NULL,
  status       public.compartment_status NOT NULL DEFAULT 'brivs',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pakomats_id, code)
);

-- Business accounts (M2)
CREATE TABLE IF NOT EXISTS public.business_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name   text NOT NULL,
  reg_number     text,
  vat_number     text,
  discount_tier  int NOT NULL DEFAULT 0,
  billing_email  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_discount_tiers (
  tier               int PRIMARY KEY,
  min_monthly_volume int NOT NULL,
  discount_pct       numeric(5,2) NOT NULL
);

-- Couriers (M4)
CREATE TABLE IF NOT EXISTS public.couriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  phone         text,
  vehicle_type  text,
  iban          text,
  status        text NOT NULL DEFAULT 'aktivs',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Franchise partners (M6)
CREATE TABLE IF NOT EXISTS public.franchise_partners (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name      text NOT NULL,
  reg_number        text,
  fee_paid          numeric(10,2),
  revenue_share_pct numeric(5,2) NOT NULL DEFAULT 50,
  onboarded_at      timestamptz NOT NULL DEFAULT now()
);

-- Shipments (M1) — unified version
CREATE TABLE IF NOT EXISTS public.shipments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id            uuid REFERENCES auth.users(id),
  business_account_id  uuid REFERENCES public.business_accounts(id),
  recipient_name       text,
  recipient_phone      text,
  size                 public.shipment_size NOT NULL,
  temp_mode            public.temp_mode NOT NULL,
  weight_kg            numeric(6,2),
  order_type           text NOT NULL DEFAULT 'single_locker',
  pickup_pakomats_id   uuid REFERENCES public.pakomati(id),
  dropoff_pakomats_id  uuid REFERENCES public.pakomati(id),
  price                numeric(10,2) NOT NULL,
  vat                  numeric(10,2) NOT NULL DEFAULT 0,
  status               public.shipment_status NOT NULL DEFAULT 'izveidots',
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Deliveries / courier marketplace (M4)
CREATE TABLE IF NOT EXISTS public.deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  courier_id          uuid REFERENCES public.couriers(id),
  pickup_pakomats_id  uuid REFERENCES public.pakomati(id),
  dropoff_pakomats_id uuid REFERENCES public.pakomati(id),
  status              public.delivery_status NOT NULL DEFAULT 'pieejams',
  fee                 numeric(10,2) NOT NULL DEFAULT 1.50,
  claimed_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Payments (Paysera)
CREATE TABLE IF NOT EXISTS public.payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id        uuid REFERENCES public.shipments(id),
  amount             numeric(10,2) NOT NULL,
  status             public.payment_status NOT NULL DEFAULT 'gaida',
  paysera_order_id   text,
  paysera_payment_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on all tables (policies will be detailed in later phases)
ALTER TABLE public.pakomati           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compartments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couriers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           ENABLE ROW LEVEL SECURITY;

-- Minimal starter policies
DROP POLICY IF EXISTS "pakomati_public_read" ON public.pakomati;
CREATE POLICY "pakomati_public_read" ON public.pakomati FOR SELECT USING (true);

DROP POLICY IF EXISTS "business_self" ON public.business_accounts;
CREATE POLICY "business_self" ON public.business_accounts
  FOR SELECT USING (user_id = auth.uid() OR public.has_role('admin'));

DROP POLICY IF EXISTS "courier_self" ON public.couriers;
CREATE POLICY "courier_self" ON public.couriers
  FOR SELECT USING (user_id = auth.uid() OR public.has_role('admin'));

DROP POLICY IF EXISTS "franchise_self" ON public.franchise_partners;
CREATE POLICY "franchise_self" ON public.franchise_partners
  FOR SELECT USING (user_id = auth.uid() OR public.has_role('admin'));

DROP POLICY IF EXISTS "shipments_self" ON public.shipments;
CREATE POLICY "shipments_self" ON public.shipments
  FOR SELECT USING (sender_id = auth.uid() OR public.has_role('admin'));

-- ============================================================
-- Data migration: backfill user_roles from existing profiles.role
-- (safe to run multiple times — ON CONFLICT DO NOTHING)
-- ============================================================
DO $$
BEGIN
  -- If profiles has a 'role' column (tirgus legacy), backfill user_roles
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT id, 'buyer'::public.user_role FROM public.profiles WHERE role = 'buyer'
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    SELECT id, 'seller'::public.user_role FROM public.profiles WHERE role = 'seller'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
