-- ============================================================
-- IziPizi — Seed Data
-- ============================================================

-- Business discount tiers
INSERT INTO public.business_discount_tiers (tier, min_monthly_volume, discount_pct) VALUES
  (1, 500,  5.00),
  (2, 2000, 10.00),
  (3, 5000, 15.00)
ON CONFLICT (tier) DO UPDATE SET
  min_monthly_volume = EXCLUDED.min_monthly_volume,
  discount_pct = EXCLUDED.discount_pct;

-- ============================================================
-- Admin setup instructions:
--
-- To grant admin role to a user:
--
-- 1. Via app_metadata (recommended for super admin):
--    UPDATE auth.users
--    SET raw_app_meta_data = raw_app_meta_data || '{"is_super_admin": true}'
--    WHERE email = 'your-email@example.com';
--
-- 2. Via user_roles table:
--    INSERT INTO public.user_roles (user_id, role)
--    SELECT id, 'admin' FROM auth.users WHERE email = 'your-email@example.com';
-- ============================================================
