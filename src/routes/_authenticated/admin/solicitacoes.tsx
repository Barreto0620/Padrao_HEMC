import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import {
  aprovarSolicitacaoCadastro, aprovarSolicitacaoResetSenha, rejeitarSolicitacao,
} from "@/lib/solicitacoes.functions";
import {
  Loader2, UserPlus, KeyRound, Check, X, Shuffle, Copy, Inbox,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/solicitacoes")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Solicitações — Padrão HEMC" }, { name: "description", content: "Fila de pedidos de cadastro e reset de senha do Padrão HEMC." }],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/editor" });
  },
  component: PaginaSolicitacoes,
});

type Solicitacao = {
  id: string;
  tipo: "cadastro" | "reset_senha";
  status: "pendente" | "aprovada" | "rejeitada";
  nome_completo: string | null;
  re: string;
  created_at: string;
  setor: { nome: string } | null;
  usuario: { nome_completo: string; setor: { nome: string } | null } | null;
};

function gerarSenhaAleatoria(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += chars[arr[i] % chars.length];
  return s;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function PaginaSolicitacoes() {
  const qc = useQueryClient();
  const [solicitacaoAprovando, setSolicitacaoAprovando] = useState<Solicitacao | null>(null);
  const [solicitacaoRejeitando, setSolicitacaoRejeitando] = useState<Solicitacao | null>(null);

  const { data: solicitacoes, isLoading } = useQuery({
    queryKey: ["solicitacoes-pendentes"],
    queryFn: async (): Promise<Solicitacao[]> => {
      const { data, error } = await supabase
        .from("solicitacoes")
        .select(
          "id, tipo, status, nome_completo, re, created_at, setor:setores(nome), usuario:profiles!solicitacoes_usuario_id_fkey(nome_completo, setor:setores(nome))",
        )
        .eq("status", "pendente")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Solicitacao[];
    },
  });

  const rejeitar = useServerFn(rejeitarSolicitacao);
  const mutRejeitar = useMutation({
    mutationFn: (solicitacao_id: string) => rejeitar({ data: { solicitacao_id } }),
    onSuccess: () => {
      toast.success("Solicitação rejeitada.");
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes"] });
      setSolicitacaoRejeitando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo="Solicitações"
        descricao="Pedidos de cadastro e redefinição de senha aguardando revisão."
      />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:p-8">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !solicitacoes || solicitacoes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border bg-card text-center text-muted-foreground">
            <Inbox className="h-10 w-10 opacity-40" />
            <div>
              <p className="font-medium text-foreground">Nenhuma solicitação pendente</p>
              <p className="mt-1 text-sm">Pedidos de cadastro e reset de senha aparecem aqui.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-xl border bg-card scroll-elegante">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tipo</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>RE</TableHead>
                  <TableHead className="hidden md:table-cell">Setor</TableHead>
                  <TableHead className="hidden sm:table-cell">Pedido em</TableHead>
                  <TableHead className="w-52" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {solicitacoes.map((s) => {
                  const nome = s.tipo === "cadastro" ? s.nome_completo : s.usuario?.nome_completo;
                  const setorNome = s.tipo === "cadastro" ? s.setor?.nome : s.usuario?.setor?.nome;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.tipo === "cadastro" ? (
                          <Badge className="gap-1">
                            <UserPlus className="h-3 w-3" /> Cadastro
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
                            <KeyRound className="h-3 w-3" /> Reset de senha
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{nome ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{s.re}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {setorNome ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {formatarData(s.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSolicitacaoRejeitando(s)}>
                            <X className="h-4 w-4 mr-1" /> Rejeitar
                          </Button>
                          <Button size="sm" onClick={() => setSolicitacaoAprovando(s)}>
                            <Check className="h-4 w-4 mr-1" /> Aprovar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {solicitacaoAprovando && (
        <DialogoAprovar
          solicitacao={solicitacaoAprovando}
          onFechar={() => setSolicitacaoAprovando(null)}
        />
      )}

      <AlertDialog open={!!solicitacaoRejeitando} onOpenChange={(o) => !o && setSolicitacaoRejeitando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              {solicitacaoRejeitando?.tipo === "cadastro"
                ? `O pedido de cadastro de "${solicitacaoRejeitando?.nome_completo}" (RE ${solicitacaoRejeitando?.re}) não vai gerar acesso ao sistema. A pessoa pode solicitar de novo se precisar.`
                : `O pedido de redefinição de senha (RE ${solicitacaoRejeitando?.re}) não será atendido. A conta continua com a senha atual.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={mutRejeitar.isPending}
              onClick={() => solicitacaoRejeitando && mutRejeitar.mutate(solicitacaoRejeitando.id)}
            >
              {mutRejeitar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DialogoAprovar({
  solicitacao, onFechar,
}: { solicitacao: Solicitacao; onFechar: () => void }) {
  const qc = useQueryClient();
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<"admin" | "colaborador">("colaborador");

  const aprovarCadastro = useServerFn(aprovarSolicitacaoCadastro);
  const aprovarReset = useServerFn(aprovarSolicitacaoResetSenha);

  const mut = useMutation({
    mutationFn: () => {
      if (solicitacao.tipo === "cadastro") {
        return aprovarCadastro({ data: { solicitacao_id: solicitacao.id, senha_temporaria: senha, role } });
      }
      return aprovarReset({ data: { solicitacao_id: solicitacao.id, senha_temporaria: senha } });
    },
    onSuccess: () => {
      toast.success("Aprovado. A pessoa já pode entrar com essa senha temporária (e vai precisar trocar no primeiro acesso).");
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes"] });
      qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function copiar() {
    if (!senha) return;
    navigator.clipboard.writeText(senha);
    toast.success("Senha copiada.");
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) { toast.error("A senha precisa ter pelo menos 6 caracteres."); return; }
    mut.mutate();
  }

  const nome = solicitacao.tipo === "cadastro" ? solicitacao.nome_completo : solicitacao.usuario?.nome_completo;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {solicitacao.tipo === "cadastro" ? "Aprovar cadastro" : "Aprovar redefinição de senha"}
          </DialogTitle>
          <DialogDescription>
            {solicitacao.tipo === "cadastro" ? (
              <>Cria o acesso de <strong>{nome}</strong> (RE {solicitacao.re}) com uma senha temporária.</>
            ) : (
              <>Define uma senha temporária para <strong>{nome}</strong> (RE {solicitacao.re}).</>
            )}
            {" "}A pessoa é obrigada a trocar essa senha no primeiro login.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Senha temporária</Label>
            <div className="flex gap-2">
              <Input value={senha} onChange={(e) => setSenha(e.target.value)} maxLength={72} placeholder="Mínimo 6 caracteres" />
              <Button type="button" variant="outline" size="icon" title="Gerar senha aleatória" onClick={() => setSenha(gerarSenhaAleatoria())}>
                <Shuffle className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" title="Copiar" onClick={copiar} disabled={!senha}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anote ou copie antes de confirmar — repasse por um canal seguro.
            </p>
          </div>
          {solicitacao.tipo === "cadastro" && (
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
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Aprovar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}