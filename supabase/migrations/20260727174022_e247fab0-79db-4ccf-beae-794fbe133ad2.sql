
-- Enum de perfis
CREATE TYPE public.app_role AS ENUM ('admin', 'colaborador');

-- Setores
CREATE TABLE public.setores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  sigla TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setores TO authenticated;
GRANT ALL ON public.setores TO service_role;
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo TEXT NOT NULL,
  re TEXT NOT NULL UNIQUE,
  setor_id UUID REFERENCES public.setores(id) ON DELETE SET NULL,
  role public.app_role NOT NULL DEFAULT 'colaborador',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Função security definer para checagem de papel (evita recursão em RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = _role AND ativo = true
  )
$$;

CREATE OR REPLACE FUNCTION public.current_setor_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT setor_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Audit logs (append-only)
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  entidade_tipo TEXT,
  entidade_id TEXT,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Templates de etiqueta
CREATE TABLE public.templates_etiqueta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  setor_id UUID REFERENCES public.setores(id) ON DELETE SET NULL,
  largura_mm NUMERIC NOT NULL,
  altura_mm NUMERIC NOT NULL,
  modo TEXT NOT NULL DEFAULT 'zebra',
  conteudo JSONB NOT NULL DEFAULT '{"elementos":[]}'::jsonb,
  oficial BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates_etiqueta TO authenticated;
GRANT ALL ON public.templates_etiqueta TO service_role;
ALTER TABLE public.templates_etiqueta ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_setores_updated BEFORE UPDATE ON public.setores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON public.templates_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger append-only para audit_logs (bloqueia UPDATE/DELETE)
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Trilha de auditoria não pode ser modificada';
END;
$$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- Auto-cria profile ao registrar usuário via auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_re TEXT;
  v_nome TEXT;
  v_setor UUID;
  v_role public.app_role;
BEGIN
  v_re := COALESCE(NEW.raw_user_meta_data->>'re', split_part(NEW.email, '@', 1));
  v_nome := COALESCE(NEW.raw_user_meta_data->>'nome_completo', v_re);
  v_setor := NULLIF(NEW.raw_user_meta_data->>'setor_id', '')::UUID;
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'colaborador');

  INSERT INTO public.profiles (id, nome_completo, re, setor_id, role, ativo)
  VALUES (NEW.id, v_nome, v_re, v_setor, v_role, true)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================= RLS POLICIES =================

-- SETORES
CREATE POLICY "setores_select_all_auth" ON public.setores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "setores_admin_all" ON public.setores
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- PROFILES
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_select_same_setor" ON public.profiles
  FOR SELECT TO authenticated USING (setor_id IS NOT NULL AND setor_id = public.current_setor_id());
CREATE POLICY "profiles_admin_modify" ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- AUDIT LOGS
CREATE POLICY "audit_insert_self" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "audit_select_self" ON public.audit_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- TEMPLATES
CREATE POLICY "templates_select_oficial" ON public.templates_etiqueta
  FOR SELECT TO authenticated USING (oficial = true AND ativo = true);
CREATE POLICY "templates_select_setor" ON public.templates_etiqueta
  FOR SELECT TO authenticated USING (setor_id IS NOT NULL AND setor_id = public.current_setor_id());
CREATE POLICY "templates_select_author" ON public.templates_etiqueta
  FOR SELECT TO authenticated USING (criado_por = auth.uid());
CREATE POLICY "templates_select_admin" ON public.templates_etiqueta
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "templates_insert_auth" ON public.templates_etiqueta
  FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid() AND (oficial = false OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "templates_update_author" ON public.templates_etiqueta
  FOR UPDATE TO authenticated
  USING (criado_por = auth.uid())
  WITH CHECK (criado_por = auth.uid() AND (oficial = false OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "templates_update_admin" ON public.templates_etiqueta
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "templates_delete_author" ON public.templates_etiqueta
  FOR DELETE TO authenticated USING (criado_por = auth.uid());
CREATE POLICY "templates_delete_admin" ON public.templates_etiqueta
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Setor inicial e usuário admin bootstrap serão criados via aplicação
INSERT INTO public.setores (nome, sigla) VALUES
  ('Tecnologia da Informação', 'TI'),
  ('Enfermagem', 'ENF'),
  ('Farmácia', 'FARM');
