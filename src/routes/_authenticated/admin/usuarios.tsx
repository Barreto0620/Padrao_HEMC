import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
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
import { useServerFn } from "@tanstack/react-start";
import {
  criarUsuario, alternarUsuarioAtivo, atualizarUsuario, redefinirSenhaUsuario,
} from "@/lib/admin.functions";
import {
  Loader2, Plus, Search, UserPlus, SlidersHorizontal, MoreVertical, Eye, Pencil,
  KeyRound, Ban, CheckCircle2, Shuffle, Copy, X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Usuários — Padrão HEMC" }, { name: "description", content: "Gestão de usuários do Padrão HEMC." }],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/editor" });
  },
  component: PaginaUsuarios,
});

type Perfil = {
  id: string;
  nome_completo: string;
  re: string;
  role: "admin" | "colaborador";
  ativo: boolean;
  setor_id: string | null;
  created_at: string;
  setor: { nome: string; sigla: string } | null;
};

type Setor = { id: string; nome: string };

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function gerarSenhaAleatoria(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += chars[arr[i] % chars.length];
  return s;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function PaginaUsuarios() {
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [filtroSetor, setFiltroSetor] = useState<string>("todos");
  const [filtroPerfil, setFiltroPerfil] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [ordenarPor, setOrdenarPor] = useState<string>("nome");

  const [abrirNovo, setAbrirNovo] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Perfil | null>(null);
  const [usuarioSenha, setUsuarioSenha] = useState<Perfil | null>(null);
  const [usuarioDetalhes, setUsuarioDetalhes] = useState<Perfil | null>(null);
  const [usuarioDesativando, setUsuarioDesativando] = useState<Perfil | null>(null);

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: async (): Promise<Perfil[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome_completo, re, role, ativo, setor_id, created_at, setor:setores(nome, sigla)")
        .order("nome_completo");
      if (error) throw error;
      return (data ?? []) as Perfil[];
    },
  });

  const { data: setores } = useQuery({
    queryKey: ["setores-ativos"],
    queryFn: async (): Promise<Setor[]> => {
      const { data, error } = await supabase.from("setores").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const alternar = useServerFn(alternarUsuarioAtivo);
  const mutAlt = useMutation({
    mutationFn: (p: { user_id: string; ativo: boolean }) => alternar({ data: p }),
    onSuccess: (_r, variables) => {
      toast.success(variables.ativo ? "Usuário ativado." : "Usuário desativado.");
      qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      setUsuarioDesativando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const contagemFiltrosAtivos = [filtroSetor, filtroPerfil, filtroStatus].filter((v) => v !== "todos").length;

  function limparFiltros() {
    setFiltroSetor("todos");
    setFiltroPerfil("todos");
    setFiltroStatus("todos");
    setOrdenarPor("nome");
  }

  const filtrados = useMemo(() => {
    let lista = usuarios ?? [];

    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      lista = lista.filter((u) => (u.nome_completo + " " + u.re).toLowerCase().includes(q));
    }
    if (filtroSetor !== "todos") {
      lista = lista.filter((u) => u.setor_id === filtroSetor);
    }
    if (filtroPerfil !== "todos") {
      lista = lista.filter((u) => u.role === filtroPerfil);
    }
    if (filtroStatus !== "todos") {
      lista = lista.filter((u) => (filtroStatus === "ativos" ? u.ativo : !u.ativo));
    }

    lista = [...lista].sort((a, b) => {
      if (ordenarPor === "re") return a.re.localeCompare(b.re);
      if (ordenarPor === "recentes") return b.created_at.localeCompare(a.created_at);
      return a.nome_completo.localeCompare(b.nome_completo);
    });

    return lista;
  }, [usuarios, busca, filtroSetor, filtroPerfil, filtroStatus, ordenarPor]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo="Usuários"
        descricao="Cadastre e gerencie os acessos ao sistema."
        acoes={
          <Button onClick={() => setAbrirNovo(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Novo usuário
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
                placeholder="Buscar por nome ou RE..."
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
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setor</Label>
                  <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os setores</SelectItem>
                      {(setores ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Perfil</Label>
                  <Select value={filtroPerfil} onValueChange={setFiltroPerfil}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os perfis</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="colaborador">Colaborador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                      <SelectItem value="re">RE</SelectItem>
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
            {busca || contagemFiltrosAtivos > 0 ? "Nenhum usuário encontrado com esses filtros." : "Nenhum usuário cadastrado ainda."}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-xl border bg-card scroll-elegante">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Usuário</TableHead>
                  <TableHead>RE</TableHead>
                  <TableHead className="hidden md:table-cell">Setor</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setUsuarioDetalhes(u)}
                        className="flex items-center gap-2.5 text-left hover:opacity-80"
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                            {iniciais(u.nome_completo)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{u.nome_completo}</span>
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{u.re}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {u.setor?.nome ?? "Sem setor"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {u.role === "admin" ? "Administrador" : "Colaborador"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.ativo ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                          Ativo
                        </Badge>
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
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setUsuarioDetalhes(u)}>
                            <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setUsuarioEditando(u)}>
                            <Pencil className="h-4 w-4 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setUsuarioSenha(u)}>
                            <KeyRound className="h-4 w-4 mr-2" /> Redefinir senha
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {u.ativo ? (
                            <DropdownMenuItem onClick={() => setUsuarioDesativando(u)} className="text-destructive focus:text-destructive">
                              <Ban className="h-4 w-4 mr-2" /> Desativar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => mutAlt.mutate({ user_id: u.id, ativo: true })}>
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Ativar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DialogoNovoUsuario aberto={abrirNovo} onFechar={() => setAbrirNovo(false)} setores={setores ?? []} />

      {usuarioEditando && (
        <DialogoEditarUsuario
          usuario={usuarioEditando}
          setores={setores ?? []}
          onFechar={() => setUsuarioEditando(null)}
        />
      )}

      {usuarioSenha && (
        <DialogoRedefinirSenha usuario={usuarioSenha} onFechar={() => setUsuarioSenha(null)} />
      )}

      <SheetDetalhesUsuario
        usuario={usuarioDetalhes}
        onFechar={() => setUsuarioDetalhes(null)}
        onEditar={(u) => { setUsuarioDetalhes(null); setUsuarioEditando(u); }}
        onRedefinirSenha={(u) => { setUsuarioDetalhes(null); setUsuarioSenha(u); }}
      />

      <AlertDialog open={!!usuarioDesativando} onOpenChange={(o) => !o && setUsuarioDesativando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {usuarioDesativando?.nome_completo}?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso ao sistema é bloqueado imediatamente. O histórico e a trilha de auditoria deste
              usuário continuam preservados — é possível reativar a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={mutAlt.isPending}
              onClick={() => usuarioDesativando && mutAlt.mutate({ user_id: usuarioDesativando.id, ativo: false })}
            >
              {mutAlt.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DialogoNovoUsuario({
  aberto, onFechar, setores,
}: { aberto: boolean; onFechar: () => void; setores: Setor[] }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [re, setRe] = useState("");
  const [senha, setSenha] = useState("");
  const [setorId, setSetorId] = useState<string>("");
  const [role, setRole] = useState<"admin" | "colaborador">("colaborador");

  const criar = useServerFn(criarUsuario);
  const mut = useMutation({
    mutationFn: () => criar({ data: {
      nome_completo: nome.trim(),
      re: re.trim(),
      senha,
      setor_id: setorId || null,
      role,
    }}),
    onSuccess: () => {
      toast.success("Usuário criado.");
      qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      setNome(""); setRe(""); setSenha(""); setSetorId(""); setRole("colaborador");
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !re.trim() || senha.length < 6) { toast.error("Preencha todos os campos (senha mín. 6 caracteres)."); return; }
    mut.mutate();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>Cadastre um novo colaborador ou administrador.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-3">
          <div className="space-y-1.5"><Label>Nome completo</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>RE</Label><Input value={re} onChange={(e) => setRe(e.target.value)} maxLength={30} placeholder="123456" /></div>
            <div className="space-y-1.5"><Label>Senha inicial</Label><Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} maxLength={72} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Setor</Label>
            <Select value={setorId} onValueChange={setSetorId}>
              <SelectTrigger><SelectValue placeholder="Selecionar setor..." /></SelectTrigger>
              <SelectContent>
                {setores.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Perfil</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "colaborador")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="colaborador">Colaborador</SelectItem>
                <SelectItem value="admin">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEditarUsuario({
  usuario, setores, onFechar,
}: { usuario: Perfil; setores: Setor[]; onFechar: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(usuario.nome_completo);
  const [re, setRe] = useState(usuario.re);
  const [setorId, setSetorId] = useState<string>(usuario.setor_id ?? "");
  const [role, setRole] = useState<"admin" | "colaborador">(usuario.role);

  const atualizar = useServerFn(atualizarUsuario);
  const mut = useMutation({
    mutationFn: () => atualizar({ data: {
      user_id: usuario.id,
      nome_completo: nome.trim(),
      re: re.trim(),
      setor_id: setorId || null,
      role,
    }}),
    onSuccess: () => {
      toast.success("Usuário atualizado.");
      qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !re.trim()) { toast.error("Preencha nome completo e RE."); return; }
    mut.mutate();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>Altera os dados cadastrais — não mexe na senha.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-3">
          <div className="space-y-1.5"><Label>Nome completo</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} /></div>
          <div className="space-y-1.5">
            <Label>RE</Label>
            <Input value={re} onChange={(e) => setRe(e.target.value)} maxLength={30} />
            <p className="text-xs text-muted-foreground">Alterar o RE também muda o login do usuário.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Setor</Label>
            <Select value={setorId} onValueChange={setSetorId}>
              <SelectTrigger><SelectValue placeholder="Selecionar setor..." /></SelectTrigger>
              <SelectContent>
                {setores.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Perfil</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "colaborador")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="colaborador">Colaborador</SelectItem>
                <SelectItem value="admin">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoRedefinirSenha({
  usuario, onFechar,
}: { usuario: Perfil; onFechar: () => void }) {
  const [novaSenha, setNovaSenha] = useState("");

  const redefinir = useServerFn(redefinirSenhaUsuario);
  const mut = useMutation({
    mutationFn: () => redefinir({ data: { user_id: usuario.id, nova_senha: novaSenha } }),
    onSuccess: () => {
      toast.success(`Senha redefinida para ${usuario.nome_completo}. Ele(a) vai precisar trocar no próximo login.`);
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function copiar() {
    if (!novaSenha) return;
    navigator.clipboard.writeText(novaSenha);
    toast.success("Senha copiada.");
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (novaSenha.length < 6) { toast.error("A senha precisa ter pelo menos 6 caracteres."); return; }
    mut.mutate();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            Defina uma senha temporária para <strong>{usuario.nome_completo}</strong> (RE {usuario.re}).
            No próximo login, ele(a) será obrigado(a) a criar uma senha nova e definitiva.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Senha temporária</Label>
            <div className="flex gap-2">
              <Input
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                maxLength={72}
                placeholder="Mínimo 6 caracteres"
              />
              <Button type="button" variant="outline" size="icon" title="Gerar senha aleatória" onClick={() => setNovaSenha(gerarSenhaAleatoria())}>
                <Shuffle className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" title="Copiar" onClick={copiar} disabled={!novaSenha}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anote ou copie antes de confirmar — repasse essa senha ao colaborador por um canal seguro.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Redefinir senha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SheetDetalhesUsuario({
  usuario, onFechar, onEditar, onRedefinirSenha,
}: {
  usuario: Perfil | null;
  onFechar: () => void;
  onEditar: (u: Perfil) => void;
  onRedefinirSenha: (u: Perfil) => void;
}) {
  return (
    <Sheet open={!!usuario} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full sm:max-w-md">
        {usuario && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-base font-medium text-primary">
                    {iniciais(usuario.nome_completo)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <SheetTitle>{usuario.nome_completo}</SheetTitle>
                  <SheetDescription>RE {usuario.re}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Perfil</div>
                  <div className="mt-1">
                    <Badge variant={usuario.role === "admin" ? "default" : "secondary"}>
                      {usuario.role === "admin" ? "Administrador" : "Colaborador"}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
                  <div className="mt-1">
                    {usuario.ativo ? (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Desativado</Badge>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setor</div>
                <div className="mt-1 text-sm">{usuario.setor?.nome ?? "Sem setor vinculado"}</div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cadastrado em</div>
                <div className="mt-1 text-sm">{formatarData(usuario.created_at)}</div>
              </div>
            </div>

            <SheetFooter className="mt-8 flex-col gap-2 sm:flex-col">
              <Button variant="outline" className="w-full justify-start" onClick={() => onEditar(usuario)}>
                <Pencil className="h-4 w-4 mr-2" /> Editar dados
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => onRedefinirSenha(usuario)}>
                <KeyRound className="h-4 w-4 mr-2" /> Redefinir senha
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}