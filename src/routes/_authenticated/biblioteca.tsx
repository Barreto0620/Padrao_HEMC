import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfile } from "@/hooks/use-profile";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { registrarAuditoria } from "@/lib/audit";
import {
  Copy,
  Pencil,
  Plus,
  Search,
  Trash2,
  Star,
  Loader2,
  Upload,
  Download,
  SlidersHorizontal,
  X,
  LayoutGrid,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConteudoEtiqueta, ElementoEtiqueta } from "@/lib/label-types";
import QRCode from "qrcode";

export const Route = createFileRoute("/_authenticated/biblioteca")({
  head: () => ({
    meta: [
      { title: "Biblioteca de Etiquetas — Padrão HEMC" },
      { name: "description", content: "Modelos de etiquetas salvos no Padrão HEMC." },
    ],
  }),
  component: Biblioteca,
});

type Template = {
  id: string;
  nome: string;
  largura_mm: number;
  altura_mm: number;
  oficial: boolean;
  setor_id: string | null;
  criado_por: string | null;
  modo: string;
  updated_at: string;
  conteudo: unknown;
  setor: { nome: string; sigla: string } | null;
};

type Setor = { id: string; nome: string; sigla: string };

type Ordenacao = "recentes" | "antigos" | "nome_az" | "nome_za";
type FiltroOrigem = "todos" | "oficiais" | "meus";

// Formato do arquivo exportado/importado — mantém só os campos que fazem
// sentido replicar num modelo novo (nunca o id, criado_por, setor original
// etc. de quem exportou).
type ArquivoModeloExportado = {
  tipo: "modelo_etiqueta_hemc";
  versao: 1;
  nome: string;
  largura_mm: number;
  altura_mm: number;
  modo: string;
  conteudo: ConteudoEtiqueta;
};

function Biblioteca() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [excluir, setExcluir] = useState<Template | null>(null);
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>("todos");
  const [filtroSetor, setFiltroSetor] = useState<string>("todos");
  const [filtroModo, setFiltroModo] = useState<string>("todos");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("recentes");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const inputImportarRef = useRef<HTMLInputElement>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await supabase
        .from("templates_etiqueta")
        .select(
          "id, nome, largura_mm, altura_mm, oficial, setor_id, criado_por, modo, updated_at, conteudo, setor:setores(nome, sigla)",
        )
        .eq("ativo", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const { data: setores } = useQuery({
    queryKey: ["setores-lista"],
    queryFn: async (): Promise<Setor[]> => {
      const { data, error } = await supabase.from("setores").select("id, nome, sigla").order("nome");
      if (error) throw error;
      return (data ?? []) as Setor[];
    },
  });

  const mutExcluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("templates_etiqueta").update({ ativo: false }).eq("id", id);
      if (error) throw error;
      await registrarAuditoria({ acao: "template_excluido", entidade_tipo: "template_etiqueta", entidade_id: id });
    },
    onSuccess: () => {
      toast.success("Modelo removido.");
      qc.invalidateQueries({ queryKey: ["templates"] });
      setExcluir(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutDuplicar = useMutation({
    mutationFn: async (t: Template) => {
      const { data: orig, error: e1 } = await supabase
        .from("templates_etiqueta")
        .select("*")
        .eq("id", t.id)
        .maybeSingle();
      if (e1 || !orig) throw e1 ?? new Error("Modelo não encontrado");
      const { data: novo, error: e2 } = await supabase
        .from("templates_etiqueta")
        .insert({
          nome: `${orig.nome} (cópia)`,
          setor_id: profile?.setor_id ?? null,
          largura_mm: orig.largura_mm,
          altura_mm: orig.altura_mm,
          modo: orig.modo,
          conteudo: orig.conteudo,
          oficial: false,
          criado_por: profile?.id,
        })
        .select("id")
        .single();
      if (e2) throw e2;
      return novo.id as string;
    },
    onSuccess: () => {
      toast.success("Modelo duplicado.");
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Importa um modelo de um arquivo .json salvo no computador. Cria sempre
  // como um modelo novo (nunca sobrescreve nada existente), vinculado ao
  // setor do usuário atual e nunca marcado como oficial de cara — quem
  // importa decide depois, no editor, se quer torná-lo oficial.
  const mutImportar = useMutation({
    mutationFn: async (arquivo: ArquivoModeloExportado) => {
      if (!profile) throw new Error("Perfil não carregado.");
      const { data, error } = await supabase
        .from("templates_etiqueta")
        .insert({
          nome: arquivo.nome,
          largura_mm: arquivo.largura_mm,
          altura_mm: arquivo.altura_mm,
          modo: arquivo.modo,
          conteudo: arquivo.conteudo as unknown as import("@/integrations/supabase/types").Json,
          oficial: false,
          setor_id: profile.setor_id,
          criado_por: profile.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      await registrarAuditoria({
        acao: "template_importado",
        entidade_tipo: "template_etiqueta",
        entidade_id: data.id,
        detalhes: { nome: arquivo.nome },
      });
      return data.id as string;
    },
    onSuccess: () => {
      toast.success("Modelo importado com sucesso.");
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao importar o modelo."),
  });

  function aoSelecionarArquivoImportar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error("Selecione um arquivo .json exportado de um modelo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bruto = JSON.parse(String(reader.result));
        const validado = validarArquivoModelo(bruto);
        if (!validado) {
          toast.error("Este arquivo não é um modelo de etiqueta válido.");
          return;
        }
        mutImportar.mutate(validado);
      } catch {
        toast.error("Não foi possível ler o arquivo selecionado.");
      }
    };
    reader.onerror = () => toast.error("Não foi possível ler o arquivo selecionado.");
    reader.readAsText(file);
  }

  function exportarModelo(t: Template) {
    const arquivo: ArquivoModeloExportado = {
      tipo: "modelo_etiqueta_hemc",
      versao: 1,
      nome: t.nome,
      largura_mm: t.largura_mm,
      altura_mm: t.altura_mm,
      modo: t.modo,
      conteudo: (t.conteudo as ConteudoEtiqueta) ?? { elementos: [] },
    };
    const blob = new Blob([JSON.stringify(arquivo, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const nomeArquivo = `${slugify(t.nome) || "modelo"}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filtrosAtivos =
    (filtroOrigem !== "todos" ? 1 : 0) + (filtroSetor !== "todos" ? 1 : 0) + (filtroModo !== "todos" ? 1 : 0);

  const filtrados = useMemo(() => {
    let lista = (templates ?? []).filter((t) => t.nome.toLowerCase().includes(busca.trim().toLowerCase()));

    if (filtroOrigem === "oficiais") lista = lista.filter((t) => t.oficial);
    else if (filtroOrigem === "meus") lista = lista.filter((t) => t.criado_por === profile?.id);

    if (filtroSetor !== "todos") lista = lista.filter((t) => t.setor_id === filtroSetor);
    if (filtroModo !== "todos") lista = lista.filter((t) => t.modo === filtroModo);

    const ordenada = [...lista];
    if (ordenacao === "recentes") {
      ordenada.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } else if (ordenacao === "antigos") {
      ordenada.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
    } else if (ordenacao === "nome_az") {
      ordenada.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    } else {
      ordenada.sort((a, b) => b.nome.localeCompare(a.nome, "pt-BR"));
    }
    return ordenada;
  }, [templates, busca, filtroOrigem, filtroSetor, filtroModo, ordenacao, profile?.id]);

  function limparFiltros() {
    setFiltroOrigem("todos");
    setFiltroSetor("todos");
    setFiltroModo("todos");
    setOrdenacao("recentes");
  }

  return (
    <div>
      <PageHeader
        titulo="Biblioteca de Etiquetas"
        descricao="Modelos de etiquetas salvos. Modelos oficiais são visíveis a todos os setores."
        acoes={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => inputImportarRef.current?.click()} disabled={mutImportar.isPending}>
              {mutImportar.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Importar modelo
            </Button>
            <input
              ref={inputImportarRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={aoSelecionarArquivoImportar}
            />
            <Button asChild>
              <Link to="/editor">
                <Plus className="h-4 w-4 mr-2" /> Novo modelo
              </Link>
            </Button>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-4">
        {/* Barra de ferramentas: busca + filtros, no mesmo padrão visual
            (rounded-xl, border, bg-background/40) usado no editor. */}
        <div className="rounded-xl border bg-background/40 p-3 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar modelos pelo nome..."
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
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filtros
              {filtrosAtivos > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1 rounded-full">
                  {filtrosAtivos}
                </Badge>
              )}
            </Button>
          </div>

          {filtrosAbertos && (
            <div className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Origem
                </span>
                <Select value={filtroOrigem} onValueChange={(v) => setFiltroOrigem(v as FiltroOrigem)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os modelos</SelectItem>
                    <SelectItem value="oficiais">Somente oficiais</SelectItem>
                    <SelectItem value="meus">Somente meus modelos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Setor
                </span>
                <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os setores</SelectItem>
                    {(setores ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sigla} — {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tipo de impressão
                </span>
                <Select value={filtroModo} onValueChange={setFiltroModo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os tipos</SelectItem>
                    <SelectItem value="zebra">Zebra</SelectItem>
                    <SelectItem value="folha">Folha</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Ordenar por
                </span>
                <div className="flex gap-2">
                  <Select value={ordenacao} onValueChange={(v) => setOrdenacao(v as Ordenacao)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recentes">Mais recentes</SelectItem>
                      <SelectItem value="antigos">Mais antigos</SelectItem>
                      <SelectItem value="nome_az">Nome (A-Z)</SelectItem>
                      <SelectItem value="nome_za">Nome (Z-A)</SelectItem>
                    </SelectContent>
                  </Select>
                  {filtrosAtivos > 0 && (
                    <Button variant="ghost" size="icon" onClick={limparFiltros} title="Limpar filtros" className="shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LayoutGrid className="h-3.5 w-3.5" />
          {isLoading ? "Carregando..." : `${filtrados.length} modelo${filtrados.length === 1 ? "" : "s"}`}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {busca || filtrosAtivos > 0
              ? "Nenhum modelo encontrado com esses critérios."
              : "Você ainda não salvou modelos. Crie um no editor ou importe um arquivo."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((t) => {
              const podeExcluir = profile?.role === "admin" || t.criado_por === profile?.id;
              return (
                <Card key={t.id} className="overflow-hidden">
                  <div className="bg-muted/40 border-b p-3 flex items-center justify-center" style={{ minHeight: 140 }}>
                    <MiniaturaEtiqueta
                      larguraMm={t.largura_mm}
                      alturaMm={t.altura_mm}
                      conteudo={t.conteudo}
                    />
                  </div>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{t.nome}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {t.largura_mm} × {t.altura_mm} mm · {t.modo === "zebra" ? "Zebra" : "Folha"}
                          {t.setor ? ` · ${t.setor.sigla}` : ""}
                        </div>
                      </div>
                      {t.oficial ? (
                        <Badge className="bg-warning text-warning-foreground shrink-0">
                          <Star className="h-3 w-3 mr-1" /> Oficial
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/editor" search={{ id: t.id }}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Abrir
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => mutDuplicar.mutate(t)}
                        disabled={mutDuplicar.isPending}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" /> Duplicar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => exportarModelo(t)} title="Baixar como arquivo .json">
                        <Download className="h-3.5 w-3.5 mr-1" /> Exportar
                      </Button>
                      {podeExcluir && (
                        <Button size="sm" variant="ghost" onClick={() => setExcluir(t)}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={!!excluir} onOpenChange={(o) => !o && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo &quot;{excluir?.nome}&quot; será removido. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluir && mutExcluir.mutate(excluir.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Valida (de forma defensiva) se o JSON escolhido pelo usuário tem o
// formato esperado de um modelo exportado. Nunca confia cegamente num
// arquivo vindo do computador do usuário antes de mandar pro banco.
function validarArquivoModelo(bruto: unknown): ArquivoModeloExportado | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;

  const nome = typeof o.nome === "string" ? o.nome.trim() : "";
  const largura_mm = Number(o.largura_mm);
  const altura_mm = Number(o.altura_mm);
  const modo = typeof o.modo === "string" ? o.modo : "zebra";
  const conteudo = o.conteudo as ConteudoEtiqueta | undefined;

  if (!nome) return null;
  if (!Number.isFinite(largura_mm) || largura_mm <= 0) return null;
  if (!Number.isFinite(altura_mm) || altura_mm <= 0) return null;
  if (!conteudo || !Array.isArray(conteudo.elementos)) return null;

  return {
    tipo: "modelo_etiqueta_hemc",
    versao: 1,
    nome,
    largura_mm,
    altura_mm,
    modo,
    conteudo,
  };
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============================================================================
// Miniatura fiel da etiqueta — renderizada a partir da mesma estrutura de
// dados usada no editor (ConteudoEtiqueta.elementos). Aparece direto no
// card, sem precisar clicar em nada.
// ============================================================================

const LARGURA_MAX_MINIATURA_PX = 220;
const ALTURA_MAX_MINIATURA_PX = 130;

function MiniaturaEtiqueta({
  larguraMm,
  alturaMm,
  conteudo,
}: {
  larguraMm: number;
  alturaMm: number;
  conteudo: unknown;
}) {
  const elementos = ((conteudo as ConteudoEtiqueta | null)?.elementos ?? []) as ElementoEtiqueta[];

  if (!larguraMm || !alturaMm) {
    return <div className="text-xs text-muted-foreground text-center px-4">Dimensões inválidas</div>;
  }

  const escalaPorLargura = LARGURA_MAX_MINIATURA_PX / larguraMm;
  const escalaPorAltura = ALTURA_MAX_MINIATURA_PX / alturaMm;
  const pxPorMm = Math.min(escalaPorLargura, escalaPorAltura);

  const w = larguraMm * pxPorMm;
  const h = alturaMm * pxPorMm;

  return (
    <div className="relative bg-white shadow-sm border shrink-0" style={{ width: w, height: h }}>
      {elementos.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground text-center px-2">
          Etiqueta em branco
        </div>
      ) : (
        elementos.map((el) => <ElementoMiniatura key={el.id} el={el} pxPorMm={pxPorMm} />)
      )}
    </div>
  );
}

function ElementoMiniatura({ el, pxPorMm }: { el: ElementoEtiqueta; pxPorMm: number }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: el.x * pxPorMm,
    top: el.y * pxPorMm,
    color: "#000",
  };

  if (el.tipo === "texto") {
    return (
      <div
        style={{
          ...style,
          fontSize: Math.max(el.tamanhoMm * pxPorMm * 0.9, 4),
          fontWeight: el.negrito ? 700 : 400,
          whiteSpace: "nowrap",
          lineHeight: 1,
          textAlign: el.alinhamento,
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        {el.texto || "\u00A0"}
      </div>
    );
  }

  if (el.tipo === "qrcode") {
    return (
      <div style={{ ...style, width: el.larguraMm * pxPorMm, height: el.larguraMm * pxPorMm }}>
        <QRMiniatura conteudo={el.conteudo} tamanho={el.larguraMm * pxPorMm} />
      </div>
    );
  }

  if (el.tipo === "retangulo") {
    return (
      <div
        style={{
          ...style,
          width: el.larguraMm * pxPorMm,
          height: el.alturaMm * pxPorMm,
          border: `${Math.max(1, el.espessuraMm * pxPorMm)}px solid #000`,
          background: el.preenchido ? "#000" : "transparent",
        }}
      />
    );
  }

  if (el.tipo === "imagem") {
    return (
      <img
        src={el.src}
        alt={el.nomeArquivo ?? "Imagem"}
        draggable={false}
        style={{ ...style, width: el.larguraMm * pxPorMm, height: el.alturaMm * pxPorMm, objectFit: "fill" }}
      />
    );
  }

  return (
    <div
      style={{
        ...style,
        width: el.larguraMm * pxPorMm,
        height: Math.max(1, el.espessuraMm * pxPorMm),
        background: "#000",
      }}
    />
  );
}

function QRMiniatura({ conteudo, tamanho }: { conteudo: string; tamanho: number }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    let cancelado = false;
    QRCode.toDataURL(conteudo || " ", { margin: 0, width: Math.max(64, tamanho) })
      .then((url) => {
        if (!cancelado) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelado) setDataUrl("");
      });
    return () => {
      cancelado = true;
    };
  }, [conteudo, tamanho]);

  if (!dataUrl) return <div className="w-full h-full bg-muted/60" />;
  return <img src={dataUrl} alt="QR" style={{ width: "100%", height: "100%" }} />;
}