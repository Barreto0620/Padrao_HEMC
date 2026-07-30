import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PerfilUsuario = {
  id: string;
  nome_completo: string;
  re: string;
  setor_id: string | null;
  role: "admin" | "colaborador";
  ativo: boolean;
  lgpd_aceite_em: string | null;
  setor: { id: string; nome: string; sigla: string } | null;
};

export function useProfile() {
  return useQuery({
    queryKey: ["profile-atual"],
    queryFn: async (): Promise<PerfilUsuario | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome_completo, re, setor_id, role, ativo, lgpd_aceite_em, setor:setores(id, nome, sigla)")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as PerfilUsuario | null;
    },
    staleTime: 60_000,
  });
}