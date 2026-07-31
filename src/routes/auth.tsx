import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { registrarAuditoria } from "@/lib/audit";
import { existeAlgumUsuario, bootstrapAdmin } from "@/lib/bootstrap.functions";
import { definirNovaSenhaPropria } from "@/lib/admin.functions";
import { solicitarCadastro, listarSetoresPublico, solicitarResetSenha } from "@/lib/solicitacoes.functions";
import {
  Loader2, ShieldPlus, Sun, Moon, KeyRound, User, Lock, Building2, CheckCircle2,
} from "lucide-react";
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
  const [modo, setModo] = useState<"entrar" | "cadastrar">("entrar");
  const [re, setRe] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [esqueciSenhaAberto, setEsqueciSenhaAberto] = useState(false);

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
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute right-4 top-4 z-20">
        <AlternadorTemaLogin />
      </div>

      {/* Trilho deslizante com as duas "cenas" lado a lado — o container tem
          o dobro da largura, e a gente translada ele em -50% pra trocar de
          cena. Usa transform: translateX (não "order"/"flex-direction",
          que "pulam" em vez de animar suave entre navegadores). */}
      <div
        className="flex min-h-screen w-[200%] transition-transform duration-700 ease-in-out"
        style={{ transform: modo === "entrar" ? "translateX(0%)" : "translateX(-50%)" }}
      >
        {/* Cena 1 — Entrar (painel à esquerda, card à direita) */}
        <div className="grid w-1/2 shrink-0 lg:grid-cols-2">
          <PainelMarca
            titulo={<>Padronização de processos<br />do Hospital Estadual Mário Covas<br /><br /></>}
            descricao="Sistema seguro para padronização de etiquetas e documentos institucionais, assegurando rastreabilidade, controle de emissões e conformidade dos processos administrativos."
            gradiente="hemc-gradient"
          />
          <div className="flex items-center justify-center p-6 sm:p-10">
            <Card className="w-full max-w-md shadow-xl">
              <CardHeader className="items-center text-center">
                <MarcaMobile />
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
                    <button
                      type="button"
                      onClick={() => setEsqueciSenhaAberto(true)}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Button type="submit" className="w-full" disabled={carregando}>
                    {carregando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Entrar
                  </Button>
                </form>

                <button
                  type="button"
                  onClick={() => setModo("cadastrar")}
                  className="mt-4 w-full text-center text-sm font-medium text-primary transition-colors hover:underline"
                >
                  Não tem acesso?
                </button>

                <PrimeiroAcesso />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Cena 2 — Cadastrar-se (card à esquerda, painel à direita) */}
        <div className="grid w-1/2 shrink-0 lg:grid-cols-2">
          <div className="flex items-center justify-center p-6 sm:p-10 lg:order-1">
            <Card className="w-full max-w-md shadow-xl">
              <CardHeader className="items-center text-center">
                <MarcaMobile />
                <CardTitle className="text-2xl">Solicitar acesso</CardTitle>
                <CardDescription>Preencha seus dados — a TI revisa e libera seu acesso.</CardDescription>
              </CardHeader>
              <CardContent>
                <FormularioCadastro ativo={modo === "cadastrar"} aoVoltar={() => setModo("entrar")} />
              </CardContent>
            </Card>
          </div>
          <PainelMarca
            className="lg:order-2"
            titulo={<>Padronização Inteligente<br /><br /></>}
            descricao="Para garantir a segurança das informações, todos os cadastros são analisados e aprovados pela equipe de TI antes da liberação do acesso ao sistema."
            gradiente="hemc-gradient-cadastro"
          />
        </div>
      </div>

      <DialogoEsqueciSenha aberto={esqueciSenhaAberto} onFechar={() => setEsqueciSenhaAberto(false)} />
    </div>
  );
}

function DialogoEsqueciSenha({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [re, setRe] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const enviarPedido = useServerFn(solicitarResetSenha);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!re.trim()) {
      toast.error("Informe seu RE.");
      return;
    }
    setEnviando(true);
    try {
      await enviarPedido({ data: { re: re.trim() } });
      setEnviado(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar o pedido.");
    } finally {
      setEnviando(false);
    }
  }

  function fechar() {
    onFechar();
    // Reseta depois de fechar, com um pequeno atraso pra não "piscar" o
    // formulário vazio enquanto o diálogo ainda está com animação de saída.
    setTimeout(() => {
      setRe("");
      setEnviando(false);
      setEnviado(false);
    }, 200);
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent>
        {enviado ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">Pedido enviado!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A TI vai revisar e te passar uma senha temporária assim que aprovado.
              </p>
            </div>
            <Button variant="outline" className="mt-2" onClick={fechar}>Fechar</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Esqueci minha senha</DialogTitle>
              <DialogDescription>
                Informe seu RE — a TI revisa o pedido e te passa uma senha temporária por um canal
                seguro.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submeter} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="esq-re">RE</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="esq-re"
                    autoFocus
                    className="pl-9"
                    placeholder="Ex.: 123456"
                    value={re}
                    onChange={(e) => setRe(e.target.value)}
                    disabled={enviando}
                    maxLength={30}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={fechar}>Cancelar</Button>
                <Button type="submit" disabled={enviando}>
                  {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Enviar pedido
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Painel de marca dos dois lados da tela de login. Em vez de reagir ao
// cursor (que dava aquela sensação de "bola de luz" seguindo o mouse), o
// painel agora se move sozinho: três camadas de ondas sobrepostas, cada
// uma numa velocidade e sentido diferentes, criando uma superfície de
// água contínua e orgânica ao fundo — sem depender de nenhuma interação.
function PainelMarca({
  titulo, descricao, gradiente, className,
}: { titulo: ReactNode; descricao: string; gradiente: string; className?: string }) {
  return (
    <div
      className={`relative hidden flex-col justify-between overflow-hidden p-12 text-primary-foreground lg:flex ${gradiente} ${className ?? ""}`}
    >
      {/* Textura de pontos sutil, só pra dar granularidade ao fundo */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Ondas de água ao vento — três camadas, cada uma fluindo em sua
          própria velocidade/sentido, dando profundidade ao movimento. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 overflow-hidden">
        <div className="hemc-onda-track hemc-onda-camada-1 absolute inset-0">
          <OndaSvg opacidade={0.1} variante={1} />
          <OndaSvg opacidade={0.1} variante={1} />
        </div>
        <div className="hemc-onda-track hemc-onda-camada-2 absolute inset-0">
          <OndaSvg opacidade={0.14} variante={2} />
          <OndaSvg opacidade={0.14} variante={2} />
        </div>
        <div className="hemc-onda-track hemc-onda-camada-3 absolute inset-0">
          <OndaSvg opacidade={0.2} variante={3} />
          <OndaSvg opacidade={0.2} variante={3} />
        </div>
      </div>

      <div className="relative flex items-center gap-3">
        <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-lg bg-white/10 backdrop-blur">
          <img src={LOGO_PADRAO_HEMC} alt="Logo Padrão HEMC" className="h-full w-full scale-150 object-contain" />
        </div>
        <div className="text-xl font-semibold">Padrão HEMC</div>
      </div>
      <div className="relative">
        <h1 className="text-4xl font-bold leading-tight">{titulo}</h1>
        <p className="mt-4 max-w-md text-primary-foreground/80">{descricao}</p>
      </div>
      <div className="relative text-xs opacity-70"> Rua Dr. Henrique Calderazzo, 321 • Santo André/SP • CEP 09190-615</div>
    </div>
  );
}

// Um único "trecho" de onda, em formato SVG. Cada trilho (hemc-onda-track)
// renderiza duas cópias lado a lado e desliza -50% infinitamente — como o
// início/fim de cada trecho ficam na mesma altura, a transição é invisível
// e o efeito parece uma superfície de água contínua, nunca se repetindo
// de forma óbvia.
function OndaSvg({ opacidade, variante }: { opacidade: number; variante: 1 | 2 | 3 }) {
  const caminhos: Record<1 | 2 | 3, string> = {
    1: "M0,110 C100,150 200,70 300,110 C400,150 500,70 600,110 L600,200 L0,200 Z",
    2: "M0,120 C110,70 210,160 320,110 C430,60 530,150 600,120 L600,200 L0,200 Z",
    3: "M0,140 C120,180 220,90 340,130 C460,170 540,90 600,140 L600,200 L0,200 Z",
  };
  return (
    <svg viewBox="0 0 600 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d={caminhos[variante]} fill="currentColor" opacity={opacidade} />
    </svg>
  );
}

function MarcaMobile() {
  return (
    <div className="mb-2 flex items-center gap-2 text-primary lg:hidden">
      <img src={LOGO_PADRAO_HEMC} alt="Logo Padrão HEMC" className="h-7 w-7 scale-150 object-contain" />
      <span className="font-semibold">Padrão HEMC</span>
    </div>
  );
}

function FormularioCadastro({ ativo, aoVoltar }: { ativo: boolean; aoVoltar: () => void }) {
  const [nome, setNome] = useState("");
  const [re, setRe] = useState("");
  const [setorId, setSetorId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const buscarSetores = useServerFn(listarSetoresPublico);
  const { data: setores } = useQuery({
    queryKey: ["setores-publico"],
    queryFn: () => buscarSetores(),
    enabled: ativo, // só busca quando a cena de cadastro está visível
    staleTime: 60_000,
  });

  const enviarSolicitacao = useServerFn(solicitarCadastro);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !re.trim() || !setorId) {
      toast.error("Preencha nome completo, RE e setor.");
      return;
    }
    setEnviando(true);
    try {
      await enviarSolicitacao({ data: { nome_completo: nome.trim(), re: re.trim(), setor_id: setorId } });
      setEnviado(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar a solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <div>
          <p className="font-medium">Solicitação enviada!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A TI vai revisar seu pedido. Você recebe sua senha de acesso assim que for aprovado.
          </p>
        </div>
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => {
            setEnviado(false);
            setNome("");
            setRe("");
            setSetorId("");
            aoVoltar();
          }}
        >
          Voltar para o login
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submeter} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cad-nome">Nome completo</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="cad-nome"
            className="pl-9"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={enviando}
            maxLength={120}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cad-re">RE</Label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="cad-re"
            placeholder="Ex.: 123456"
            className="pl-9"
            value={re}
            onChange={(e) => setRe(e.target.value)}
            disabled={enviando}
            maxLength={30}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cad-setor">Setor</Label>
        <Select value={setorId} onValueChange={setSetorId} disabled={enviando}>
          <SelectTrigger id="cad-setor" className="relative pl-9">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <SelectValue placeholder="Selecionar setor..." />
          </SelectTrigger>
          <SelectContent>
            {(setores ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Solicitar acesso
      </Button>
      <button
        type="button"
        onClick={aoVoltar}
        className="w-full text-center text-sm font-medium text-primary transition-colors hover:underline"
      >
        Já tem acesso?
      </button>
    </form>
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
      <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-center text-sm">
        <ShieldPlus className="h-5 w-5 text-warning" />
        <div className="font-medium">Primeiro acesso ao sistema</div>
        <p className="text-xs text-muted-foreground">
          Nenhum usuário cadastrado. Crie o administrador inicial para começar.
        </p>
        <Button size="sm" variant="secondary" className="mt-1" onClick={() => setAberto(true)}>
          Configurar administrador
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submeter} className="mt-4 space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
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
      <div className="flex justify-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
        </Button>
      </div>
    </form>
  );
}