import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { registrarAuditoria } from "@/lib/audit";
import { existeAlgumUsuario, bootstrapAdmin } from "@/lib/bootstrap.functions";
import { definirNovaSenhaPropria } from "@/lib/admin.functions";
import { Loader2, ShieldPlus, Sun, Moon, KeyRound, User, Lock } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

const LOGO_PADRAO_HEMC = "/logos/logo_padrao_hemc.png";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Padrão HEMC | Padronização de Processos" },
      { name: "description", content: "Acesso ao sistema Padrão HEMC do Hospital Estadual Mário Covas." },
    ],
  }),
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Só manda direto pro sistema se NÃO houver troca de senha pendente —
    // senão cria loop com o _authenticated/route.tsx, que manda de volta
    // pra cá justamente por causa dessa pendência.
    const { data: profile } = await supabase
      .from("profiles")
      .select("deve_trocar_senha")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.deve_trocar_senha) {
      throw redirect({ to: "/editor" });
    }
  },
  component: TelaLogin,
});

function TelaLogin() {
  const navigate = useNavigate();
  const [re, setRe] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);

  // Verifica, no cliente, se já existe uma sessão autenticada com troca de
  // senha pendente — cobre tanto o caso de "acabei de logar agora" quanto
  // "recarreguei a página nesse meio do caminho" (o beforeLoad já deixou
  // passar pra cá exatamente por causa dessa pendência).
  const { data: sessaoAtual, refetch: refetchSessao } = useQuery({
    queryKey: ["auth-sessao-pendente"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { deveTrocarSenha: false };
      const { data: profile } = await supabase
        .from("profiles")
        .select("deve_trocar_senha")
        .eq("id", user.id)
        .maybeSingle();
      return { deveTrocarSenha: !!profile?.deve_trocar_senha };
    },
  });

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!re.trim() || !senha) {
      toast.error("Informe seu RE e senha.");
      return;
    }
    setCarregando(true);
    try {
      const email = `${re.trim().toLowerCase()}@hemc.internal`;
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (error) {
        if (/invalid|credentials/i.test(error.message)) {
          toast.error("RE ou senha inválidos.");
        } else if (/banned|disabled/i.test(error.message)) {
          toast.error("Usuário desativado. Procure o administrador.");
        } else {
          toast.error("Não foi possível entrar. Tente novamente.");
        }
        return;
      }

      // Verifica se profile está ativo e se há troca de senha pendente
      const { data: profile } = await supabase
        .from("profiles")
        .select("ativo, deve_trocar_senha")
        .eq("id", data.user!.id)
        .maybeSingle();
      if (profile && !profile.ativo) {
        await supabase.auth.signOut();
        toast.error("Usuário desativado. Procure o administrador.");
        return;
      }

      await registrarAuditoria({ acao: "login" });

      if (profile?.deve_trocar_senha) {
        // Não navega pro sistema ainda — o refetch faz este componente
        // trocar pra tela de "defina sua nova senha" abaixo.
        await refetchSessao();
        return;
      }

      toast.success("Bem-vindo(a) ao Padrão HEMC.");
      navigate({ to: "/editor" });
    } finally {
      setCarregando(false);
    }
  }

  if (sessaoAtual?.deveTrocarSenha) {
    return (
      <TelaTrocaSenhaObrigatoria
        aoConcluir={() => {
          toast.success("Senha atualizada. Bem-vindo(a) ao Padrão HEMC.");
          navigate({ to: "/editor" });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 relative">
      <div className="absolute right-4 top-4 z-10">
        <AlternadorTemaLogin />
      </div>
      <div
        className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 hemc-gradient text-primary-foreground"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-lg bg-white/10 backdrop-blur overflow-hidden">
            <img
              src={LOGO_PADRAO_HEMC}
              alt="Logo Padrão HEMC"
              className="h-full w-full object-contain scale-150"
            />
          </div>
          <div>
            <div className="text-xl font-semibold">Padrão HEMC</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight">
            Padronização de processos<br />do Hospital Estadual Mário Covas
          </h1>
          <p className="mt-4 max-w-md text-primary-foreground/80">
            Ambiente seguro para geração de etiquetas, rastreabilidade de emissões e gestão administrativa.
          </p>
        </div>
        <div className="relative text-xs opacity-70">Santo André / SP</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10 bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader>
            <div className="lg:hidden flex items-center gap-2 mb-2 text-primary">
              <img
                src={LOGO_PADRAO_HEMC}
                alt="Logo Padrão HEMC"
                className="h-7 w-7 object-contain scale-150"
              />
              <span className="font-semibold">Padrão HEMC</span>
            </div>
            <CardTitle className="text-2xl">Entrar</CardTitle>
            <CardDescription>Use seu RE (Registro do Empregado) e senha para acessar.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={entrar} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="re">RE</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="re"
                    autoFocus
                    autoComplete="username"
                    placeholder="Ex.: 123456"
                    className="pl-9"
                    value={re}
                    onChange={(e) => setRe(e.target.value)}
                    disabled={carregando}
                    maxLength={30}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="senha">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="senha"
                    type="password"
                    autoComplete="current-password"
                    className="pl-9"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    disabled={carregando}
                    maxLength={72}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={carregando}>
                {carregando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Não tem acesso? Solicite ao administrador do seu setor.
              </p>
            </form>
            <PrimeiroAcesso />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Tela exibida no lugar do formulário de login quando a conta já está
// autenticada, mas com troca de senha obrigatória pendente (após um reset
// feito por um admin). O usuário não acessa o resto do sistema até concluir.
function TelaTrocaSenhaObrigatoria({ aoConcluir }: { aoConcluir: () => void }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [enviando, setEnviando] = useState(false);

  const definirSenha = useServerFn(definirNovaSenhaPropria);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (novaSenha.length < 6) {
      toast.error("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setEnviando(true);
    try {
      await definirSenha({ data: { nova_senha: novaSenha } });
      aoConcluir();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar a senha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-center gap-2 text-warning">
            <KeyRound className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Troca de senha obrigatória</span>
          </div>
          <CardTitle className="text-2xl">Defina sua nova senha</CardTitle>
          <CardDescription>
            Sua senha foi redefinida por um administrador. Por segurança, defina uma senha nova e
            pessoal antes de continuar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submeter} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nova-senha">Nova senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="nova-senha"
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  className="pl-9"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  disabled={enviando}
                  maxLength={72}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirmar-senha"
                  type="password"
                  autoComplete="new-password"
                  className="pl-9"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  disabled={enviando}
                  maxLength={72}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Definir nova senha e entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AlternadorTemaLogin() {
  const { tema, alternarTema } = useTheme();
  const paraClaro = tema === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={alternarTema}
      aria-label={paraClaro ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={paraClaro ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {paraClaro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function PrimeiroAcesso() {
  const check = useServerFn(existeAlgumUsuario);
  const boot = useServerFn(bootstrapAdmin);
  const { data, refetch } = useQuery({
    queryKey: ["bootstrap-check"],
    queryFn: () => check({ data: undefined }),
    staleTime: 60_000,
  });
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [re, setRe] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (!data || data.existe) return null;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !re.trim() || senha.length < 6) {
      toast.error("Preencha todos os campos (senha mín. 6 caracteres).");
      return;
    }
    setEnviando(true);
    try {
      await boot({ data: { nome_completo: nome.trim(), re: re.trim(), senha } });
      toast.success("Administrador criado. Faça login para continuar.");
      setAberto(false);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar administrador.");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <ShieldPlus className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">Primeiro acesso ao sistema</div>
            <p className="text-xs text-muted-foreground mt-1">
              Nenhum usuário cadastrado. Crie o administrador inicial para começar.
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAberto(true)}>
              Configurar administrador
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submeter} className="mt-4 space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium flex items-center gap-2">
        <ShieldPlus className="h-4 w-4 text-warning" /> Configurar administrador inicial
      </div>
      <div className="space-y-1.5"><Label className="text-xs">Nome completo</Label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5"><Label className="text-xs">RE</Label>
          <Input value={re} onChange={(e) => setRe(e.target.value)} maxLength={30} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Senha</Label>
          <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} maxLength={72} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
        </Button>
      </div>
    </form>
  );
}