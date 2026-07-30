import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const criarSchema = z.object({
  nome_completo: z.string().trim().min(2).max(120),
  re: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "RE contém caracteres inválidos"),
  senha: z.string().min(6).max(72),
  setor_id: z.string().uuid().nullable(),
  role: z.enum(["admin", "colaborador"]),
});

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => criarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Apenas administradores podem cadastrar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = `${data.re.toLowerCase()}@hemc.internal`;

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.senha,
      email_confirm: true,
      user_metadata: {
        nome_completo: data.nome_completo,
        re: data.re,
        setor_id: data.setor_id ?? "",
        role: data.role,
      },
    });
    if (error) throw new Error(traduzirErroAuth(error.message));
    if (!created.user) throw new Error("Falha ao criar usuário.");

    // Garante que profile foi atualizado (o trigger já cria; garantimos campos)
    await supabaseAdmin
      .from("profiles")
      .update({
        nome_completo: data.nome_completo,
        re: data.re,
        setor_id: data.setor_id,
        role: data.role,
        ativo: true,
      })
      .eq("id", created.user.id);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "usuario_criado",
      entidade_tipo: "profile",
      entidade_id: created.user.id,
      detalhes: { re: data.re, nome_completo: data.nome_completo, role: data.role },
    });

    return { id: created.user.id };
  });

const alternarSchema = z.object({
  user_id: z.string().uuid(),
  ativo: z.boolean(),
});

export const alternarUsuarioAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => alternarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem alterar usuários.");

    const { error } = await context.supabase
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    // Bloqueia login desativando via auth admin (opcional — RLS já barra)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.ativo ? "none" : "876000h",
    });

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: data.ativo ? "usuario_ativado" : "usuario_desativado",
      entidade_tipo: "profile",
      entidade_id: data.user_id,
      detalhes: {},
    });

    return { ok: true };
  });

// ============================================================================
// NOVO — editar dados de um usuário existente (nome, RE, setor, perfil)
// ============================================================================
const atualizarSchema = z.object({
  user_id: z.string().uuid(),
  nome_completo: z.string().trim().min(2).max(120),
  re: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "RE contém caracteres inválidos"),
  setor_id: z.string().uuid().nullable(),
  role: z.enum(["admin", "colaborador"]),
});

export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => atualizarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem editar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const novoEmail = `${data.re.toLowerCase()}@hemc.internal`;

    // Atualiza o e-mail técnico (derivado do RE) e os metadados no Auth
    // ANTES de tocar em profiles — se o RE já estiver em uso por outro
    // usuário, falha aqui e nada fica alterado pela metade.
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      email: novoEmail,
      user_metadata: {
        nome_completo: data.nome_completo,
        re: data.re,
        setor_id: data.setor_id ?? "",
        role: data.role,
      },
    });
    if (authErr) throw new Error(traduzirErroAuth(authErr.message));

    const { error } = await context.supabase
      .from("profiles")
      .update({
        nome_completo: data.nome_completo,
        re: data.re,
        setor_id: data.setor_id,
        role: data.role,
      })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "usuario_editado",
      entidade_tipo: "profile",
      entidade_id: data.user_id,
      detalhes: { nome_completo: data.nome_completo, re: data.re, setor_id: data.setor_id, role: data.role },
    });

    return { ok: true };
  });

// ============================================================================
// NOVO — admin redefine a senha de um usuário (fica marcado pra trocar no
// próximo login — ver profiles.deve_trocar_senha)
// ============================================================================
const redefinirSenhaSchema = z.object({
  user_id: z.string().uuid(),
  nova_senha: z.string().min(6).max(72),
});

export const redefinirSenhaUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => redefinirSenhaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem redefinir senhas.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.nova_senha,
    });
    if (authErr) throw new Error(traduzirErroAuth(authErr.message));

    const { error } = await context.supabase
      .from("profiles")
      .update({ deve_trocar_senha: true })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "senha_redefinida_por_admin",
      entidade_tipo: "profile",
      entidade_id: data.user_id,
      detalhes: {},
    });

    return { ok: true };
  });

// ============================================================================
// NOVO — o próprio usuário logado define uma nova senha (usado no fluxo de
// troca obrigatória, depois que o admin fez o reset). Não exige ser admin —
// só exige estar autenticado, e só mexe na própria conta (context.userId),
// nunca recebe o id de outra pessoa por parâmetro.
// ============================================================================
const definirNovaSenhaSchema = z.object({
  nova_senha: z.string().min(6).max(72),
});

export const definirNovaSenhaPropria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => definirNovaSenhaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.nova_senha,
    });
    if (authErr) throw new Error(traduzirErroAuth(authErr.message));

    // Usa supabaseAdmin aqui de propósito: a tabela profiles só libera
    // UPDATE pra admin via RLS (nenhuma política deixa o próprio usuário
    // atualizar a própria linha). Com o cliente comum, esse update falha
    // silenciosamente — 0 linhas afetadas, sem erro — e deve_trocar_senha
    // nunca vira false de verdade, prendendo a pessoa na mesma tela pra
    // sempre. A validação de identidade já veio do middleware
    // (context.userId só pode ser o próprio usuário autenticado).
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ deve_trocar_senha: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      acao: "senha_alterada_pelo_usuario",
      entidade_tipo: "profile",
      entidade_id: context.userId,
      detalhes: {},
    });

    return { ok: true };
  });

function traduzirErroAuth(msg: string): string {
  if (/already registered|duplicate|already exists/i.test(msg))
    return "Já existe um usuário com este RE.";
  if (/password/i.test(msg)) return "Senha inválida (mínimo 6 caracteres).";
  return msg;
}