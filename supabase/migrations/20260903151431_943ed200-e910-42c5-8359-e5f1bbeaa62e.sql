-- Marketplace
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'Template',
  price numeric NOT NULL DEFAULT 0,
  version text NOT NULL DEFAULT '1.0.0',
  image_url text NOT NULL DEFAULT '',
  file_url text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  changelog text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  downloads_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON public.products FOR SELECT TO anon USING (active = true);
CREATE POLICY "products_admin_all" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  price numeric NOT NULL DEFAULT 0,
  discount_label text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  product_slugs text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_bundles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundles TO authenticated;
GRANT ALL ON public.product_bundles TO service_role;
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bundles_public_read" ON public.product_bundles FOR SELECT TO anon USING (active = true);
CREATE POLICY "bundles_admin_all" ON public.product_bundles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER product_bundles_updated_at BEFORE UPDATE ON public.product_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  author_email text NOT NULL DEFAULT '',
  rating integer NOT NULL DEFAULT 5,
  body text NOT NULL DEFAULT '',
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_reviews TO authenticated;
GRANT ALL ON public.product_reviews TO service_role;
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_public_read" ON public.product_reviews FOR SELECT TO anon USING (approved = true);
CREATE POLICY "reviews_admin_all" ON public.product_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER product_reviews_updated_at BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.product_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug text NOT NULL,
  license_key text NOT NULL UNIQUE,
  customer_name text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  activations integer NOT NULL DEFAULT 0,
  max_activations integer NOT NULL DEFAULT 3,
  expires_on date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_licenses TO authenticated;
GRANT ALL ON public.product_licenses TO service_role;
ALTER TABLE public.product_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "licenses_admin_all" ON public.product_licenses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER product_licenses_updated_at BEFORE UPDATE ON public.product_licenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  product_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, product_slug)
);
GRANT SELECT, INSERT, DELETE ON public.wishlist_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlist_items TO authenticated;
GRANT ALL ON public.wishlist_items TO service_role;
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wishlist_session_read" ON public.wishlist_items FOR SELECT TO anon USING (true);
CREATE POLICY "wishlist_session_insert" ON public.wishlist_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "wishlist_session_delete" ON public.wishlist_items FOR DELETE TO anon USING (true);
CREATE POLICY "wishlist_admin_all" ON public.wishlist_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Two factor and login security
CREATE TABLE public.admin_totp (
  id text PRIMARY KEY,
  secret text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  recovery_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.admin_totp TO authenticated;
GRANT ALL ON public.admin_totp TO service_role;
ALTER TABLE public.admin_totp ENABLE ROW LEVEL SECURITY;
CREATE POLICY "totp_admin_select" ON public.admin_totp FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "totp_admin_update" ON public.admin_totp FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER admin_totp_updated_at BEFORE UPDATE ON public.admin_totp
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.admin_totp (id) VALUES ('global');

CREATE TABLE public.admin_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'Passkey',
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  algorithm integer NOT NULL DEFAULT -7,
  sign_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_passkeys TO authenticated;
GRANT ALL ON public.admin_passkeys TO service_role;
ALTER TABLE public.admin_passkeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "passkeys_admin_all" ON public.admin_passkeys FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER admin_passkeys_updated_at BEFORE UPDATE ON public.admin_passkeys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.login_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  identifier text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'info',
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.login_alerts TO authenticated;
GRANT ALL ON public.login_alerts TO service_role;
ALTER TABLE public.login_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_admin_select" ON public.login_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "alerts_admin_update" ON public.login_alerts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.admin_alert_settings (
  id text PRIMARY KEY,
  email text NOT NULL DEFAULT '',
  alert_on_success boolean NOT NULL DEFAULT true,
  alert_on_failure boolean NOT NULL DEFAULT true,
  alert_on_new_device boolean NOT NULL DEFAULT true,
  webhook_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.admin_alert_settings TO authenticated;
GRANT ALL ON public.admin_alert_settings TO service_role;
ALTER TABLE public.admin_alert_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_settings_admin_select" ON public.admin_alert_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "alert_settings_admin_update" ON public.admin_alert_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER admin_alert_settings_updated_at BEFORE UPDATE ON public.admin_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.admin_alert_settings (id) VALUES ('global');

-- AI generated sites
CREATE TABLE public.ai_site_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  html text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_site_builds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_site_builds TO authenticated;
GRANT ALL ON public.ai_site_builds TO service_role;
ALTER TABLE public.ai_site_builds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_builds_public_read" ON public.ai_site_builds FOR SELECT TO anon USING (published = true);
CREATE POLICY "site_builds_admin_all" ON public.ai_site_builds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER ai_site_builds_updated_at BEFORE UPDATE ON public.ai_site_builds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();