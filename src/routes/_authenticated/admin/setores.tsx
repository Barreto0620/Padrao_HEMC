import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { registrarAuditoria } from "@/lib/audit";
import {
  Loader2, Plus, Pencil, Search, SlidersHorizontal, X, Users, MoreVertical,
  Ban, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/setores")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Setores — Padrão HEMC" }, { name: "description", content: "Gestão de setores do Padrão HEMC." }],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/editor" });
  },
  component: PaginaSetores,
});

type Setor = { id: string; nome: string; sigla: string; ativo: boolean; created_at: string };
type Colaborador = {
  id: string;
  nome_completo: string;
  re: string;
  ativo: boolean;
  role: "admin" | "colaborador";
  setor_id: string | null;
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function PaginaSetores() {
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [ordenarPor, setOrdenarPor] = useState<string>("nome");

  const [editando, setEditando] = useState<Setor | null>(null);
  const [novo, setNovo] = useState(false);
  const [setorDetalhes, setSetorDetalhes] = useState<Setor | null>(null);
  const [setorDesativando, setSetorDesativando] = useState<Setor | null>(null);

  const { data: setores, isLoading } = useQuery({
    queryKey: ["setores-todos"],
    queryFn: async (): Promise<Setor[]> => {
      const { data, error } = await supabase.from("setores").select("id, nome, sigla, ativo, created_at").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Busca todos os colaboradores uma vez só, e agrupa por setor no cliente —
  // é o que permite mostrar "quem está no setor" sem precisar de uma
  // consulta separada pra cada linha da tabela.
  const { data: colaboradores } = useQuery({
    queryKey: ["colaboradores-para-setores"],
    queryFn: async (): Promise<Colaborador[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome_completo, re, ativo, role, setor_id")
        .order("nome_completo");
      if (error) throw error;
      return (data ?? []) as Colaborador[];
    },
  });

  const mapaColaboradores = useMemo(() => {
    const mapa = new Map<string, Colaborador[]>();
    for (const c of colaboradores ?? []) {
      if (!c.setor_id) continue;
      const lista = mapa.get(c.setor_id) ?? [];
      lista.push(c);
      mapa.set(c.setor_id, lista);
    }
    return mapa;
  }, [colaboradores]);

  const mutSalvar = useMutation({
    mutationFn: async (s: Partial<Setor> & { id?: string }) => {
      if (s.id) {
        const { error } = await supabase.from("setores").update({ nome: s.nome, sigla: s.sigla, ativo: s.ativo ?? true }).eq("id", s.id);
        if (error) throw error;
        await registrarAuditoria({ acao: "setor_editado", entidade_tipo: "setor", entidade_id: s.id, detalhes: { nome: s.nome, ativo: s.ativo } });
      } else {
        const { data, error } = await supabase.from("setores").insert({ nome: s.nome!, sigla: s.sigla! }).select("id").single();
        if (error) throw error;
        await registrarAuditoria({ acao: "setor_criado", entidade_tipo: "setor", entidade_id: data.id, detalhes: { nome: s.nome } });
      }
    },
    onSuccess: () => {
      toast.success("Setor salvo.");
      qc.invalidateQueries({ queryKey: ["setores-todos"] });
      qc.invalidateQueries({ queryKey: ["setores-ativos"] });
      setEditando(null); setNovo(false); setSetorDesativando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const contagemFiltrosAtivos = filtroStatus !== "todos" ? 1 : 0;

  function limparFiltros() {
    setFiltroStatus("todos");
    setOrdenarPor("nome");
  }

  const filtrados = useMemo(() => {
    let lista = setores ?? [];

    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      lista = lista.filter((s) => (s.nome + " " + s.sigla).toLowerCase().includes(q));
    }
    if (filtroStatus !== "todos") {
      lista = lista.filter((s) => (filtroStatus === "ativos" ? s.ativo : !s.ativo));
    }

    lista = [...lista].sort((a, b) => {
      if (ordenarPor === "sigla") return a.sigla.localeCompare(b.sigla);
      if (ordenarPor === "colaboradores") {
        return (mapaColaboradores.get(b.id)?.length ?? 0) - (mapaColaboradores.get(a.id)?.length ?? 0);
      }
      if (ordenarPor === "recentes") return b.created_at.localeCompare(a.created_at);
      return a.nome.localeCompare(b.nome);
    });

    return lista;
  }, [setores, busca, filtroStatus, ordenarPor, mapaColaboradores]);

  function pedirDesativar(s: Setor) {
    const qtdAtivos = (mapaColaboradores.get(s.id) ?? []).filter((c) => c.ativo).length;
    if (qtdAtivos > 0) {
      setSetorDesativando(s);
    } else {
      mutSalvar.mutate({ id: s.id, nome: s.nome, sigla: s.sigla, ativo: false });
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo="Setores"
        descricao="Cadastre e edite os setores do hospital."
        acoes={<Button onClick={() => setNovo(true)}><Plus className="h-4 w-4 mr-2" /> Novo setor</Button>}
      />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:p-8">
        {/* Busca + filtros — fica fixo, não rola junto com a lista */}
        <div className="shrink-0 rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou sigla..."
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</Label>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="ativos">Ativos</SelectItem>
                      <SelectItem value="desativados">Desativados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ordenar por</Label>
                  <Select value={ordenarPor} onValueChange={setOrdenarPor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nome">Nome (A-Z)</SelectItem>
                      <SelectItem value="sigla">Sigla</SelectItem>
                      <SelectItem value="colaboradores">Mais colaboradores</SelectItem>
                      <SelectItem value="recentes">Mais recentes</SelectItem>
                    </SelectContent>
                  </Select>
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
            {busca || contagemFiltrosAtivos > 0 ? "Nenhum setor encontrado com esses filtros." : "Nenhum setor cadastrado ainda."}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-xl border bg-card scroll-elegante">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Setor</TableHead>
                  <TableHead>Colaboradores</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((s) => {
                  const qtd = mapaColaboradores.get(s.id)?.length ?? 0;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.nome}</span>
                          <Badge variant="secondary">{s.sigla}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setSetorDetalhes(s)}
                          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          <Users className="h-3.5 w-3.5" />
                          {qtd} {qtd === 1 ? "colaborador" : "colaboradores"}
                        </button>
                      </TableCell>
                      <TableCell>
                        {s.ativo ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Desativado</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => setSetorDetalhes(s)}>
                              <Users className="h-4 w-4 mr-2" /> Ver colaboradores
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditando(s)}>
                              <Pencil className="h-4 w-4 mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {s.ativo ? (
                              <DropdownMenuItem onClick={() => pedirDesativar(s)} className="text-destructive focus:text-destructive">
                                <Ban className="h-4 w-4 mr-2" /> Desativar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => mutSalvar.mutate({ id: s.id, nome: s.nome, sigla: s.sigla, ativo: true })}>
                                <CheckCircle2 className="h-4 w-4 mr-2" /> Ativar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DialogoSetor
        aberto={novo || !!editando}
        setor={editando}
        onFechar={() => { setEditando(null); setNovo(false); }}
        onSalvar={(s) => mutSalvar.mutate(s)}
        salvando={mutSalvar.isPending}
      />

      <SheetColaboradoresSetor
        setor={setorDetalhes}
        colaboradores={setorDetalhes ? (mapaColaboradores.get(setorDetalhes.id) ?? []) : []}
        onFechar={() => setSetorDetalhes(null)}
      />

      <AlertDialog open={!!setorDesativando} onOpenChange={(o) => !o && setSetorDesativando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {setorDesativando?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Este setor tem {setorDesativando ? (mapaColaboradores.get(setorDesativando.id) ?? []).filter((c) => c.ativo).length : 0}{" "}
              colaborador(es) ativo(s) vinculado(s). Desativar o setor <strong>não desativa</strong> esses
              colaboradores — eles continuam com acesso normal, só ficam vinculados a um setor marcado
              como inativo até serem realocados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={mutSalvar.isPending}
              onClick={() => setorDesativando && mutSalvar.mutate({ id: setorDesativando.id, nome: setorDesativando.nome, sigla: setorDesativando.sigla, ativo: false })}
            >
              {mutSalvar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Desativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SheetColaboradoresSetor({
  setor, colaboradores, onFechar,
}: { setor: Setor | null; colaboradores: Colaborador[]; onFechar: () => void }) {
  return (
    <Sheet open={!!setor} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full sm:max-w-md">
        {setor && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle>{setor.nome}</SheetTitle>
                <Badge variant="secondary">{setor.sigla}</Badge>
              </div>
              <SheetDescription>
                {colaboradores.length === 0
                  ? "Nenhum colaborador vinculado ainda."
                  : `${colaboradores.length} ${colaboradores.length === 1 ? "colaborador vinculado" : "colaboradores vinculados"}.`}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 max-h-[70vh] space-y-1 overflow-y-auto scroll-elegante">
              {colaboradores.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Ninguém está vinculado a este setor por enquanto.
                </div>
              ) : (
                colaboradores
                  .slice()
                  .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo))
                  .map((c) => (
                    <div key={c.id} className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-accent">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {iniciais(c.nome_completo)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.nome_completo}</div>
                        <div className="text-xs text-muted-foreground">RE {c.re}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.role === "admin" && (
                          <Badge className="text-[10px]">Admin</Badge>
                        )}
                        {!c.ativo && (
                          <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DialogoSetor({
  aberto, setor, onFechar, onSalvar, salvando,
}: { aberto: boolean; setor: Setor | null; onFechar: () => void; onSalvar: (s: Partial<Setor> & { id?: string }) => void; salvando: boolean }) {
  const [nome, setNome] = useState(setor?.nome ?? "");
  const [sigla, setSigla] = useState(setor?.sigla ?? "");
  const [ativo, setAtivo] = useState(setor?.ativo ?? true);

  // Reset ao abrir
  useState(() => {
    setNome(setor?.nome ?? ""); setSigla(setor?.sigla ?? ""); setAtivo(setor?.ativo ?? true);
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{setor ? "Editar setor" : "Novo setor"}</DialogTitle>
          <DialogDescription>Preencha o nome e a sigla do setor.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault();
            if (!nome.trim() || !sigla.trim()) { toast.error("Preencha nome e sigla."); return; }
            onSalvar({ id: setor?.id, nome: nome.trim(), sigla: sigla.trim().toUpperCase(), ativo });
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5"><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} /></div>
          <div className="space-y-1.5"><Label>Sigla</Label><Input value={sigla} onChange={(e) => setSigla(e.target.value.toUpperCase())} maxLength={10} /></div>
          {setor && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={ativo} onCheckedChange={(v) => setAtivo(!!v)} /> Ativo
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}