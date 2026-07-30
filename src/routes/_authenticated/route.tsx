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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Hospital,
  LogOut,
  User,
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
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { registrarAuditoria } from "@/lib/audit";
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
  { to: "/editor", rotulo: "Editor de Etiquetas", icone: Tag },
  { to: "/documentos/editor", rotulo: "Editor de Documentos", icone: FilePlus2 },
  { to: "/biblioteca", rotulo: "Biblioteca de Etiquetas", icone: Library },
  { to: "/documentos", rotulo: "Biblioteca de Documentos", icone: FileText },
  { to: "/admin/usuarios", rotulo: "Administração de Usuários", icone: Users, soAdmin: true },
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

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, sidebarColapsada ? "1" : "0");
    } catch {
      // localStorage indisponível (modo privado, por exemplo) — preferência
      // simplesmente não persiste entre sessões, sem impacto funcional.
    }
  }, [sidebarColapsada]);

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
        profile={profile}
        onAbrirMenu={() => setMenuAberto(true)}
        sidebarColapsada={sidebarColapsada}
        onAlternarSidebar={() => setSidebarColapsada((v) => !v)}
      />
      <div className="flex flex-1">
        <aside
          className={`hidden md:flex flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out ${
            sidebarColapsada ? "w-16" : "w-64"
          }`}
        >
          <NavItens itens={itens} colapsada={sidebarColapsada} />
        </aside>
        <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
          <SheetContent side="left" className="p-0 w-72 bg-sidebar text-sidebar-foreground">
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <Hospital className="h-5 w-5 text-primary" />
                <span className="font-semibold">Padrão HEMC</span>
              </div>
            </div>
            <NavItens itens={itens} onClique={() => setMenuAberto(false)} />
          </SheetContent>
        </Sheet>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
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

function Cabecalho({
  profile,
  onAbrirMenu,
  sidebarColapsada,
  onAlternarSidebar,
}: {
  profile: NonNullable<ReturnType<typeof useProfile>["data"]>;
  onAbrirMenu: () => void;
  sidebarColapsada: boolean;
  onAlternarSidebar: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function sair() {
    await registrarAuditoria({ acao: "logout" });
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

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
          <AlternadorTema />
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 max-w-[240px]">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/20 text-primary shrink-0">
                <User className="h-4 w-4" />
              </div>
              <div className="text-left min-w-0 hidden sm:block">
                <div className="text-sm font-medium truncate leading-tight">
                  {profile.nome_completo}
                </div>
                <div className="text-xs text-muted-foreground truncate leading-tight">
                  {profile.setor?.sigla ?? "Sem setor"} · RE {profile.re}
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium">{profile.nome_completo}</div>
              <div className="text-xs text-muted-foreground font-normal">
                {profile.role === "admin" ? "Administrador" : "Colaborador"}
                {profile.setor ? ` · ${profile.setor.nome}` : ""}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={sair}>
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
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