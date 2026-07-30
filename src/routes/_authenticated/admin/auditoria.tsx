import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { registrarAuditoria } from "@/lib/audit";
import { Loader2, Search, SlidersHorizontal, X, ScrollText, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Trilha de Auditoria — Padrão HEMC" }, { name: "description", content: "Consulta à trilha de auditoria do Padrão HEMC." }],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/editor" });
  },
  component: PaginaAuditoria,
});

// Mantido em sincronia com todas as ações realmente emitidas pelo sistema
// (audit.ts, admin.functions.ts, editor.tsx, setores.tsx, usuarios.tsx).
const ROTULO_ACAO: Record<string, string> = {
  login: "Login realizado",
  logout: "Logout",
  usuario_criado: "Usuário criado",
  usuario_editado: "Usuário editado",
  usuario_desativado: "Usuário desativado",
  usuario_ativado: "Usuário ativado",
  senha_redefinida_por_admin: "Senha redefinida (admin)",
  senha_alterada_pelo_usuario: "Senha alterada pelo usuário",
  setor_criado: "Setor criado",
  setor_editado: "Setor editado",
  template_criado: "Modelo criado",
  template_editado: "Modelo editado",
  template_excluido: "Modelo excluído",
  etiqueta_emitida: "Etiqueta emitida",
  auditoria_exportada: "Trilha exportada (CSV)",
};

// Traduz as chaves técnicas do campo "detalhes" (jsonb) pra rótulos
// legíveis — sem isso, a coluna mostrava coisa tipo "role: admin",
// "setor_id: 3f2a...", pouco amigável pra quem não é da TI.
const ROTULO_CHAVE_DETALHE: Record<string, string> = {
  nome_completo: "Nome",
  nome: "Nome",
  re: "RE",
  role: "Perfil",
  ativo: "Status",
  setor_id: "Setor",
  copias: "Cópias",
  formato: "Formato",
  impressora: "Impressora",
  registros: "Registros",
};

const ROTULO_FORMATO_IMPRESSAO: Record<string, string> = {
  driver_windows: "Driver do Windows",
  zpl_direto_lpt1: "Direto (agente / LPT1)",
  zpl: "Arquivo ZPL",
  folha: "Folha comum",
};

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatarValorDetalhe(chave: string, valor: unknown): string {
  if (chave === "role") return valor === "admin" ? "Administrador" : "Colaborador";
  if (chave === "ativo") return valor ? "Ativo" : "Inativo";
  if (chave === "formato") return ROTULO_FORMATO_IMPRESSAO[String(valor)] ?? String(valor);
  if (typeof valor === "string" && REGEX_UUID.test(valor)) return `${valor.slice(0, 8)}…`;
  return String(valor);
}

const LIMITE_REGISTROS = 500;

function classeBadgeAcao(acao: string): string {
  if (acao.includes("desativado") || acao.includes("excluido")) {
    return "border-destructive/40 text-destructive";
  }
  if (acao.includes("criado") || acao.includes("ativado") || acao === "login" || acao.includes("emitida")) {
    return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
  }
  return "";
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// CSV com ; como separador (não vírgula) — é o padrão que o Excel em
// português espera, já que "," é o separador decimal no Brasil. Com vírgula
// como delimitador, o Excel BR abre tudo espremido numa coluna só.
function paraCelulaCSV(valor: string): string {
  const precisaAspas = /[";\n]/.test(valor);
  const escapado = valor.replace(/"/g, '""');
  return precisaAspas ? `"${escapado}"` : escapado;
}

function detalhesParaTexto(detalhes: Record<string, unknown>): string {
  return Object.entries(detalhes)
    .map(([k, v]) => `${ROTULO_CHAVE_DETALHE[k] ?? k}: ${formatarValorDetalhe(k, v)}`)
    .join(" | ");
}

type Log = {
  id: string;
  acao: string;
  entidade_tipo: string | null;
  entidade_id: string | null;
  detalhes: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
  usuario: { nome_completo: string; re: string; setor: { sigla: string; nome: string } | null } | null;
};

function PaginaAuditoria() {
  const [busca, setBusca] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [acao, setAcao] = useState<string>("todas");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [exportando, setExportando] = useState(false);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["auditoria", acao, dataInicio, dataFim],
    queryFn: async (): Promise<Log[]> => {
      let q = supabase
        .from("audit_logs")
        .select("id, acao, entidade_tipo, entidade_id, detalhes, created_at, user_id, usuario:profiles(nome_completo, re, setor:setores(sigla, nome))")
        .order("created_at", { ascending: false })
        .limit(LIMITE_REGISTROS);
      if (acao !== "todas") q = q.eq("acao", acao);
      if (dataInicio) q = q.gte("created_at", new Date(dataInicio).toISOString());
      if (dataFim) {
        const fim = new Date(dataFim); fim.setHours(23, 59, 59);
        q = q.lte("created_at", fim.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Log[];
    },
  });

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return logs ?? [];
    return (logs ?? []).filter((l) =>
      (l.usuario?.nome_completo ?? "").toLowerCase().includes(b) ||
      (l.usuario?.re ?? "").toLowerCase().includes(b) ||
      (l.usuario?.setor?.sigla ?? "").toLowerCase().includes(b),
    );
  }, [logs, busca]);

  const contagemFiltrosAtivos = [acao !== "todas", !!dataInicio, !!dataFim].filter(Boolean).length;

  function limparFiltros() {
    setAcao("todas");
    setDataInicio("");
    setDataFim("");
  }

  async function baixarCSV() {
    if (filtrados.length === 0) return;
    setExportando(true);
    try {
      const cabecalho = ["Data/Hora", "Nome", "RE", "Setor", "Ação", "Detalhes"];
      const linhas = filtrados.map((l) => [
        new Date(l.created_at).toLocaleString("pt-BR"),
        l.usuario?.nome_completo ?? "Usuário removido",
        l.usuario?.re ?? "",
        l.usuario?.setor?.nome ?? "",
        ROTULO_ACAO[l.acao] ?? l.acao,
        detalhesParaTexto(l.detalhes),
      ]);
      const conteudo = [cabecalho, ...linhas]
        .map((linha) => linha.map((c) => paraCelulaCSV(String(c))).join(";"))
        .join("\r\n");

      // BOM UTF-8 no início — sem isso o Excel abre "Não" como "NÃ£o"
      const blob = new Blob(["\uFEFF" + conteudo], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dataArquivo = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `trilha-auditoria-${dataArquivo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await registrarAuditoria({
        acao: "auditoria_exportada",
        detalhes: { registros: filtrados.length },
      });
      toast.success(`${filtrados.length} registro(s) exportado(s).`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo="Trilha de Auditoria"
        descricao="Registros append-only de todas as ações relevantes no sistema — ninguém edita ou apaga um registro daqui, nem admin."
        acoes={
          <Button variant="outline" onClick={baixarCSV} disabled={exportando || filtrados.length === 0}>
            {exportando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar CSV
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:p-8">
        {/* Busca + filtros — fica fixo, não rola junto com a lista */}
        <div className="shrink-0 rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, RE ou setor..."
                className="pl-9"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Button
              variant={filtrosAbertos ? "secondary" : "outline"}
              onClick={() => setFiltrosAbertos((v) => !v)}
              className="shrink-0"
            >
              <SlidersHorizontal className="h-4 w-4 mr-2" /> Filtros
              {contagemFiltrosAtivos > 0 && (
                <Badge className="ml-2 h-5 rounded-full px-1.5 text-[10px]">{contagemFiltrosAtivos}</Badge>
              )}
            </Button>
          </div>

          {filtrosAbertos && (
            <>
              <Separator className="my-4" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo de ação</Label>
                  <Select value={acao} onValueChange={setAcao}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      {Object.entries(ROTULO_ACAO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">De</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Até</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </div>
              </div>
              {contagemFiltrosAtivos > 0 && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  <X className="h-3 w-3" /> Limpar filtros
                </button>
              )}
            </>
          )}
        </div>

        {/* Lista — essa é a parte que rola, sozinha, dentro do espaço que sobrar */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border bg-card text-center text-muted-foreground">
            {busca || contagemFiltrosAtivos > 0 ? "Nenhum registro encontrado com esses filtros." : "Nenhum registro ainda."}
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex-1 overflow-y-auto rounded-xl border bg-card scroll-elegante">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-44">Quando</TableHead>
                    <TableHead>Quem</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="align-top">
                        {l.usuario ? (
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
                                {iniciais(l.usuario.nome_completo)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{l.usuario.nome_completo}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                RE {l.usuario.re}{l.usuario.setor ? ` · ${l.usuario.setor.sigla}` : ""}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">Usuário removido</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={classeBadgeAcao(l.acao)}>
                          {ROTULO_ACAO[l.acao] ?? l.acao}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {l.detalhes && Object.keys(l.detalhes).length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {Object.entries(l.detalhes).map(([k, v]) => (
                              <span key={k} className="whitespace-nowrap" title={String(v)}>
                                <span className="opacity-60">{ROTULO_CHAVE_DETALHE[k] ?? k}:</span>{" "}
                                <span className="font-medium text-foreground/80">{formatarValorDetalhe(k, v)}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="opacity-50">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {logs && logs.length >= LIMITE_REGISTROS && (
              <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <ScrollText className="h-3.5 w-3.5" />
                Mostrando os {LIMITE_REGISTROS} registros mais recentes. Use os filtros de data pra refinar o período (o CSV baixa exatamente o que estiver na tela).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}