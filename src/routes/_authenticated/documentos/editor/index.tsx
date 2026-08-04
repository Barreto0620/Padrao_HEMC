import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { registrarAuditoria } from "@/lib/audit";
import { gerarODT } from "@/lib/odt";
import { FontSize } from "@/lib/tiptap-font-size";
import { TextColor } from "@/lib/tiptap-text-color";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Save, Printer, Download, Bold, Italic, Underline as UnderlineIcon,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Pilcrow, PenLine,
} from "lucide-react";

// Observação: este arquivo fica em documentos/editor/index.tsx (não
// documentos/editor.tsx) só para não ter dois arquivos chamados "editor.tsx"
// no projeto (o outro é src/routes/_authenticated/editor.tsx, do editor de
// etiquetas). A rota final continua sendo /documentos/editor — só o local
// em disco mudou, nada de comportamento.

const buscarSchema = z.object({
  id: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/documentos/editor/")({
  ssr: false, // TipTap/ProseMirror dependem do DOM, não renderizam no servidor
  head: () => ({
    meta: [
      { title: "Editor de Documentos — Padrão HEMC" },
      { name: "description", content: "Editor de documentos institucionais do Padrão HEMC (formato .odt)." },
    ],
  }),
  validateSearch: (s) => buscarSchema.parse(s),
  component: EditorDocumentos,
});

const TAMANHOS_FONTE = ["9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt"];

const CORES_CANETA = [
  { nome: "Preto", valor: "#000000" },
  { nome: "Vermelho", valor: "#C0392B" },
  { nome: "Azul-petróleo", valor: "#0F4C5C" },
  { nome: "Verde", valor: "#1E7A46" },
];

// ============================================================================
// Rascunho local — mesma lógica do editor de etiquetas: guarda o trabalho
// em andamento no localStorage, pra não perder nada ao trocar de tela e
// voltar. Só se aplica a "Novo Documento" (sem id na URL).
// ============================================================================
const RASCUNHO_KEY = "hemc_documento_rascunho";

type RascunhoDocumento = {
  titulo: string;
  conteudo: unknown;
  salvoEm: string;
};

function lerRascunho(): RascunhoDocumento | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(RASCUNHO_KEY);
    if (!bruto) return null;
    return JSON.parse(bruto) as RascunhoDocumento;
  } catch {
    return null;
  }
}

function salvarRascunho(r: RascunhoDocumento) {
  try {
    window.localStorage.setItem(RASCUNHO_KEY, JSON.stringify(r));
  } catch {
    // localStorage indisponível — o rascunho simplesmente não persiste
  }
}

function limparRascunho() {
  try {
    window.localStorage.removeItem(RASCUNHO_KEY);
  } catch {
    // sem impacto funcional
  }
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function EditorDocumentos() {
  const { id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: profile } = useProfile();
  const qc = useQueryClient();

  const [titulo, setTitulo] = useState("");
  const [documentoAtualId, setDocumentoAtualId] = useState<string | null>(null);
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);
  const [exportando, setExportando] = useState(false);
  const restauracaoFeitaRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      FontSize,
      TextColor,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "hemc-doc-conteudo focus:outline-none min-h-[20cm]",
      },
    },
  });

  // Carrega documento existente
  const { data: documentoExistente } = useQuery({
    queryKey: ["documento", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase.from("documentos").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (documentoExistente && editor) {
      setTitulo(documentoExistente.titulo);
      editor.commands.setContent(documentoExistente.conteudo as object);
      setDocumentoAtualId(documentoExistente.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentoExistente, editor]);

  // Restaura rascunho local — só em "Novo Documento" (sem id), e só depois
  // que o editor terminar de inicializar. Ref evita disparar duas vezes em
  // desenvolvimento (StrictMode chama efeitos duas vezes de propósito).
  useEffect(() => {
    if (!editor) return;
    if (restauracaoFeitaRef.current) return;
    restauracaoFeitaRef.current = true;

    if (id) {
      setRascunhoRestaurado(true);
      return;
    }
    const rascunho = lerRascunho();
    if (rascunho && rascunho.titulo.trim()) {
      setTitulo(rascunho.titulo);
      editor.commands.setContent(rascunho.conteudo as object);
      toast.info("Continuando de onde você parou.");
    }
    setRascunhoRestaurado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Salva o rascunho localmente, com debounce, a cada mudança relevante.
  useEffect(() => {
    if (id || !editor || !rascunhoRestaurado) return;
    const timer = setTimeout(() => {
      const conteudo = editor.getJSON();
      const temConteudo = editor.getText().trim().length > 0;
      if (!temConteudo && !titulo.trim()) {
        limparRascunho();
        return;
      }
      salvarRascunho({ titulo, conteudo, salvoEm: new Date().toISOString() });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editor, rascunhoRestaurado, titulo, editor?.state.doc]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error("Informe um título para o documento.");
      if (!profile) throw new Error("Perfil não carregado.");
      if (!editor) throw new Error("Editor não carregado.");
      const conteudo = editor.getJSON();
      const payload = {
        titulo: titulo.trim(),
        conteudo: conteudo as unknown as import("@/integrations/supabase/types").Json,
        setor_id: profile.setor_id,
      };
      if (documentoAtualId) {
        const { error } = await supabase.from("documentos").update(payload).eq("id", documentoAtualId);
        if (error) throw error;
        await registrarAuditoria({
          acao: "documento_editado",
          entidade_tipo: "documento",
          entidade_id: documentoAtualId,
          detalhes: { titulo: payload.titulo },
        });
        return documentoAtualId;
      }
      const { data, error } = await supabase
        .from("documentos")
        .insert({ ...payload, criado_por: profile.id })
        .select("id")
        .single();
      if (error) throw error;
      await registrarAuditoria({
        acao: "documento_criado",
        entidade_tipo: "documento",
        entidade_id: data.id,
        detalhes: { titulo: payload.titulo },
      });
      setDocumentoAtualId(data.id);
      navigate({ to: "/documentos/editor", search: { id: data.id } });
      return data.id as string;
    },
    onSuccess: () => {
      toast.success("Documento salvo.");
      limparRascunho();
      qc.invalidateQueries({ queryKey: ["documentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function exportarOdt() {
    if (!editor) return;
    if (!titulo.trim()) {
      toast.error("Informe um título antes de exportar.");
      return;
    }
    setExportando(true);
    try {
      const blob = await gerarODT({ titulo: titulo.trim(), conteudo: editor.getJSON() });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titulo.trim().replace(/[\\/:*?"<>|]/g, "-")}.odt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await registrarAuditoria({
        acao: "documento_exportado_odt",
        entidade_tipo: "documento",
        entidade_id: documentoAtualId ?? undefined,
        detalhes: { titulo: titulo.trim() },
      });
      toast.success("Arquivo .odt baixado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o .odt.");
    } finally {
      setExportando(false);
    }
  }

  function imprimir() {
    if (!editor) return;
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Bloqueado pelo navegador. Permita pop-ups.");
      return;
    }
    const corpoHtml = editor.getHTML();
    const origem = window.location.origin;
    // Cabeçalho e rodapé em fluxo normal do documento (não "position: fixed")
    // — a versão anterior usava posicionamento fixo com deslocamento
    // negativo pra tentar repetir em toda página impressa, mas isso se
    // comporta de forma inconsistente entre navegadores (foi exatamente o
    // bug relatado: o cabeçalho apareceu no rodapé). Em fluxo normal, o
    // cabeçalho sempre aparece no topo e o rodapé sempre no final, de
    // forma previsível — o único "custo" é que em documentos com mais de
    // uma página impressa, o rodapé só aparece uma vez no final, não
    // repetido em cada página (limitação aceitável: a maioria dos
    // documentos institucionais aqui é curta, e o .odt exportado sim repete
    // em toda página quando aberto no Word/LibreOffice).
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escaparHtml(titulo || "Documento")}</title>
<style>
  @page { size: A4; margin: 2cm 2.5cm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
  header.doc-cabecalho { text-align: center; border-bottom: 1px solid #ccc; padding-bottom: 0.4cm; margin-bottom: 0.6cm; }
  header.doc-cabecalho img { height: 1.8cm; }
  header.doc-cabecalho div { font-size: 12pt; font-weight: bold; color: #0F4C5C; margin-top: 2px; }
  footer.doc-rodape { text-align: center; border-top: 1px solid #ccc; padding-top: 0.4cm; margin-top: 0.8cm; }
  footer.doc-rodape p { font-size: 8pt; color: #555; margin: 0 0 4px; }
  footer.doc-rodape img { height: 1.05cm; margin: 0 6px; vertical-align: middle; }
  h1 { font-size: 18pt; color: #0F4C5C; margin: 0.4cm 0 0.3cm; }
  h2 { font-size: 15pt; color: #0F4C5C; margin: 0.3cm 0 0.2cm; }
  h3 { font-size: 13pt; margin: 0.25cm 0 0.15cm; }
  p { margin: 0 0 0.25cm; }
  ul, ol { margin: 0 0 0.25cm; padding-left: 1cm; }
</style>
</head><body>
<header class="doc-cabecalho">
  <img src="${origem}/logos/logo_hemc.png" alt="" />
  <div>HOSPITAL ESTADUAL M&Aacute;RIO COVAS</div>
</header>
<main>${corpoHtml}</main>
<footer class="doc-rodape">
  <p>Rua Doutor Henrique Calderazzo, 321 | CEP 09190-615 | Santo Andr&eacute;, SP</p>
  <img src="${origem}/logos/logo_hemc.png" alt="" />
  <img src="${origem}/logos/logo_fuabc.png" alt="" />
  <img src="${origem}/logos/logo_sp.png" alt="" />
</footer>
</body></html>`;
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 400);
  }

  if (!editor) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        titulo={documentoAtualId ? "Editar Documento" : "Novo Documento"}
        descricao="Crie documentos institucionais padronizados, prontos pra exportar em .odt."
        acoes={
          <>
            <Button variant="secondary" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
            <Button variant="outline" onClick={exportarOdt} disabled={exportando}>
              {exportando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Baixar .odt
            </Button>
            <Button onClick={imprimir}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
          </>
        }
      />

      <BarraFerramentas editor={editor} titulo={titulo} setTitulo={setTitulo} />

      <div className="flex-1 overflow-y-auto bg-muted/30 py-8">
        <PaginaDocumento editor={editor} />
      </div>
    </div>
  );
}

// ============================================================================
// Barra de ferramentas — mesma linguagem visual do ribbon do editor de
// etiquetas (botões pequenos em linha, estado ativo destacado).
// ============================================================================

function BotaoFormatacao({
  ativo,
  onClick,
  titulo,
  children,
}: {
  ativo?: boolean;
  onClick: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors ${
        ativo ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SeletorCorCaneta({
  corAtual,
  onEscolher,
}: {
  corAtual: string;
  onEscolher: (cor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Cor da caneta"
          aria-label="Cor da caneta"
          className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <PenLine className="h-4 w-4" />
          <span className="h-1 w-4 rounded-full" style={{ backgroundColor: corAtual }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-2">
        <div className="grid grid-cols-4 gap-2">
          {CORES_CANETA.map((c) => (
            <button
              key={c.valor}
              type="button"
              title={c.nome}
              onClick={() => { onEscolher(c.valor); setAberto(false); }}
              className={`grid h-8 w-8 place-items-center rounded-full border-2 transition-transform hover:scale-110 ${
                corAtual.toLowerCase() === c.valor.toLowerCase() ? "border-primary" : "border-transparent"
              }`}
            >
              <span className="h-6 w-6 rounded-full" style={{ backgroundColor: c.valor }} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SeparadorBarra() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

function BarraFerramentas({
  editor,
  titulo,
  setTitulo,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  titulo: string;
  setTitulo: (s: string) => void;
}) {
  // O TipTap v3 não re-renderiza mais automaticamente a cada mudança de
  // seleção/formatação (por questão de performance) — sem o useEditorState,
  // a barra até aplicava a formatação de verdade no documento, mas os
  // próprios botões/menus ficavam com aparência "congelada", sem refletir
  // o que tinha sido escolhido. Era exatamente esse o bug de "não salva a
  // formatação que eu seleciono". Com o seletor abaixo, a barra só
  // re-renderiza quando algum desses valores realmente muda.
  const estado = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      negrito: ed.isActive("bold"),
      italico: ed.isActive("italic"),
      sublinhado: ed.isActive("underline"),
      listaMarcadores: ed.isActive("bulletList"),
      listaNumerada: ed.isActive("orderedList"),
      alinhamento: ed.isActive({ textAlign: "center" })
        ? "center"
        : ed.isActive({ textAlign: "right" })
          ? "right"
          : ed.isActive({ textAlign: "justify" })
            ? "justify"
            : "left",
      tipoBloco: ed.isActive("heading", { level: 1 })
        ? "h1"
        : ed.isActive("heading", { level: 2 })
          ? "h2"
          : ed.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      tamanhoFonte: (ed.getAttributes("textStyle").fontSize as string | undefined) ?? "11pt",
      cor: (ed.getAttributes("textStyle").color as string | undefined) ?? "#000000",
    }),
  });

  function aplicarTipoBloco(v: string) {
    if (v === "p") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(v.replace("h", "")) as 1 | 2 | 3 }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-card px-3 py-2">
      <Input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título do documento"
        className="h-8 w-56 shrink-0 font-medium"
        maxLength={150}
      />

      <SeparadorBarra />

      <Select value={estado.tipoBloco} onValueChange={aplicarTipoBloco}>
        <SelectTrigger className="h-8 w-32 shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="p">Parágrafo</SelectItem>
          <SelectItem value="h1">Título 1</SelectItem>
          <SelectItem value="h2">Título 2</SelectItem>
          <SelectItem value="h3">Título 3</SelectItem>
        </SelectContent>
      </Select>

      <Select value={estado.tamanhoFonte} onValueChange={(v) => editor.chain().focus().setFontSize(v).run()}>
        <SelectTrigger className="h-8 w-20 shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TAMANHOS_FONTE.map((t) => (
            <SelectItem key={t} value={t}>{t.replace("pt", "")}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <SeletorCorCaneta corAtual={estado.cor} onEscolher={(cor) => editor.chain().focus().setTextColor(cor).run()} />

      <SeparadorBarra />

      <BotaoFormatacao titulo="Negrito" ativo={estado.negrito} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Itálico" ativo={estado.italico} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Sublinhado" ativo={estado.sublinhado} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-4 w-4" />
      </BotaoFormatacao>

      <SeparadorBarra />

      <BotaoFormatacao titulo="Alinhar à esquerda" ativo={estado.alinhamento === "left"} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Centralizar" ativo={estado.alinhamento === "center"} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Alinhar à direita" ativo={estado.alinhamento === "right"} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Justificar" ativo={estado.alinhamento === "justify"} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
        <AlignJustify className="h-4 w-4" />
      </BotaoFormatacao>

      <SeparadorBarra />

      <BotaoFormatacao titulo="Lista com marcadores" ativo={estado.listaMarcadores} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Lista numerada" ativo={estado.listaNumerada} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </BotaoFormatacao>
      <BotaoFormatacao titulo="Parágrafo comum" ativo={estado.tipoBloco === "p"} onClick={() => editor.chain().focus().setParagraph().run()}>
        <Pilcrow className="h-4 w-4" />
      </BotaoFormatacao>
    </div>
  );
}

// ============================================================================
// Página de visualização — folha branca estilo A4, com o cabeçalho e
// rodapé institucional fixo (o mesmo que vai pro .odt exportado e pra
// impressão), pra o usuário já ver exatamente como vai ficar.
// ============================================================================

function PaginaDocumento({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  return (
    <div className="mx-auto w-full max-w-[21cm] rounded-sm bg-white text-black shadow-lg">
      <div className="border-b px-12 pb-4 pt-10 text-center">
        <img src="/logos/logo_hemc.png" alt="Logo HEMC" className="mx-auto h-14 w-14 object-contain" />
        <div className="mt-2 text-sm font-bold text-[#0F4C5C]">HOSPITAL ESTADUAL MÁRIO COVAS</div>
      </div>

      <EditorContent editor={editor} className="hemc-doc-pagina px-12 py-8" />

      <div className="border-t px-12 pb-6 pt-4 text-center">
        <p className="text-[10px] text-gray-500">
          Rua Doutor Henrique Calderazzo, 321 | CEP 09190-615 | Santo André, SP
        </p>
        <div className="mt-2 flex items-center justify-center gap-6">
          <img src="/logos/logo_hemc.png" alt="Logo HEMC" className="h-8 object-contain" />
          <img src="/logos/logo_fuabc.png" alt="Logo FUABC" className="h-8 object-contain" />
          <img src="/logos/logo_sp.png" alt="Logo Governo SP" className="h-8 object-contain" />
        </div>
      </div>
    </div>
  );
}