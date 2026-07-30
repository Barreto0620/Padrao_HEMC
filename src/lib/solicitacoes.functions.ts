import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function traduzirErroAuth(msg: string): string {
  if (/already registered|duplicate|already exists/i.test(msg))
    return "Já existe um usuário com este RE.";
  if (/password/i.test(msg)) return "Senha inválida (mínimo 6 caracteres).";
  return msg;
}

// ============================================================================
// PÚBLICAS — chamadas ANTES do login (tela de "Solicitar acesso" /
// "Esqueci minha senha"). Nunca criam acesso sozinhas, só registram um
// pedido pendente. Usam supabaseAdmin de propósito, já que quem chama
// ainda não está autenticado — não tem sessão nenhuma pra RLS avaliar.
// ============================================================================

export const listarSetoresPublico = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("setores")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");
  if (error) throw new Error(error.message);
  return data ?? [];
});

const solicitarCadastroSchema = z.object({
  nome_completo: z.string().trim().min(2).max(120),
  re: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "RE contém caracteres inválidos"),
  setor_id: z.string().uuid(),
});

export const solicitarCadastro = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => solicitarCadastroSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existente } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("re", data.re)
      .maybeSingle();
    if (existente) {
      throw new Error("Já existe uma conta com este RE. Tente \"Esqueci minha senha\" ou fale com a TI.");
    }

    const { data: pendente } = await supabaseAdmin
      .from("solicitacoes")
      .select("id")
      .eq("re", data.re)
      .eq("tipo", "cadastro")
      .eq("status", "pendente")
      .maybeSingle();
    if (pendente) {
      throw new Error("Já existe uma solicitação de cadastro pendente para este RE. Aguarde a aprovação da TI.");
    }

    const { error } = await supabaseAdmin.from("solicitacoes").insert({
      tipo: "cadastro",
      nome_completo: data.nome_completo,
      re: data.re,
      setor_id: data.setor_id,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: null,
      acao: "solicitacao_criada",
      entidade_tipo: "solicitacao",
      detalhes: { tipo: "cadastro", re: data.re, nome_completo: data.nome_completo },
    });

    return { ok: true };
  });

const solicitarResetSchema = z.object({
  re: z.string().trim().min(1).max(30),
});

export const solicitarResetSenha = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => solicitarResetSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: usuario } = await supabaseAdmin
      .from("profiles")
      .select("id, ativo")
      .eq("re", data.re)
      .maybeSingle();
    if (!usuario) throw new Error("RE não encontrado. Confira o número ou fale com a TI.");
    if (!usuario.ativo) throw new Error("Este usuário está desativado. Fale com a TI.");

    const { data: pendente } = await supabaseAdmin
      .from("solicitacoes")
      .select("id")
      .eq("re", data.re)
      .eq("tipo", "reset_senha")
      .eq("status", "pendente")
      .maybeSingle();
    if (pendente) {
      throw new Error("Já existe um pedido de redefinição de senha pendente para este RE.");
    }

    const { error } = await supabaseAdmin.from("solicitacoes").insert({
      tipo: "reset_senha",
      re: data.re,
      usuario_id: usuario.id,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: usuario.id,
      acao: "solicitacao_criada",
      entidade_tipo: "solicitacao",
      detalhes: { tipo: "reset_senha", re: data.re },
    });

    return { ok: true };
  });

// ============================================================================
// ADMIN — revisão das solicitações pendentes
// ============================================================================

const aprovarCadastroSchema = z.object({
  solicitacao_id: z.string().uuid(),
  senha_temporaria: z.string().min(6).max(72),
  role: z.enum(["admin", "colaborador"]),
});

export const aprovarSolicitacaoCadastro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => aprovarCadastroSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem aprovar solicitações.");

    const { data: solicitacao, error: errBusca } = await context.supabase
      .from("solicitacoes")
      .select("id, tipo, status, nome_completo, re, setor_id")
      .eq("id", data.solicitacao_id)
      .single();
    if (errBusca) throw new Error(errBusca.message);
    if (solicitacao.tipo !== "cadastro") throw new Error("Essa solicitação não é de cadastro.");
    if (solicitacao.status !== "pendente") throw new Error("Essa solicitação já foi revisada.");
    if (!solicitacao.nome_completo) throw new Error("Solicitação de cadastro sem nome completo.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = `${solicitacao.re.toLowerCase()}@hemc.internal`;

    const { data: created, error: errAuth } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.senha_temporaria,
      email_confirm: true,
      user_metadata: {
        nome_completo: solicitacao.nome_completo,
        re: solicitacao.re,
        setor_id: solicitacao.setor_id ?? "",
        role: data.role,
      },
    });
    if (errAuth) throw new Error(traduzirErroAuth(errAuth.message));
    if (!created.user) throw new Error("Falha ao criar usuário.");

    await supabaseAdmin
      .from("profiles")
      .update({
        nome_completo: solicitacao.nome_completo,
        re: solicitacao.re,
        setor_id: solicitacao.setor_id,
        role: data.role,
        ativo: true,
        deve_trocar_senha: true,
      })
      .eq("id", created.user.id);

    await context.supabase
      .from("solicitacoes")
      .update({ status: "aprovada", revisado_por: context.userId, revisado_em: new Date().toISOString() })
      .eq("id", data.solicitacao_id);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "solicitacao_aprovada",
      entidade_tipo: "solicitacao",
      entidade_id: data.solicitacao_id,
      detalhes: { tipo: "cadastro", re: solicitacao.re, usuario_criado: created.user.id },
    });

    return { ok: true, usuario_id: created.user.id };
  });

const aprovarResetSchema = z.object({
  solicitacao_id: z.string().uuid(),
  senha_temporaria: z.string().min(6).max(72),
});

export const aprovarSolicitacaoResetSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => aprovarResetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem aprovar solicitações.");

    const { data: solicitacao, error: errBusca } = await context.supabase
      .from("solicitacoes")
      .select("id, tipo, status, usuario_id, re")
      .eq("id", data.solicitacao_id)
      .single();
    if (errBusca) throw new Error(errBusca.message);
    if (solicitacao.tipo !== "reset_senha") throw new Error("Essa solicitação não é de redefinição de senha.");
    if (solicitacao.status !== "pendente") throw new Error("Essa solicitação já foi revisada.");
    if (!solicitacao.usuario_id) throw new Error("Solicitação sem usuário vinculado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: errAuth } = await supabaseAdmin.auth.admin.updateUserById(solicitacao.usuario_id, {
      password: data.senha_temporaria,
    });
    if (errAuth) throw new Error(traduzirErroAuth(errAuth.message));

    await supabaseAdmin.from("profiles").update({ deve_trocar_senha: true }).eq("id", solicitacao.usuario_id);

    await context.supabase
      .from("solicitacoes")
      .update({ status: "aprovada", revisado_por: context.userId, revisado_em: new Date().toISOString() })
      .eq("id", data.solicitacao_id);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "solicitacao_aprovada",
      entidade_tipo: "solicitacao",
      entidade_id: data.solicitacao_id,
      detalhes: { tipo: "reset_senha", re: solicitacao.re },
    });

    return { ok: true };
  });

const rejeitarSchema = z.object({
  solicitacao_id: z.string().uuid(),
});

export const rejeitarSolicitacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rejeitarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem rejeitar solicitações.");

    const { data: solicitacao, error: errBusca } = await context.supabase
      .from("solicitacoes")
      .select("id, tipo, status, re")
      .eq("id", data.solicitacao_id)
      .single();
    if (errBusca) throw new Error(errBusca.message);
    if (solicitacao.status !== "pendente") throw new Error("Essa solicitação já foi revisada.");

    const { error } = await context.supabase
      .from("solicitacoes")
      .update({ status: "rejeitada", revisado_por: context.userId, revisado_em: new Date().toISOString() })
      .eq("id", data.solicitacao_id);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "solicitacao_rejeitada",
      entidade_tipo: "solicitacao",
      entidade_id: data.solicitacao_id,
      detalhes: { tipo: solicitacao.tipo, re: solicitacao.re },
    });

    return { ok: true };
  });