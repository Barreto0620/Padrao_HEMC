import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type AcaoAuditoria =
  | "login"
  | "logout"
  | "usuario_criado"
  | "usuario_editado"
  | "usuario_desativado"
  | "usuario_ativado"
  | "senha_redefinida_por_admin"
  | "senha_alterada_pelo_usuario"
  | "setor_criado"
  | "setor_editado"
  | "setor_desativado"
  | "template_criado"
  | "template_editado"
  | "template_excluido"
  | "etiqueta_emitida"
  | "auditoria_exportada"
  | "lgpd_aceito"
  | "solicitacao_criada"
  | "solicitacao_aprovada"
  | "solicitacao_rejeitada"
  | "documento_criado"
  | "documento_editado"
  | "documento_excluido"
  | "documento_exportado_odt";

export async function registrarAuditoria(params: {
  acao: AcaoAuditoria;
  entidade_tipo?: string;
  entidade_id?: string;
  detalhes?: Record<string, unknown>;
}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      acao: params.acao,
      entidade_tipo: params.entidade_tipo ?? null,
      entidade_id: params.entidade_id ?? null,
      detalhes: (params.detalhes ?? {}) as Json,
    });
  } catch (err) {
    // Não bloqueia o fluxo do usuário se o log falhar
    console.warn("Falha ao registrar auditoria:", err);
  }
}