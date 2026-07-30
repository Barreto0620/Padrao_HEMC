import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Registra que o usuário autenticado aceitou o aviso de uso de dados
// (LGPD). Não recebe user_id por parâmetro — só mexe na própria conta
// (context.userId), igual ao padrão já usado em definirNovaSenhaPropria.
//
// Usa supabaseAdmin de propósito: a tabela profiles só libera UPDATE pra
// admin via RLS (nenhuma política deixa o próprio usuário atualizar a
// própria linha). Já vimos esse mesmo problema antes — usar o cliente
// comum aqui faria o update falhar silenciosamente (0 linhas afetadas,
// sem erro), e o aviso apareceria de novo pra sempre.
export const registrarAceiteLGPD = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ lgpd_aceite_em: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "lgpd_aceito",
      entidade_tipo: "profile",
      entidade_id: context.userId,
      detalhes: {},
    });

    return { ok: true };
  });