import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Hospital,
  LogOut,
  Menu,
  Tag,
  FileText,
  FilePlus2,
  Library,
  Users,
  Building2,
  ScrollText,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Cpu,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { registrarAuditoria } from "@/lib/audit";
import { registrarAceiteLGPD } from "@/lib/lgpd.functions";
import { useTheme } from "@/hooks/use-theme";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) throw redirect({ to: "/auth" });

    // Bloqueia o acesso ao sistema enquanto a troca de senha obrigatória
    // não for concluída — mesmo se a pessoa digitar a URL direto (ex.:
    // /editor) em vez de passar pela tela de login normalmente.
    const { data: profile } = await supabase
      .from("profiles")
      .select("deve_trocar_senha")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.deve_trocar_senha) throw redirect({ to: "/auth" });

    return { user };
  },
  component: LayoutAutenticado,
});

type ItemNav = {
  to: string;
  rotulo: string;
  icone: React.ComponentType<{ className?: string }>;
  soAdmin?: boolean;
};

const NAV: ItemNav[] = [
  { to: "/editor", rotulo: "Novas Etiquetas", icone: Tag },
  { to: "/biblioteca", rotulo: "Biblioteca de Etiquetas", icone: Library },
  { to: "/documentos/editor", rotulo: "Novos Documentos", icone: FilePlus2 },
  { to: "/documentos", rotulo: "Biblioteca de Documentos", icone: FileText },
  { to: "/admin/usuarios", rotulo: "Gestão de Usuários", icone: Users, soAdmin: true },
  { to: "/admin/setores", rotulo: "Setores", icone: Building2, soAdmin: true },
  { to: "/admin/auditoria", rotulo: "Trilha de Auditoria", icone: ScrollText, soAdmin: true },
  { to: "/agente-impressao", rotulo: "Agente de Impressão", icone: Cpu, soAdmin: true },
];

const CHAVE_SIDEBAR_COLAPSADA = "hemc_sidebar_colapsada";

function lerPreferenciaSidebar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA) === "1";
  } catch {
    return false;
  }
}

function LayoutAutenticado() {
  const { data: profile, isLoading } = useProfile();
  const [menuAberto, setMenuAberto] = useState(false);
  const [sidebarColapsada, setSidebarColapsada] = useState(lerPreferenciaSidebar);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, sidebarColapsada ? "1" : "0");
    } catch {
      // localStorage indisponível (modo privado, por exemplo) — preferência
      // simplesmente não persiste entre sessões, sem impacto funcional.
    }
  }, [sidebarColapsada]);

  // Contagem de solicitações pendentes — só faz sentido buscar pra admin,
  // que é quem vê o item de menu e o número ao lado dele.
  const { data: contagemPendentes } = useQuery({
    queryKey: ["solicitacoes-pendentes-contagem"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("solicitacoes")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: profile?.role === "admin",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  async function sair() {
    await registrarAuditoria({ acao: "logout" });
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading || !profile) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const itens = NAV.filter((i) => !i.soAdmin || profile.role === "admin");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Cabecalho
        ehAdmin={profile.role === "admin"}
        onAbrirMenu={() => setMenuAberto(true)}
        sidebarColapsada={sidebarColapsada}
        onAlternarSidebar={() => setSidebarColapsada((v) => !v)}
        contagemSolicitacoes={contagemPendentes ?? 0}
      />
      <div className="flex flex-1">
        <aside
          className={`hidden md:flex flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out ${
            sidebarColapsada ? "w-16" : "w-64"
          }`}
        >
          <NavItens itens={itens} colapsada={sidebarColapsada} />
          <RodapeUsuario profile={profile} colapsada={sidebarColapsada} onSair={sair} />
        </aside>
        <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
          <SheetContent side="left" className="flex h-full w-72 flex-col bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <Hospital className="h-5 w-5 text-primary" />
                <span className="font-semibold">Padrão HEMC</span>
              </div>
            </div>
            <NavItens itens={itens} onClique={() => setMenuAberto(false)} />
            <RodapeUsuario profile={profile} onSair={sair} />
          </SheetContent>
        </Sheet>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>

      <RodapeCreditos />

      <ModalAceiteLGPD lgpdAceiteEm={profile.lgpd_aceite_em} />
    </div>
  );
}

function ModalAceiteLGPD({ lgpdAceiteEm }: { lgpdAceiteEm: string | null }) {
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const aceitar = useServerFn(registrarAceiteLGPD);

  const precisaAceitar = lgpdAceiteEm === null;

  async function confirmar() {
    setEnviando(true);
    try {
      await aceitar({ data: undefined });
      qc.invalidateQueries({ queryKey: ["profile-atual"] });
    } catch {
      toast.error("Não foi possível registrar o aceite. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={precisaAceitar}>
      <DialogContent
        className="[&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Uso de dados (LGPD)</span>
          </div>
          <DialogTitle>Antes de continuar</DialogTitle>
          <DialogDescription className="space-y-2 pt-2 text-left">
            <span className="block">
              O Padrão HEMC armazena dados como seu nome, RE e setor pra controlar o acesso e manter a
              trilha de auditoria do sistema, em conformidade com a Lei Geral de Proteção de Dados
              (LGPD).
            </span>
            <span className="block">
              Esses dados não são compartilhados fora da instituição e ficam disponíveis apenas para
              administradores do sistema.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={confirmar} disabled={enviando} className="w-full sm:w-auto">
            {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Li e estou de acordo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NavItens({
  itens,
  onClique,
  colapsada,
}: {
  itens: ItemNav[];
  onClique?: () => void;
  colapsada?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Evita que uma rota "pai" (ex.: /documentos) e sua rota "filha"
  // (ex.: /documentos/editor) fiquem destacadas ao mesmo tempo — sempre
  // vence a correspondência mais específica (o "to" mais longo que bate).
  const itemAtivoTo = useMemo(() => {
    let melhor: string | null = null;
    for (const item of itens) {
      const bate = pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (bate && (!melhor || item.to.length > melhor.length)) {
        melhor = item.to;
      }
    }
    return melhor;
  }, [pathname, itens]);

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex flex-col gap-1 p-3">
        {itens.map((item) => {
          const Ic = item.icone;
          const ativo = item.to === itemAtivoTo;
          const link = (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClique}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                colapsada ? "justify-center" : ""
              } ${
                ativo
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Ic className="h-4 w-4 shrink-0" />
              {!colapsada && <span className="truncate">{item.rotulo}</span>}
            </Link>
          );

          if (!colapsada) return link;

          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.rotulo}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cartão de usuário fixo no rodapé da sidebar — avatar com iniciais, RE e
// setor sempre visíveis, nome completo e "Sair" dentro do menu (clique).
// Substitui o dropdown que ficava solto no cabeçalho: menos poluição ali
// em cima, e o padrão "conta no rodapé da barra lateral" é o mesmo que
// Slack, Notion e afins usam.
function RodapeUsuario({
  profile,
  colapsada,
  onSair,
}: {
  profile: NonNullable<ReturnType<typeof useProfile>["data"]>;
  colapsada?: boolean;
  onSair: () => void;
}) {
  return (
    <div className="mt-auto border-t border-sidebar-border p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent ${
              colapsada ? "justify-center" : ""
            }`}
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {iniciais(profile.nome_completo)}
            </div>
            {!colapsada && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-sidebar-foreground/70">
                  {profile.setor?.sigla ?? "Sem setor"} · RE {profile.re}
                </div>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>
            <div className="font-medium">{profile.nome_completo}</div>
            <div className="text-xs text-muted-foreground font-normal">
              {profile.role === "admin" ? "Administrador" : "Colaborador"}
              {profile.setor ? ` · ${profile.setor.nome}` : ""}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSair}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Rodapé fixo na tela — igual o visual da sidebar (sem caixa, sem borda,
// só o texto flutuando), mas agora "position: fixed" na parte de baixo da
// janela inteira: fica sempre visível, não importa o quanto a página role,
// sem precisar rolar até o fim pra ver. pointer-events-none no wrapper +
// auto só no link, pra não bloquear cliques no resto da tela por baixo.
function RodapeCreditos() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-1.5 z-20 flex justify-center">
      <a
        href="https://github.com/Barreto0620"
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto text-[11px] text-muted-foreground/25 transition-colors duration-300 hover:text-primary"
      >
        Gabriel Barreto
      </a>
    </div>
  );
}

function Cabecalho({
  onAbrirMenu,
  sidebarColapsada,
  onAlternarSidebar,
  contagemSolicitacoes,
  ehAdmin,
}: {
  onAbrirMenu: () => void;
  sidebarColapsada: boolean;
  onAlternarSidebar: () => void;
  contagemSolicitacoes: number;
  ehAdmin: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 h-14">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onAbrirMenu}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={onAlternarSidebar}
            aria-label={sidebarColapsada ? "Expandir menu" : "Recolher menu"}
            title={sidebarColapsada ? "Expandir menu" : "Recolher menu"}
          >
            {sidebarColapsada ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
          <Link to="/editor" className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-md hemc-gradient text-primary-foreground shrink-0">
              <Hospital className="h-4 w-4" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <div className="text-sm font-semibold leading-tight truncate">Padrão HEMC</div>
            </div>
          </Link>
        </div>
        <div />
        <div className="flex items-center gap-1">
          {ehAdmin && <BotaoSolicitacoes contagem={contagemSolicitacoes} />}
          <AlternadorTema />
        </div>
      </div>
    </header>
  );
}

// Ícone de "pendências" no cabeçalho — mesma ideia de um sino de
// notificação: fica sempre visível pro admin, com a bolinha de contagem,
// em vez de ocupar uma linha inteira na barra lateral só pra isso.
function BotaoSolicitacoes({ contagem }: { contagem: number }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ativo = pathname === "/admin/solicitacoes" || pathname.startsWith("/admin/solicitacoes/");

  return (
    <Link to="/admin/solicitacoes" className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Solicitações pendentes"
        title="Solicitações pendentes"
        className={ativo ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary" : ""}
      >
        <Inbox className="h-4 w-4" />
      </Button>
      {contagem > 0 && (
        <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[9px] font-bold text-warning-foreground">
          {contagem > 99 ? "99+" : contagem}
        </span>
      )}
    </Link>
  );
}

function AlternadorTema() {
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