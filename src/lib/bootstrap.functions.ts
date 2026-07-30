import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Cria o primeiro administrador do sistema — só funciona se ainda não existir
// nenhum usuário. Sem autenticação (bootstrap único).
const schema = z.object({
  nome_completo: z.string().trim().min(2).max(120),
  re: z.string().trim().min(1).max(30).regex(/^[a-zA-Z0-9._-]+$/),
  senha: z.string().min(6).max(72),
});

export const existeAlgumUsuario = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return { existe: (count ?? 0) > 0 };
});

export const bootstrapAdmin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => schema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) throw new Error("Já existe um usuário cadastrado.");

    const email = `${data.re.toLowerCase()}@hemc.internal`;
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.senha,
      email_confirm: true,
      user_metadata: {
        nome_completo: data.nome_completo,
        re: data.re,
        role: "admin",
      },
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("Falha ao criar administrador.");

    await supabaseAdmin
      .from("profiles")
      .update({
        nome_completo: data.nome_completo,
        re: data.re,
        role: "admin",
        ativo: true,
      })
      .eq("id", created.user.id);

    return { ok: true };
  });
