import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProfile } from "@/hooks/use-profile";
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { registrarAuditoria } from "@/lib/audit";
import { gerarZPL } from "@/lib/zpl";
import {
  verificarAgenteImpressao,
  enviarZPLParaAgente,
  type StatusAgenteImpressao,
} from "@/lib/print-agent";
import {
  PRESETS_ZEBRA,
  LIMITE_IMAGEM_BYTES,
  type ConteudoEtiqueta,
  type ElementoEtiqueta,
  type ModoImpressao,
} from "@/lib/label-types";
import { LOGOS_INSTITUCIONAIS } from "@/lib/logos-institucionais";
import QRCode from "qrcode";
import {
  Loader2,
  Plus,
  Save,
  Printer,
  Trash2,
  Type,
  QrCode,
  Square,
  Minus,
  Image as ImageIcon,
  MousePointer2,
  Copy,
  Download,
  MonitorCog,
  ExternalLink,
  Ruler,
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  FileText,
  LayoutGrid,
  Cpu,
  Tag,
} from "lucide-react";

const buscarSchema = z.object({
  id: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/editor")({
  head: () => ({
    meta: [
      { title: "Editor de Etiquetas — Padrão HEMC" },
      { name: "description", content: "Editor visual de etiquetas do Padrão HEMC (Zebra e folha)." },
    ],
  }),
  validateSearch: (s) => buscarSchema.parse(s),
  component: Editor,
});

const BASE_PX_POR_MM = 4; // 4px = 1mm no canvas, em 100% de zoom
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_PASSO = 0.1;
const LIMIAR_GUIA_PX = 6; // distância em pixels de tela pra "grudar" no centro

function novoId() {
  return crypto.randomUUID();
}

// ============================================================================
// Rascunho local — guarda o trabalho em andamento no localStorage, pra não
// perder nada ao trocar de tela e voltar. Só se aplica a "Novo Modelo" (sem
// id na URL): editar um modelo já salvo sempre usa a versão do banco como
// fonte da verdade, nunca um rascunho local desatualizado.
// ============================================================================
const RASCUNHO_KEY = "hemc_editor_rascunho";

type RascunhoEtiqueta = {
  largura: number;
  altura: number;
  nomeModelo: string;
  oficial: boolean;
  elementos: ElementoEtiqueta[];
  salvoEm: string;
};

function lerRascunho(): RascunhoEtiqueta | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(RASCUNHO_KEY);
    if (!bruto) return null;
    return JSON.parse(bruto) as RascunhoEtiqueta;
  } catch {
    return null;
  }
}

function salvarRascunho(r: RascunhoEtiqueta) {
  try {
    window.localStorage.setItem(RASCUNHO_KEY, JSON.stringify(r));
  } catch {
    // localStorage indisponível (modo privado, por exemplo) — o rascunho
    // simplesmente não persiste, sem impacto no resto do editor.
  }
}

function limparRascunho() {
  try {
    window.localStorage.removeItem(RASCUNHO_KEY);
  } catch {
    // sem impacto funcional
  }
}

function Editor() {
  const { id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: profile } = useProfile();
  const qc = useQueryClient();

  const [largura, setLargura] = useState<number>(50);
  const [altura, setAltura] = useState<number>(30);
  const [nomeModelo, setNomeModelo] = useState<string>("");
  const [oficial, setOficial] = useState(false);
  const [elementos, setElementos] = useState<ElementoEtiqueta[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [imprimirAberto, setImprimirAberto] = useState(false);
  const [templateAtualId, setTemplateAtualId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);
  const restauracaoFeitaRef = useRef(false);

  // Carrega template existente
  const { data: templateExistente } = useQuery({
    queryKey: ["template", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("templates_etiqueta")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Modelos marcados como "oficial" — usados pelo botão "Padrão" na barra,
  // pra qualquer colaborador começar rápido a partir do layout já aprovado
  // pela instituição, sem precisar ir até a Biblioteca procurar.
  const { data: modelosOficiais, isFetching: carregandoOficiais } = useQuery({
    queryKey: ["templates-oficiais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("templates_etiqueta")
        .select("id, nome, largura_mm, altura_mm, conteudo")
        .eq("oficial", true)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (templateExistente) {
      setNomeModelo(templateExistente.nome);
      setLargura(Number(templateExistente.largura_mm));
      setAltura(Number(templateExistente.altura_mm));
      setOficial(templateExistente.oficial);
      const c = templateExistente.conteudo as ConteudoEtiqueta;
      setElementos(c?.elementos ?? []);
      setTemplateAtualId(templateExistente.id);
    }
  }, [templateExistente]);

  // Restaura o rascunho salvo localmente — só faz sentido em "Novo Modelo"
  // (sem id na URL). Editar um modelo já salvo sempre usa a versão do
  // banco como fonte da verdade, nunca um rascunho local desatualizado.
  // Roda uma única vez de verdade, mesmo com o efeito disparando duas vezes
  // em desenvolvimento (StrictMode) — sem o ref, o aviso "Continuando de
  // onde você parou" aparecia duplicado.
  useEffect(() => {
    if (restauracaoFeitaRef.current) return;
    restauracaoFeitaRef.current = true;

    if (id) {
      setRascunhoRestaurado(true);
      return;
    }
    const rascunho = lerRascunho();
    if (rascunho && (rascunho.elementos.length > 0 || rascunho.nomeModelo.trim())) {
      setLargura(rascunho.largura);
      setAltura(rascunho.altura);
      setNomeModelo(rascunho.nomeModelo);
      setOficial(rascunho.oficial);
      setElementos(rascunho.elementos);
      toast.info("Continuando de onde você parou.");
    }
    setRascunhoRestaurado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva o rascunho localmente, com debounce, sempre que algo relevante
  // muda — é o que permite trocar de tela e voltar sem perder o trabalho.
  useEffect(() => {
    if (id) return; // editando um modelo já salvo — não gera rascunho local
    if (!rascunhoRestaurado) return; // espera a restauração inicial terminar
    const timer = setTimeout(() => {
      if (elementos.length === 0 && !nomeModelo.trim()) {
        limparRascunho();
        return;
      }
      salvarRascunho({
        largura,
        altura,
        nomeModelo,
        oficial,
        elementos,
        salvoEm: new Date().toISOString(),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [id, rascunhoRestaurado, largura, altura, nomeModelo, oficial, elementos]);

  const selecionado = elementos.find((e) => e.id === selecionadoId) ?? null;

  const atualizar = useCallback((id: string, patch: Partial<ElementoEtiqueta>) => {
    setElementos((prev) =>
      prev.map((el) => (el.id === id ? ({ ...el, ...patch } as ElementoEtiqueta) : el)),
    );
  }, []);

  function adicionar(tipo: Exclude<ElementoEtiqueta["tipo"], "imagem">) {
    const base = { id: novoId(), x: 2, y: 2 };
    let el: ElementoEtiqueta;
    if (tipo === "texto")
      el = { ...base, tipo: "texto", texto: "Texto", tamanhoMm: 3, negrito: false, alinhamento: "left" };
    else if (tipo === "qrcode")
      el = { ...base, tipo: "qrcode", conteudo: "HEMC", larguraMm: 15 };
    else if (tipo === "retangulo")
      el = { ...base, tipo: "retangulo", larguraMm: 20, alturaMm: 10, espessuraMm: 0.3, preenchido: false };
    else el = { ...base, tipo: "linha", larguraMm: 20, espessuraMm: 0.3 };
    setElementos((prev) => [...prev, el]);
    setSelecionadoId(el.id);
  }

  // Upload de imagem: precisa carregar o arquivo antes de saber a proporção
  // real (largura/altura), por isso não usa o mesmo fluxo síncrono de
  // `adicionar`. O tamanho inicial em mm é calculado a partir das dimensões
  // reais da imagem, limitado ao espaço disponível na etiqueta.
  function adicionarImagem(src: string, nomeArquivo: string) {
    const img = new Image();
    img.onload = () => {
      const proporcao = img.naturalWidth / img.naturalHeight || 1;
      const larguraMm = Math.max(2, Math.min(largura - 4, 20));
      const alturaMm = Math.max(2, Math.round((larguraMm / proporcao) * 10) / 10);
      const el: ElementoEtiqueta = {
        id: novoId(),
        x: 2,
        y: 2,
        tipo: "imagem",
        src,
        larguraMm,
        alturaMm,
        nomeArquivo,
        proporcaoOriginal: proporcao,
      };
      setElementos((prev) => [...prev, el]);
      setSelecionadoId(el.id);
    };
    img.onerror = () => toast.error("Não foi possível carregar a imagem selecionada.");
    img.src = src;
  }

  // Carrega o conteúdo de um modelo oficial no editor atual. Não mexe em
  // qual registro será salvo (templateAtualId) — só traz o layout como
  // ponto de partida. Se já existir algo desenhado, confirma antes, pra
  // nunca apagar trabalho sem querer.
  function carregarModeloOficial(modelo: NonNullable<typeof modelosOficiais>[number]) {
    const aplicar = () => {
      setLargura(Number(modelo.largura_mm));
      setAltura(Number(modelo.altura_mm));
      const c = modelo.conteudo as ConteudoEtiqueta;
      setElementos(c?.elementos ?? []);
      setSelecionadoId(null);
      toast.success(`Modelo "${modelo.nome}" carregado.`);
    };

    if (elementos.length > 0) {
      if (window.confirm(`Isso substitui o que já está no editor pelo modelo oficial "${modelo.nome}". Continuar?`)) {
        aplicar();
      }
      return;
    }
    aplicar();
  }

  function excluirSelecionado() {
    if (!selecionadoId) return;
    setElementos((prev) => prev.filter((e) => e.id !== selecionadoId));
    setSelecionadoId(null);
  }

  function moverSelecionadoTeclado(dx: number, dy: number) {
    if (!selecionado) return;
    const novoX = Math.max(0, Math.min(largura, Math.round((selecionado.x + dx) * 2) / 2));
    const novoY = Math.max(0, Math.min(altura, Math.round((selecionado.y + dy) * 2) / 2));
    atualizar(selecionado.id, { x: novoX, y: novoY });
  }

  // Atalhos de teclado: Delete/Backspace apaga o elemento selecionado, setas
  // movem (0.5mm por toque, 2mm segurando Shift — igual ao Canva). Nunca
  // dispara enquanto o foco está num campo de texto, senão sequestraria a
  // digitação normal (apagar letra, mover cursor).
  useEffect(() => {
    function aoApertarTecla(e: KeyboardEvent) {
      const ativo = document.activeElement;
      const editandoTexto =
        ativo instanceof HTMLElement &&
        (ativo.tagName === "INPUT" || ativo.tagName === "TEXTAREA" || ativo.isContentEditable);
      if (editandoTexto || !selecionadoId) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        excluirSelecionado();
        return;
      }

      const passo = e.shiftKey ? 2 : 0.5;
      if (e.key === "ArrowUp") { e.preventDefault(); moverSelecionadoTeclado(0, -passo); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moverSelecionadoTeclado(0, passo); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); moverSelecionadoTeclado(-passo, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moverSelecionadoTeclado(passo, 0); }
    }
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [selecionadoId, selecionado, largura, altura]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!nomeModelo.trim()) throw new Error("Informe um nome para o modelo.");
      if (!profile) throw new Error("Perfil não carregado.");
      const conteudo: ConteudoEtiqueta = { elementos };
      const payload = {
        nome: nomeModelo.trim(),
        largura_mm: largura,
        altura_mm: altura,
        // A coluna "modo" ainda existe no banco, mas deixou de ser uma
        // escolha feita no editor — a impressora é escolhida no momento da
        // impressão (diálogo "Imprimir"), não na hora de montar a etiqueta.
        // Valor fixo aqui só por compatibilidade com o schema existente.
        modo: "zebra" as ModoImpressao,
        conteudo: conteudo as unknown as import("@/integrations/supabase/types").Json,
        oficial: profile.role === "admin" ? oficial : false,
        setor_id: profile.setor_id,
      };
      if (templateAtualId) {
        const { error } = await supabase
          .from("templates_etiqueta")
          .update(payload)
          .eq("id", templateAtualId);
        if (error) throw error;
        await registrarAuditoria({
          acao: "template_editado",
          entidade_tipo: "template_etiqueta",
          entidade_id: templateAtualId,
          detalhes: { nome: payload.nome },
        });
        return templateAtualId;
      } else {
        const { data, error } = await supabase
          .from("templates_etiqueta")
          .insert({ ...payload, criado_por: profile.id })
          .select("id")
          .single();
        if (error) throw error;
        await registrarAuditoria({
          acao: "template_criado",
          entidade_tipo: "template_etiqueta",
          entidade_id: data.id,
          detalhes: { nome: payload.nome },
        });
        setTemplateAtualId(data.id);
        navigate({ to: "/editor", search: { id: data.id } });
        return data.id as string;
      }
    },
    onSuccess: () => {
      toast.success("Modelo salvo.");
      limparRascunho();
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const painelPropriedades = (
    <PropriedadesElemento
      selecionado={selecionado}
      atualizar={atualizar}
      excluir={excluirSelecionado}
    />
  );

  const painelConfig = (
    <ConfiguracaoEtiqueta
      largura={largura}
      setLargura={setLargura}
      altura={altura}
      setAltura={setAltura}
      nomeModelo={nomeModelo}
      setNomeModelo={setNomeModelo}
      oficial={oficial}
      setOficial={setOficial}
      podeSerOficial={profile?.role === "admin"}
    />
  );

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo={templateAtualId ? "Editar Modelo" : "Novo Modelo"}
        descricao="Monte a etiqueta arrastando elementos no canvas."
        acoes={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={carregandoOficiais}>
                  {carregandoOficiais ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  Padrão
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Modelos oficiais</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!modelosOficiais || modelosOficiais.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    Nenhum modelo oficial cadastrado ainda.
                  </div>
                ) : (
                  modelosOficiais.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => carregarModeloOficial(m)}>
                      <FileText className="h-4 w-4 mr-2 shrink-0" />
                      <span className="truncate">{m.nome}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {Number(m.largura_mm)}×{Number(m.altura_mm)}mm
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
            <Button onClick={() => setImprimirAberto(true)} disabled={elementos.length === 0}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
          </>
        }
      />

      <Ribbon
        config={{
          largura, setLargura, altura, setAltura,
          nomeModelo, setNomeModelo, oficial, setOficial,
          podeSerOficial: profile?.role === "admin",
        }}
        onAdicionar={adicionar}
        onAdicionarImagem={adicionarImagem}
      />

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Canvas — ocupa toda a altura/largura restante, sem precisar rolar a página */}
        <div
          className="relative flex flex-1 items-start justify-center overflow-auto bg-muted/30 p-4 md:p-8"
          style={{
            backgroundImage: "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        >
          <Canvas
            largura={largura}
            altura={altura}
            elementos={elementos}
            selecionadoId={selecionadoId}
            onSelecionar={setSelecionadoId}
            onMover={(id, x, y) => atualizar(id, { x, y })}
            onRedimensionar={atualizar}
            zoom={zoom}
            onZoomChange={setZoom}
          />
          <ControleZoom zoom={zoom} onZoomChange={setZoom} />
        </div>

        {/* Painel propriedades — desktop, lateral direita */}
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l bg-card p-4 lg:block">
          {painelPropriedades}
        </aside>

        {/* Mobile: abas (o ribbon fica escondido em telas pequenas) */}
        <div className="border-t bg-card lg:hidden">
          <Tabs defaultValue="ferramentas">
            <TabsList className="w-full rounded-none">
              <TabsTrigger value="ferramentas" className="flex-1">Ferramentas</TabsTrigger>
              <TabsTrigger value="propriedades" className="flex-1">Propriedades</TabsTrigger>
              <TabsTrigger value="config" className="flex-1">Etiqueta</TabsTrigger>
            </TabsList>
            <TabsContent value="ferramentas" className="p-4">
              <Ferramentas onAdicionar={adicionar} onAdicionarImagem={adicionarImagem} />
            </TabsContent>
            <TabsContent value="propriedades" className="p-4">
              {painelPropriedades}
            </TabsContent>
            <TabsContent value="config" className="p-4">{painelConfig}</TabsContent>
          </Tabs>
        </div>
      </div>

      <DialogoImprimir
        aberto={imprimirAberto}
        onFechar={() => setImprimirAberto(false)}
        largura={largura}
        altura={altura}
        elementos={elementos}
        nomeModelo={nomeModelo || "etiqueta"}
        templateId={templateAtualId}
        ehAdmin={profile?.role === "admin"}
      />
    </div>
  );
}

// Cabeçalho de seção padrão: ícone num badge + rótulo — usado em todos os
// painéis do editor pra dar uma identidade visual consistente e mais
// "técnica" ao invés de só texto maiúsculo solto.
function CabecalhoSecao({ icone, texto }: { icone: ReactNode; texto: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        {icone}
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {texto}
      </span>
    </div>
  );
}

function TileElemento({
  icone,
  label,
  onClick,
  className,
}: {
  icone: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left text-sm font-medium transition-all hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98] ${className ?? ""}`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
        {icone}
      </span>
      {label}
    </button>
  );
}

// ============================================================================
// Ribbon (barra de ferramentas horizontal, estilo Office) — substitui a
// coluna lateral esquerda no desktop. Resolve dois problemas de uma vez:
// texto sendo cortado numa coluna estreita, e o canvas ficando menor do que
// a tela por causa da coluna ocupar espaço permanente.
// ============================================================================

function RibbonBotao({
  icone,
  label,
  onClick,
  ativo,
}: {
  icone: ReactNode;
  label: string;
  onClick?: () => void;
  ativo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-[68px] flex-col items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        ativo
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      <span className={ativo ? "text-primary" : "text-foreground"}>{icone}</span>
      {label}
    </button>
  );
}

function RibbonSeparador() {
  return <div className="mx-1 my-1.5 w-px shrink-0 bg-border" />;
}

// Só largura/altura + o checkbox de "oficial" — nome do modelo e o preset
// de tamanho agora vivem no botão próprio, ao lado de Logos (ver
// RibbonNomeModelo), separado por assunto: aqui é só dimensão física.
function RibbonEtiqueta(props: PropsEtiqueta) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-[92px] flex-col items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Ruler className="h-4 w-4 text-primary" />
          <span className="font-mono">{props.largura}×{props.altura}mm</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Largura (mm)</Label>
              <Input type="number" min={5} max={300} value={props.largura} onChange={(e) => props.setLargura(Number(e.target.value) || 0)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Altura (mm)</Label>
              <Input type="number" min={5} max={300} value={props.altura} onChange={(e) => props.setAltura(Number(e.target.value) || 0)} className="font-mono" />
            </div>
          </div>
          {props.podeSerOficial && (
            <label className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm cursor-pointer transition-colors hover:border-primary/60 hover:bg-primary/5">
              <Checkbox checked={props.oficial} onCheckedChange={(v) => props.setOficial(!!v)} />
              <span className="text-xs leading-relaxed text-muted-foreground">
                Marcar como <span className="font-medium text-foreground">modelo oficial</span> (visível a todos os setores)
              </span>
            </label>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Nome do modelo + preset de tamanho — separado da dimensão física de
// propósito (pedido do usuário): fica mais claro visualmente distinguir
// "como o modelo se chama" de "que tamanho ele tem".
function RibbonNomeModelo(props: PropsEtiqueta) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-[100px] max-w-[140px] flex-col items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Tag className="h-4 w-4 text-primary" />
          <span className="max-w-full truncate">{props.nomeModelo.trim() || "Nome do modelo"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do modelo</Label>
            <Input value={props.nomeModelo} onChange={(e) => props.setNomeModelo(e.target.value)} placeholder="Ex.: Identificação de leito" maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label>Tamanho pré-definido</Label>
            <Select
              onValueChange={(v) => {
                const p = PRESETS_ZEBRA[parseInt(v, 10)];
                if (p) { props.setLargura(p.largura); props.setAltura(p.altura); }
              }}
            >
              <SelectTrigger><SelectValue placeholder="Selecionar preset..." /></SelectTrigger>
              <SelectContent>
                {PRESETS_ZEBRA.map((p, i) => (
                  <SelectItem key={i} value={String(i)}>{p.rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RibbonLogos({ onAdicionarImagem }: { onAdicionarImagem: (src: string, nomeArquivo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <span>
          <RibbonBotao icone={<Cpu className="h-4 w-4" />} label="Logos" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <CabecalhoSecao icone={<Cpu className="h-3.5 w-3.5" />} texto="Logos institucionais" />
        <div className="grid grid-cols-3 gap-2">
          {LOGOS_INSTITUCIONAIS.map((logo) => (
            <button
              key={logo.id}
              type="button"
              onClick={() => { onAdicionarImagem(logo.src, logo.nome); setAberto(false); }}
              title={`Adicionar logo ${logo.nome}`}
              className="group flex flex-col items-center gap-1 rounded-lg border bg-background p-2 transition-all hover:border-primary/60 hover:bg-primary/5"
            >
              <LogoMiniatura src={logo.src} nome={logo.nome} />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {logo.nome}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Ribbon({
  config,
  onAdicionar,
  onAdicionarImagem,
}: {
  config: PropsEtiqueta;
  onAdicionar: (t: Exclude<ElementoEtiqueta["tipo"], "imagem">) => void;
  onAdicionarImagem: (src: string, nomeArquivo: string) => void;
}) {
  const inputImagemRef = useRef<HTMLInputElement>(null);

  function handleArquivoImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem válido.");
      return;
    }
    if (file.size > LIMITE_IMAGEM_BYTES) {
      toast.error("Imagem muito grande (máx. 2 MB). Reduza o tamanho e tente novamente.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onAdicionarImagem(reader.result, file.name);
    };
    reader.onerror = () => toast.error("Não foi possível ler o arquivo selecionado.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="hidden shrink-0 items-stretch overflow-x-auto border-b bg-card px-3 py-1.5 lg:flex">
      <RibbonEtiqueta {...config} />
      <RibbonSeparador />
      <RibbonBotao icone={<Type className="h-4 w-4" />} label="Texto" onClick={() => onAdicionar("texto")} />
      <RibbonBotao icone={<QrCode className="h-4 w-4" />} label="QR Code" onClick={() => onAdicionar("qrcode")} />
      <RibbonBotao icone={<Square className="h-4 w-4" />} label="Retângulo" onClick={() => onAdicionar("retangulo")} />
      <RibbonBotao icone={<Minus className="h-4 w-4" />} label="Linha" onClick={() => onAdicionar("linha")} />
      <RibbonBotao icone={<ImageIcon className="h-4 w-4" />} label="Imagem" onClick={() => inputImagemRef.current?.click()} />
      <input ref={inputImagemRef} type="file" accept="image/*" className="hidden" onChange={handleArquivoImagem} />
      <RibbonSeparador />
      <RibbonLogos onAdicionarImagem={onAdicionarImagem} />
      <RibbonSeparador />
      <RibbonNomeModelo {...config} />
    </div>
  );
}

function Ferramentas({
  onAdicionar,
  onAdicionarImagem,
}: {
  onAdicionar: (t: Exclude<ElementoEtiqueta["tipo"], "imagem">) => void;
  onAdicionarImagem: (src: string, nomeArquivo: string) => void;
}) {
  const inputImagemRef = useRef<HTMLInputElement>(null);

  function handleArquivoImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem válido.");
      return;
    }
    if (file.size > LIMITE_IMAGEM_BYTES) {
      toast.error("Imagem muito grande (máx. 2 MB). Reduza o tamanho e tente novamente.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onAdicionarImagem(reader.result, file.name);
      }
    };
    reader.onerror = () => toast.error("Não foi possível ler o arquivo selecionado.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-background/40 p-3">
        <CabecalhoSecao icone={<LayoutGrid className="h-3.5 w-3.5" />} texto="Adicionar elemento" />
        <div className="grid grid-cols-2 gap-2">
          <TileElemento icone={<Type className="h-4 w-4" />} label="Texto" onClick={() => onAdicionar("texto")} />
          <TileElemento icone={<QrCode className="h-4 w-4" />} label="QR Code" onClick={() => onAdicionar("qrcode")} />
          <TileElemento icone={<Square className="h-4 w-4" />} label="Retângulo" onClick={() => onAdicionar("retangulo")} />
          <TileElemento icone={<Minus className="h-4 w-4" />} label="Linha" onClick={() => onAdicionar("linha")} />
          <TileElemento
            icone={<ImageIcon className="h-4 w-4" />}
            label="Imagem"
            onClick={() => inputImagemRef.current?.click()}
            className="col-span-2"
          />
          <input
            ref={inputImagemRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleArquivoImagem}
          />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          PNG ou JPG, até 2 MB. Se impressa na Zebra, a imagem sai em preto e branco.
        </p>
      </div>

      <div className="rounded-xl border bg-background/40 p-3">
        <CabecalhoSecao icone={<Cpu className="h-3.5 w-3.5" />} texto="Logos institucionais" />
        <div className="grid grid-cols-3 gap-2">
          {LOGOS_INSTITUCIONAIS.map((logo) => (
            <button
              key={logo.id}
              type="button"
              onClick={() => onAdicionarImagem(logo.src, logo.nome)}
              title={`Adicionar logo ${logo.nome}`}
              className="group flex flex-col items-center gap-1 rounded-lg border bg-background p-2 transition-all hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98]"
            >
              <LogoMiniatura src={logo.src} nome={logo.nome} />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {logo.nome}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Miniatura com fallback: se o arquivo do logo ainda não foi colocado em
// public/logos/, mostra um ícone no lugar em vez do "quebrado" padrão do
// navegador — mantém a interface profissional mesmo com asset pendente.
function LogoMiniatura({ src, nome }: { src: string; nome: string }) {
  const [comErro, setComErro] = useState(false);

  if (comErro) {
    return (
      <div className="flex h-8 w-full items-center justify-center rounded bg-muted">
        <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={nome}
      className="h-8 w-full object-contain"
      onError={() => setComErro(true)}
    />
  );
}

type PropsEtiqueta = {
  largura: number;
  setLargura: (n: number) => void;
  altura: number;
  setAltura: (n: number) => void;
  nomeModelo: string;
  setNomeModelo: (s: string) => void;
  oficial: boolean;
  setOficial: (b: boolean) => void;
  podeSerOficial: boolean;
};

// Campos "crus", sem card ao redor — reaproveitados na aba de configuração
// do mobile (lá continua tudo junto, já que não tem o mesmo espaço de
// ribbon pra separar em dois botões como no desktop).
function CamposEtiqueta(props: PropsEtiqueta) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Nome do modelo</Label>
        <Input value={props.nomeModelo} onChange={(e) => props.setNomeModelo(e.target.value)} placeholder="Ex.: Identificação de leito" maxLength={100} />
      </div>
      <div className="space-y-1.5">
        <Label>Tamanho pré-definido</Label>
        <Select
          onValueChange={(v) => {
            const p = PRESETS_ZEBRA[parseInt(v, 10)];
            if (p) { props.setLargura(p.largura); props.setAltura(p.altura); }
          }}
        >
          <SelectTrigger><SelectValue placeholder="Selecionar preset..." /></SelectTrigger>
          <SelectContent>
            {PRESETS_ZEBRA.map((p, i) => (
              <SelectItem key={i} value={String(i)}>{p.rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Largura (mm)</Label>
          <Input type="number" min={5} max={300} value={props.largura} onChange={(e) => props.setLargura(Number(e.target.value) || 0)} className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label>Altura (mm)</Label>
          <Input type="number" min={5} max={300} value={props.altura} onChange={(e) => props.setAltura(Number(e.target.value) || 0)} className="font-mono" />
        </div>
      </div>
      {props.podeSerOficial && (
        <label className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm cursor-pointer transition-colors hover:border-primary/60 hover:bg-primary/5">
          <Checkbox checked={props.oficial} onCheckedChange={(v) => props.setOficial(!!v)} />
          <span className="text-xs leading-relaxed text-muted-foreground">
            Marcar como <span className="font-medium text-foreground">modelo oficial</span> (visível a todos os setores)
          </span>
        </label>
      )}
    </div>
  );
}

function ConfiguracaoEtiqueta(props: PropsEtiqueta) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <CabecalhoSecao icone={<Ruler className="h-3.5 w-3.5" />} texto="Etiqueta" />
      <CamposEtiqueta {...props} />
    </div>
  );
}

function PropriedadesElemento({
  selecionado,
  atualizar,
  excluir,
}: {
  selecionado: ElementoEtiqueta | null;
  atualizar: (id: string, patch: Partial<ElementoEtiqueta>) => void;
  excluir: () => void;
}) {
  if (!selecionado) {
    return (
      <div className="flex flex-col items-center gap-3 px-2 py-12 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-muted-foreground/25">
          <MousePointer2 className="h-6 w-6 text-muted-foreground/60" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Nada selecionado</p>
          <p className="mx-auto max-w-[200px] text-xs leading-relaxed text-muted-foreground">
            Clique em um elemento no canvas para editar posição, tamanho e conteúdo.
          </p>
        </div>
      </div>
    );
  }
  const s = selecionado;
  const iconePorTipo: Record<ElementoEtiqueta["tipo"], ReactNode> = {
    texto: <Type className="h-3.5 w-3.5" />,
    qrcode: <QrCode className="h-3.5 w-3.5" />,
    retangulo: <Square className="h-3.5 w-3.5" />,
    linha: <Minus className="h-3.5 w-3.5" />,
    imagem: <ImageIcon className="h-3.5 w-3.5" />,
  };
  const rotuloPorTipo: Record<ElementoEtiqueta["tipo"], string> = {
    texto: "Texto",
    qrcode: "QR Code",
    retangulo: "Retângulo",
    linha: "Linha",
    imagem: "Imagem",
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            {iconePorTipo[s.tipo]}
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {rotuloPorTipo[s.tipo]}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={excluir}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Excluir elemento"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">X (mm)</Label><Input type="number" step="0.5" value={s.x} onChange={(e) => atualizar(s.id, { x: Number(e.target.value) || 0 })} className="font-mono" /></div>
        <div><Label className="text-xs">Y (mm)</Label><Input type="number" step="0.5" value={s.y} onChange={(e) => atualizar(s.id, { y: Number(e.target.value) || 0 })} className="font-mono" /></div>
      </div>

      {s.tipo === "texto" && (
        <>
          <div><Label className="text-xs">Texto</Label>
            <Input value={s.texto} onChange={(e) => atualizar(s.id, { texto: e.target.value })} maxLength={200} />
          </div>
          <div>
            <Label className="text-xs">Tamanho (mm): {s.tamanhoMm.toFixed(1)}</Label>
            <Slider min={1.5} max={15} step={0.5} value={[s.tamanhoMm]} onValueChange={(v) => atualizar(s.id, { tamanhoMm: v[0] })} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={s.negrito} onCheckedChange={(v) => atualizar(s.id, { negrito: !!v })} /> Negrito
          </label>
          <p className="text-xs text-muted-foreground">Se impressa na Zebra, a fonte usada é a interna monocromática da impressora.</p>
        </>
      )}
      {s.tipo === "qrcode" && (
        <>
          <div><Label className="text-xs">Conteúdo</Label>
            <Input value={s.conteudo} onChange={(e) => atualizar(s.id, { conteudo: e.target.value })} maxLength={500} />
          </div>
          <div>
            <Label className="text-xs">Tamanho (mm): {s.larguraMm.toFixed(0)}</Label>
            <Slider min={8} max={60} step={1} value={[s.larguraMm]} onValueChange={(v) => atualizar(s.id, { larguraMm: v[0] })} />
          </div>
        </>
      )}
      {s.tipo === "retangulo" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Largura (mm)</Label><Input type="number" step="0.5" value={s.larguraMm} onChange={(e) => atualizar(s.id, { larguraMm: Number(e.target.value) || 0 })} /></div>
            <div><Label className="text-xs">Altura (mm)</Label><Input type="number" step="0.5" value={s.alturaMm} onChange={(e) => atualizar(s.id, { alturaMm: Number(e.target.value) || 0 })} /></div>
          </div>
          <div>
            <Label className="text-xs">Espessura (mm): {s.espessuraMm.toFixed(1)}</Label>
            <Slider min={0.1} max={3} step={0.1} value={[s.espessuraMm]} onValueChange={(v) => atualizar(s.id, { espessuraMm: v[0] })} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={s.preenchido} onCheckedChange={(v) => atualizar(s.id, { preenchido: !!v })} /> Preenchido
          </label>
        </>
      )}
      {s.tipo === "linha" && (
        <>
          <div><Label className="text-xs">Comprimento (mm)</Label><Input type="number" step="0.5" value={s.larguraMm} onChange={(e) => atualizar(s.id, { larguraMm: Number(e.target.value) || 0 })} /></div>
          <div>
            <Label className="text-xs">Espessura (mm): {s.espessuraMm.toFixed(1)}</Label>
            <Slider min={0.1} max={3} step={0.1} value={[s.espessuraMm]} onValueChange={(v) => atualizar(s.id, { espessuraMm: v[0] })} />
          </div>
        </>
      )}
      {s.tipo === "imagem" && (
        <>
          <div className="rounded-md border p-2 bg-muted/30 flex items-center justify-center">
            <img src={s.src} alt={s.nomeArquivo ?? "Imagem"} className="max-h-24 object-contain" />
          </div>
          {s.nomeArquivo && (
            <p className="text-xs text-muted-foreground truncate" title={s.nomeArquivo}>
              {s.nomeArquivo}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Largura (mm)</Label><Input type="number" step="0.5" min={2} value={s.larguraMm} onChange={(e) => atualizar(s.id, { larguraMm: Number(e.target.value) || 0 })} /></div>
            <div><Label className="text-xs">Altura (mm)</Label><Input type="number" step="0.5" min={2} value={s.alturaMm} onChange={(e) => atualizar(s.id, { alturaMm: Number(e.target.value) || 0 })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">
            Se impressa na Zebra, a imagem é convertida para preto e branco (bitmap monocromático).
          </p>
        </>
      )}
    </div>
  );
}

type ChaveAlca = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const TAMANHO_MIN_MM = 2;

// Descreve a "caixa" redimensionável de um elemento. Texto não entra aqui —
// seu tamanho é controlado pela fonte (painel de propriedades), não por
// arrasto no canvas.
function obterCaixaRedimensionavel(
  el: ElementoEtiqueta,
): { largura: number; altura: number; travarProporcao: boolean; proporcao: number } | null {
  if (el.tipo === "retangulo") {
    return { largura: el.larguraMm, altura: el.alturaMm, travarProporcao: false, proporcao: 1 };
  }
  if (el.tipo === "imagem") {
    const proporcao = el.proporcaoOriginal ?? (el.larguraMm / el.alturaMm || 1);
    return { largura: el.larguraMm, altura: el.alturaMm, travarProporcao: true, proporcao };
  }
  if (el.tipo === "qrcode") {
    // QR Code é sempre quadrado — trava de proporção 1:1.
    return { largura: el.larguraMm, altura: el.larguraMm, travarProporcao: true, proporcao: 1 };
  }
  return null;
}

// Calcula a nova posição/tamanho a partir do movimento do mouse (em mm),
// respeitando qual alça foi arrastada. Quando `travarProporcao` é true
// (imagem e QR Code), a dimensão "livre" sempre é recalculada a partir da
// dimensão "puxada" — é o que garante que puxar de um lado nunca deixe a
// imagem esticada/distorcida, preservando a qualidade original.
function calcularNovaCaixa(
  handle: ChaveAlca,
  inicio: { x: number; y: number; largura: number; altura: number },
  deltaMmX: number,
  deltaMmY: number,
  travarProporcao: boolean,
  proporcao: number,
) {
  const { x, y, largura, altura } = inicio;
  const temE = handle.includes("e");
  const temW = handle.includes("w");
  const temN = handle.includes("n");
  const temS = handle.includes("s");

  let novaLargura = largura;
  let novaAltura = altura;

  if (temE) novaLargura = Math.max(TAMANHO_MIN_MM, largura + deltaMmX);
  if (temW) novaLargura = Math.max(TAMANHO_MIN_MM, largura - deltaMmX);
  if (temS) novaAltura = Math.max(TAMANHO_MIN_MM, altura + deltaMmY);
  if (temN) novaAltura = Math.max(TAMANHO_MIN_MM, altura - deltaMmY);

  if (travarProporcao && proporcao > 0) {
    const mudouLargura = temE || temW;
    const mudouAltura = temN || temS;
    if (mudouLargura && mudouAltura) {
      // Alça de canto: usa a variação de maior magnitude como referência,
      // pra o redimensionamento responder de forma previsível ao arrasto.
      const varLargura = Math.abs(novaLargura - largura);
      const varAltura = Math.abs(novaAltura - altura);
      if (varLargura >= varAltura) novaAltura = novaLargura / proporcao;
      else novaLargura = novaAltura * proporcao;
    } else if (mudouLargura) {
      novaAltura = novaLargura / proporcao;
    } else if (mudouAltura) {
      novaLargura = novaAltura * proporcao;
    }
    novaLargura = Math.max(TAMANHO_MIN_MM, novaLargura);
    novaAltura = Math.max(TAMANHO_MIN_MM, novaAltura);
  }

  // Alças do lado esquerdo/superior deslocam x/y na mesma medida em que a
  // dimensão encolhe/cresce, pra manter o canto oposto fixo (comportamento
  // padrão de qualquer editor visual — Word, PowerPoint, Canva etc.).
  const novoX = temW ? x + (largura - novaLargura) : x;
  const novoY = temN ? y + (altura - novaAltura) : y;

  return { x: novoX, y: novoY, largura: novaLargura, altura: novaAltura };
}

function ControleZoom({
  zoom,
  onZoomChange,
}: {
  zoom: number;
  onZoomChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  function ajustar(delta: number) {
    onZoomChange((z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)) * 100) / 100);
  }

  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-0.5 rounded-full border bg-card/95 backdrop-blur px-1.5 py-1 shadow-md">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full"
        onClick={() => ajustar(-ZOOM_PASSO)}
        disabled={zoom <= ZOOM_MIN}
        title="Diminuir zoom"
        aria-label="Diminuir zoom"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <button
        type="button"
        onClick={() => onZoomChange(1)}
        className="min-w-[3.25rem] rounded-full px-2 py-1 text-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title="Voltar para 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full"
        onClick={() => ajustar(ZOOM_PASSO)}
        disabled={zoom >= ZOOM_MAX}
        title="Aumentar zoom"
        aria-label="Aumentar zoom"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Canvas({
  largura,
  altura,
  elementos,
  selecionadoId,
  onSelecionar,
  onMover,
  onRedimensionar,
  zoom,
  onZoomChange,
}: {
  largura: number;
  altura: number;
  elementos: ElementoEtiqueta[];
  selecionadoId: string | null;
  onSelecionar: (id: string | null) => void;
  onMover: (id: string, x: number, y: number) => void;
  onRedimensionar: (id: string, patch: Partial<ElementoEtiqueta>) => void;
  zoom: number;
  onZoomChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  const pxPorMm = BASE_PX_POR_MM * zoom;
  const ref = useRef<HTMLDivElement>(null);
  const arrastandoRef = useRef<{
    id: string;
    offX: number;
    offY: number;
    larguraMm: number;
    alturaMm: number;
  } | null>(null);
  const redimensionandoRef = useRef<{
    id: string;
    handle: ChaveAlca;
    tipoElemento: ElementoEtiqueta["tipo"];
    inicio: { x: number; y: number; largura: number; altura: number };
    mouseInicioMm: { x: number; y: number };
    travarProporcao: boolean;
    proporcao: number;
  } | null>(null);
  const [guias, setGuias] = useState<{ h: boolean; v: boolean }>({ h: false, v: false });

  function onMouseDown(e: React.MouseEvent, id: string, elX: number, elY: number) {
    e.stopPropagation();
    onSelecionar(id);
    const canvas = ref.current!.getBoundingClientRect();
    const mx = (e.clientX - canvas.left) / pxPorMm;
    const my = (e.clientY - canvas.top) / pxPorMm;
    // Mede o elemento de verdade na tela (funciona pra qualquer tipo,
    // inclusive texto, cujo tamanho real depende do conteúdo digitado) —
    // é o que permite calcular o centro dele pras guias de alinhamento.
    const rectEl = (e.currentTarget as HTMLElement).getBoundingClientRect();
    arrastandoRef.current = {
      id,
      offX: mx - elX,
      offY: my - elY,
      larguraMm: rectEl.width / pxPorMm,
      alturaMm: rectEl.height / pxPorMm,
    };
  }

  function onResizeMouseDown(e: React.MouseEvent, el: ElementoEtiqueta, handle: ChaveAlca) {
    e.stopPropagation();
    e.preventDefault();
    const caixa = obterCaixaRedimensionavel(el);
    if (!caixa || !ref.current) return;
    onSelecionar(el.id);
    const canvas = ref.current.getBoundingClientRect();
    const mx = (e.clientX - canvas.left) / pxPorMm;
    const my = (e.clientY - canvas.top) / pxPorMm;
    redimensionandoRef.current = {
      id: el.id,
      handle,
      tipoElemento: el.tipo,
      inicio: { x: el.x, y: el.y, largura: caixa.largura, altura: caixa.altura },
      mouseInicioMm: { x: mx, y: my },
      travarProporcao: caixa.travarProporcao,
      proporcao: caixa.proporcao,
    };
  }

  function onResizeLinhaMouseDown(e: React.MouseEvent, el: Extract<ElementoEtiqueta, { tipo: "linha" }>) {
    e.stopPropagation();
    e.preventDefault();
    if (!ref.current) return;
    onSelecionar(el.id);
    const canvas = ref.current.getBoundingClientRect();
    const mx = (e.clientX - canvas.left) / pxPorMm;
    redimensionandoRef.current = {
      id: el.id,
      handle: "e",
      tipoElemento: "linha",
      inicio: { x: el.x, y: el.y, largura: el.larguraMm, altura: 0 },
      mouseInicioMm: { x: mx, y: 0 },
      travarProporcao: false,
      proporcao: 1,
    };
  }

  useEffect(() => {
    const limiarMm = LIMIAR_GUIA_PX / pxPorMm;

    function move(e: MouseEvent) {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const mx = (e.clientX - r.left) / pxPorMm;
      const my = (e.clientY - r.top) / pxPorMm;

      const a = arrastandoRef.current;
      if (a) {
        let nx = Math.max(0, Math.min(largura, mx - a.offX));
        let ny = Math.max(0, Math.min(altura, my - a.offY));

        // Guias de centro, igual ao Canva: se o meio do elemento chegar
        // perto do meio da etiqueta (horizontal ou vertical), gruda exato
        // no centro e acende a linha-guia correspondente.
        const centroElX = nx + a.larguraMm / 2;
        const centroElY = ny + a.alturaMm / 2;
        const centroEtiqX = largura / 2;
        const centroEtiqY = altura / 2;
        const noCentroV = Math.abs(centroElX - centroEtiqX) <= limiarMm;
        const noCentroH = Math.abs(centroElY - centroEtiqY) <= limiarMm;

        if (noCentroV) nx = centroEtiqX - a.larguraMm / 2;
        if (noCentroH) ny = centroEtiqY - a.alturaMm / 2;
        setGuias({ h: noCentroH, v: noCentroV });

        onMover(a.id, Math.round(nx * 2) / 2, Math.round(ny * 2) / 2);
        return;
      }

      const rz = redimensionandoRef.current;
      if (rz) {
        const deltaX = mx - rz.mouseInicioMm.x;
        const deltaY = my - rz.mouseInicioMm.y;

        if (rz.tipoElemento === "linha") {
          const novaLargura = Math.max(TAMANHO_MIN_MM, Math.round((rz.inicio.largura + deltaX) * 2) / 2);
          onRedimensionar(rz.id, { larguraMm: novaLargura } as Partial<ElementoEtiqueta>);
          return;
        }

        const nova = calcularNovaCaixa(rz.handle, rz.inicio, deltaX, deltaY, rz.travarProporcao, rz.proporcao);
        const patch: Partial<ElementoEtiqueta> = {
          x: Math.round(nova.x * 2) / 2,
          y: Math.round(nova.y * 2) / 2,
          larguraMm: Math.round(nova.largura * 2) / 2,
        } as Partial<ElementoEtiqueta>;
        if (rz.tipoElemento !== "qrcode") {
          (patch as { alturaMm?: number }).alturaMm = Math.round(nova.altura * 2) / 2;
        }
        onRedimensionar(rz.id, patch);
      }
    }
    function up() {
      arrastandoRef.current = null;
      redimensionandoRef.current = null;
      setGuias({ h: false, v: false });
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [largura, altura, onMover, onRedimensionar, pxPorMm]);

  // Zoom com o scroll do mouse sobre a etiqueta. Usa addEventListener nativo
  // (não onWheel do React) porque o React registra wheel como "passive" por
  // padrão — preventDefault() não funcionaria pra impedir o scroll da
  // página por trás, e o gesto ficaria "vazando" pro resto da tela.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function aoRolar(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_PASSO : ZOOM_PASSO;
      onZoomChange((z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)) * 100) / 100);
    }
    el.addEventListener("wheel", aoRolar, { passive: false });
    return () => el.removeEventListener("wheel", aoRolar);
  }, [onZoomChange]);

  const w = largura * pxPorMm;
  const h = altura * pxPorMm;

  return (
    <div className="inline-block">
      <div className="mb-3 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 font-mono text-xs text-muted-foreground shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {largura} × {altura} mm
        </span>
      </div>
      <div
        ref={ref}
        className="relative bg-white shadow-lg"
        style={{
          width: w, height: h,
          backgroundImage:
            "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)",
          backgroundSize: `${pxPorMm}px ${pxPorMm}px`,
        }}
        onMouseDown={() => onSelecionar(null)}
      >
        {elementos.map((el) => (
          <ElementoRender
            key={el.id}
            el={el}
            selecionado={el.id === selecionadoId}
            pxPorMm={pxPorMm}
            onMouseDown={onMouseDown}
            onResizeMouseDown={onResizeMouseDown}
            onResizeLinhaMouseDown={onResizeLinhaMouseDown}
          />
        ))}

        {/* Guias de centro — estilo Canva: linha rosa fina, cor que nunca se
            confunde com o conteúdo real da etiqueta (sempre preto/branco). */}
        {guias.v && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px"
            style={{ left: w / 2, backgroundColor: "#ec4899" }}
          />
        )}
        {guias.h && (
          <div
            className="pointer-events-none absolute left-0 right-0 h-px"
            style={{ top: h / 2, backgroundColor: "#ec4899" }}
          />
        )}
      </div>
    </div>
  );
}

const CLASSE_ALCA = "absolute h-2.5 w-2.5 rounded-sm border border-primary bg-white shadow";

function AlcasRedimensionamento({
  onHandleMouseDown,
}: {
  onHandleMouseDown: (e: React.MouseEvent, handle: ChaveAlca) => void;
}) {
  return (
    <>
      <div className={`${CLASSE_ALCA} -top-1.5 -left-1.5 cursor-nwse-resize`} onMouseDown={(e) => onHandleMouseDown(e, "nw")} />
      <div className={`${CLASSE_ALCA} -top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`} onMouseDown={(e) => onHandleMouseDown(e, "n")} />
      <div className={`${CLASSE_ALCA} -top-1.5 -right-1.5 cursor-nesw-resize`} onMouseDown={(e) => onHandleMouseDown(e, "ne")} />
      <div className={`${CLASSE_ALCA} top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize`} onMouseDown={(e) => onHandleMouseDown(e, "e")} />
      <div className={`${CLASSE_ALCA} -bottom-1.5 -right-1.5 cursor-nwse-resize`} onMouseDown={(e) => onHandleMouseDown(e, "se")} />
      <div className={`${CLASSE_ALCA} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`} onMouseDown={(e) => onHandleMouseDown(e, "s")} />
      <div className={`${CLASSE_ALCA} -bottom-1.5 -left-1.5 cursor-nesw-resize`} onMouseDown={(e) => onHandleMouseDown(e, "sw")} />
      <div className={`${CLASSE_ALCA} top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize`} onMouseDown={(e) => onHandleMouseDown(e, "w")} />
    </>
  );
}

function AlcaLinha({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className={`${CLASSE_ALCA} top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize`}
      onMouseDown={onMouseDown}
    />
  );
}

function ElementoRender({
  el,
  selecionado,
  pxPorMm,
  onMouseDown,
  onResizeMouseDown,
  onResizeLinhaMouseDown,
}: {
  el: ElementoEtiqueta;
  selecionado: boolean;
  pxPorMm: number;
  onMouseDown: (e: React.MouseEvent, id: string, x: number, y: number) => void;
  onResizeMouseDown: (e: React.MouseEvent, el: ElementoEtiqueta, handle: ChaveAlca) => void;
  onResizeLinhaMouseDown: (e: React.MouseEvent, el: Extract<ElementoEtiqueta, { tipo: "linha" }>) => void;
}) {
  const outline = selecionado ? "outline outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-primary/40";
  const style: React.CSSProperties = {
    position: "absolute",
    left: el.x * pxPorMm,
    top: el.y * pxPorMm,
    cursor: "grab",
    color: "#000",
  };
  const commonProps = {
    onMouseDown: (e: React.MouseEvent) => onMouseDown(e, el.id, el.x, el.y),
    className: `${outline} select-none`,
    style,
  };

  if (el.tipo === "texto") {
    return (
      <div {...commonProps} style={{
        ...style,
        fontSize: el.tamanhoMm * pxPorMm * 0.9,
        fontWeight: el.negrito ? 700 : 400,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}>
        {el.texto || "\u00A0"}
      </div>
    );
  }
  if (el.tipo === "qrcode") {
    return (
      <div {...commonProps} style={{ ...style, width: el.larguraMm * pxPorMm, height: el.larguraMm * pxPorMm }}>
        <PreviewQR conteudo={el.conteudo} tamanho={el.larguraMm * pxPorMm} />
        {selecionado && <AlcasRedimensionamento onHandleMouseDown={(e, h) => onResizeMouseDown(e, el, h)} />}
      </div>
    );
  }
  if (el.tipo === "retangulo") {
    return (
      <div {...commonProps} style={{
        ...style,
        width: el.larguraMm * pxPorMm,
        height: el.alturaMm * pxPorMm,
        border: `${Math.max(1, el.espessuraMm * pxPorMm)}px solid #000`,
        background: el.preenchido ? "#000" : "transparent",
      }}>
        {selecionado && <AlcasRedimensionamento onHandleMouseDown={(e, h) => onResizeMouseDown(e, el, h)} />}
      </div>
    );
  }
  if (el.tipo === "imagem") {
    return (
      <div {...commonProps} style={{ ...style, width: el.larguraMm * pxPorMm, height: el.alturaMm * pxPorMm }}>
        <img
          src={el.src}
          alt={el.nomeArquivo ?? "Imagem"}
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }}
        />
        {selecionado && <AlcasRedimensionamento onHandleMouseDown={(e, h) => onResizeMouseDown(e, el, h)} />}
      </div>
    );
  }
  return (
    <div {...commonProps} style={{
      ...style,
      width: el.larguraMm * pxPorMm,
      height: Math.max(1, el.espessuraMm * pxPorMm),
      background: "#000",
    }}>
      {selecionado && <AlcaLinha onMouseDown={(e) => onResizeLinhaMouseDown(e, el)} />}
    </div>
  );
}

function PreviewQR({ conteudo, tamanho }: { conteudo: string; tamanho: number }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(conteudo || " ", { margin: 0, width: Math.max(64, tamanho) }).then(setDataUrl).catch(() => setDataUrl(""));
  }, [conteudo, tamanho]);
  return dataUrl ? <img src={dataUrl} alt="QR" style={{ width: "100%", height: "100%" }} /> : null;
}

function DialogoImprimir({
  aberto,
  onFechar,
  largura,
  altura,
  elementos,
  nomeModelo,
  templateId,
  ehAdmin,
}: {
  aberto: boolean;
  onFechar: () => void;
  largura: number;
  altura: number;
  elementos: ElementoEtiqueta[];
  nomeModelo: string;
  templateId: string | null;
  ehAdmin: boolean;
}) {
  const [copias, setCopias] = useState(1);
  const [status, setStatus] = useState<StatusAgenteImpressao>({ status: "verificando" });
  const [enviando, setEnviando] = useState(false);

  // Instalador do driver hospedado dentro do próprio sistema (public/drivers)
  // — baixa na hora, sem sair navegando pelo site da Zebra. O link externo
  // continua disponível como opção "sempre a versão mais recente", caso a
  // Zebra atualize o driver depois deste arquivo ter sido publicado aqui.
  const URL_DRIVER_LOCAL = "/drivers/zebra-zd230-driver.zip";
  const URL_DRIVER_ZEBRA_OFICIAL = "https://www.zebra.com/us/en/support-downloads/printers/desktop/ZD200t.html";

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setStatus({ status: "verificando" });
    verificarAgenteImpressao().then((s) => { if (!cancelado) setStatus(s); });
    return () => { cancelado = true; };
  }, [aberto]);

  function baixarDriver() {
    const a = document.createElement("a");
    a.href = URL_DRIVER_LOCAL;
    a.download = "zebra-zd230-driver.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Impressão silenciosa de verdade: manda o ZPL para o agente próprio
  // (agente-impressao/hemc-print-agent.ps1), que executa "copy /b ... LPT1"
  // na porta já mapeada via "net use". Só fica disponível quando o agente
  // está detectado rodando na máquina (status "conectado") — ver
  // src/lib/print-agent.ts para o porquê disso ser a única forma real de
  // eliminar a caixa de seleção de impressora (navegador não escreve em
  // porta local por segurança, seja qual browser for).
  async function imprimirAgora() {
    if (status.status !== "conectado") return;
    setEnviando(true);
    try {
      const zpl = await gerarZPL({ larguraMm: largura, alturaMm: altura, elementos, copias });
      await enviarZPLParaAgente(zpl);
      await registrarAuditoria({
        acao: "etiqueta_emitida",
        entidade_tipo: "template_etiqueta",
        entidade_id: templateId ?? undefined,
        detalhes: { copias, formato: "zpl_direto_lpt1", nome: nomeModelo },
      });
      toast.success("Etiqueta enviada para a impressora.");
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar para a impressora.");
    } finally {
      setEnviando(false);
    }
  }

  async function imprimirComDialogo() {
    // Abre a caixa de impressão nativa do navegador, ajustada exatamente ao
    // tamanho da etiqueta configurada — nunca no tamanho de uma folha A4,
    // que não faz sentido pra impressão de etiqueta. O Windows lista todas
    // as impressoras instaladas, incluindo a Zebra (driver ZDesigner).
    const w = window.open("", "_blank");
    if (!w) { toast.error("Bloqueado pelo navegador. Permita pop-ups."); return; }
    const qrData: Record<string, string> = {};
    for (const el of elementos) {
      if (el.tipo === "qrcode") {
        qrData[el.id] = await QRCode.toDataURL(el.conteudo || " ", { margin: 0, width: Math.max(128, el.larguraMm * 10) });
      }
    }
    const etiquetaHtml = renderEtiquetaImpressao(elementos, qrData);
    const copiasArr = Array.from({ length: copias }, () => etiquetaHtml).join("");
    const estiloPagina = `@page { size: ${largura}mm ${altura}mm; margin: 0; }
      body { margin: 0; font-family: Arial, sans-serif; color: #000; }
      .etiq { width: ${largura}mm; height: ${altura}mm; position: relative; page-break-after: always; overflow: hidden; }`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${nomeModelo}</title>
      <style>${estiloPagina}</style></head><body>${copiasArr}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
    await registrarAuditoria({
      acao: "etiqueta_emitida",
      entidade_tipo: "template_etiqueta",
      entidade_id: templateId ?? undefined,
      detalhes: { copias, formato: "driver_windows", nome: nomeModelo },
    });
    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Imprimir etiqueta</DialogTitle>
          <DialogDescription>
            Escolha a impressora na hora de imprimir — a etiqueta não fica presa a um tipo específico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <StatusImpressoraCard
            status={status}
            onTestarNovamente={() => {
              setStatus({ status: "verificando" });
              verificarAgenteImpressao().then(setStatus);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dlg-copias">Cópias</Label>
              <Input
                id="dlg-copias"
                type="number"
                min={1}
                max={999}
                value={copias}
                onChange={(e) => setCopias(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tamanho da etiqueta</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                <Ruler className="h-3.5 w-3.5 shrink-0" />
                {largura} × {altura} mm
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border">
            {ehAdmin && (
              <div className="flex items-start gap-3 p-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Printer className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium leading-tight">Imprimir com driver do Windows</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Abre a caixa de impressão nativa, já no tamanho exato da etiqueta. Escolha ali sua
                    impressora — Zebra (com driver ZDesigner) ou qualquer outra instalada.
                  </p>
                </div>
              </div>
            )}

            <div className={`flex items-start gap-3 p-4 ${ehAdmin ? "border-t" : ""}`}>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <MonitorCog className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">Driver da Zebra ZD230</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Ainda não instalou o driver desta impressora neste computador? É uma vez só —
                  não precisa repetir a cada etiqueta. Para usar o <strong>Imprimir agora</strong>{" "}
                  (sem diálogo), também é preciso ter o <strong>Agente de Impressão HEMC</strong>{" "}
                  rodando na máquina — script próprio (não é da Zebra), veja com a TI se já foi
                  instalado neste computador.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <button
                    type="button"
                    onClick={baixarDriver}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" /> Baixar driver
                  </button>
                  <a
                    href={URL_DRIVER_ZEBRA_OFICIAL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Ver driver no site da Zebra
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          {ehAdmin && (
            <Button variant="outline" onClick={imprimirComDialogo}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir (com diálogo)
            </Button>
          )}
          <Button onClick={imprimirAgora} disabled={status.status !== "conectado" || enviando}>
            {enviando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
            Imprimir agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Mostra o estado da conexão com o Agente de Impressão HEMC e orienta o próximo
// passo em cada caso — nunca deixa a pessoa sem saber o que fazer quando
// "Imprimir agora" está desabilitado.
function StatusImpressoraCard({
  status,
  onTestarNovamente,
}: {
  status: StatusAgenteImpressao;
  onTestarNovamente: () => void;
}) {
  const conteudo = (() => {
    switch (status.status) {
      case "conectado":
        return {
          icone: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
          texto: "Agente de impressão conectado",
          subtexto: "Pronto pra imprimir direto, sem diálogo.",
          corTexto: "text-foreground",
        };
      case "verificando":
        return {
          icone: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
          texto: "Verificando agente de impressão...",
          subtexto: null,
          corTexto: "text-muted-foreground",
        };
      case "nao_encontrado":
      default:
        return {
          icone: <AlertCircle className="h-4 w-4 text-amber-500" />,
          texto: "Agente de impressão não encontrado",
          subtexto: "Veja a instalação no card abaixo.",
          corTexto: "text-muted-foreground",
        };
    }
  })();

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
      <div className={`flex items-start gap-2 text-sm ${conteudo.corTexto}`}>
        <span className="mt-0.5 shrink-0">{conteudo.icone}</span>
        <div className="leading-tight">
          <div className="font-medium">{conteudo.texto}</div>
          {conteudo.subtexto && (
            <div className="mt-0.5 text-xs text-muted-foreground">{conteudo.subtexto}</div>
          )}
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        onClick={onTestarNovamente}
        title="Testar conexão novamente"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function renderEtiquetaImpressao(elementos: ElementoEtiqueta[], qrData: Record<string, string>): string {
  const parts = elementos.map((el) => {
    if (el.tipo === "texto") {
      return `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;font-size:${el.tamanhoMm}mm;font-weight:${el.negrito ? 700 : 400};white-space:nowrap;line-height:1">${escaparHtml(el.texto)}</div>`;
    }
    if (el.tipo === "qrcode") {
      const src = qrData[el.id] ?? "";
      return `<img src="${src}" style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.larguraMm}mm;height:${el.larguraMm}mm"/>`;
    }
    if (el.tipo === "retangulo") {
      return `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.larguraMm}mm;height:${el.alturaMm}mm;border:${el.espessuraMm}mm solid #000;background:${el.preenchido ? "#000" : "transparent"}"></div>`;
    }
    if (el.tipo === "imagem") {
      return `<img src="${el.src}" style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.larguraMm}mm;height:${el.alturaMm}mm;object-fit:fill"/>`;
    }
    return `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.larguraMm}mm;height:${el.espessuraMm}mm;background:#000"></div>`;
  });
  return `<div class="etiq">${parts.join("")}</div>`;
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}