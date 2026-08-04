import JSZip from "jszip";

// ============================================================================
// Gerador de .odt (OpenDocument Text) — formato aberto, funciona tanto no
// LibreOffice quanto no Microsoft Word (que lê .odt nativamente desde
// versões antigas). Por baixo dos panos, .odt é só um .zip com XML dentro —
// não existe uma biblioteca pronta confiável pra "gerar odt com um
// comando", então construímos o XML na mão aqui. Como o corpo do documento
// não aceita imagem (só o cabeçalho/rodapé institucional, que é sempre
// igual), o XML necessário fica bem mais simples do que um gerador de odt
// genérico precisaria ser.
// ============================================================================

type NoTexto = {
  type: "text";
  text: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

type NoBloco = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<NoBloco | NoTexto>;
};

function ehTexto(no: NoBloco | NoTexto): no is NoTexto {
  return no.type === "text";
}

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Registra estilos de texto/parágrafo sob demanda, conforme aparecem no
// documento — evita duplicar a mesma definição de estilo várias vezes
// (ex.: "negrito" só é definido uma vez, mesmo usado em 50 palavras).
class RegistroEstilos {
  private mapa = new Map<string, string>();
  private contador = 0;
  private definicoes: string[] = [];

  estiloTexto(marks: NoTexto["marks"]): string | null {
    if (!marks || marks.length === 0) return null;
    const negrito = marks.some((m) => m.type === "bold");
    const italico = marks.some((m) => m.type === "italic");
    const sublinhado = marks.some((m) => m.type === "underline");
    const estiloTextStyle = marks.find((m) => m.type === "textStyle")?.attrs;
    const tamanho = estiloTextStyle?.fontSize as string | undefined;
    const cor = estiloTextStyle?.color as string | undefined;
    if (!negrito && !italico && !sublinhado && !tamanho && !cor) return null;

    const chave = `t-b${negrito ? 1 : 0}i${italico ? 1 : 0}u${sublinhado ? 1 : 0}s${tamanho ?? ""}c${cor ?? ""}`;
    const existente = this.mapa.get(chave);
    if (existente) return existente;

    const nome = `T${++this.contador}`;
    this.mapa.set(chave, nome);
    const props: string[] = [];
    if (negrito) props.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"');
    if (italico) props.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"');
    if (sublinhado) {
      props.push(
        'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"',
      );
    }
    if (tamanho) {
      const t = /^\d+$/.test(tamanho) ? `${tamanho}pt` : tamanho;
      props.push(`fo:font-size="${t}" style:font-size-asian="${t}" style:font-size-complex="${t}"`);
    }
    if (cor) {
      props.push(`fo:color="${cor}"`);
    }

    this.definicoes.push(
      `<style:style style:name="${nome}" style:family="text"><style:text-properties ${props.join(" ")}/></style:style>`,
    );
    return nome;
  }

  estiloParagrafo(alinhamento: string | undefined): string | null {
    if (!alinhamento || alinhamento === "left") return null;
    const chave = `p-${alinhamento}`;
    const existente = this.mapa.get(chave);
    if (existente) return existente;

    const nome = `P${++this.contador}`;
    this.mapa.set(chave, nome);
    const alinhaOdt =
      alinhamento === "center" ? "center" : alinhamento === "right" ? "end" : alinhamento === "justify" ? "justify" : "start";
    this.definicoes.push(
      `<style:style style:name="${nome}" style:family="paragraph" style:parent-style-name="Standard">` +
        `<style:paragraph-properties fo:text-align="${alinhaOdt}"/></style:style>`,
    );
    return nome;
  }

  get xml(): string {
    return this.definicoes.join("");
  }
}

function converterInline(nos: Array<NoBloco | NoTexto>, estilos: RegistroEstilos): string {
  return nos
    .map((no) => {
      if (!ehTexto(no)) return "";
      const texto = escaparXml(no.text ?? "");
      const nomeEstilo = estilos.estiloTexto(no.marks);
      if (!nomeEstilo) return texto;
      return `<text:span text:style-name="${nomeEstilo}">${texto}</text:span>`;
    })
    .join("");
}

function converterBloco(no: NoBloco, estilos: RegistroEstilos): string {
  const filhos = (no.content ?? []) as Array<NoBloco | NoTexto>;

  if (no.type === "paragraph") {
    const alinhamento = no.attrs?.textAlign as string | undefined;
    const nomeEstiloP = estilos.estiloParagrafo(alinhamento) ?? "Standard";
    if (filhos.length === 0) return `<text:p text:style-name="${nomeEstiloP}"/>`;
    return `<text:p text:style-name="${nomeEstiloP}">${converterInline(filhos, estilos)}</text:p>`;
  }

  if (no.type === "heading") {
    const nivel = Math.min(3, Math.max(1, Number(no.attrs?.level ?? 1)));
    return `<text:h text:style-name="Heading_20_${nivel}" text:outline-level="${nivel}">${converterInline(filhos, estilos)}</text:h>`;
  }

  if (no.type === "bulletList" || no.type === "orderedList") {
    const nomeLista = no.type === "bulletList" ? "LB1" : "LN1";
    const itens = filhos
      .filter((f): f is NoBloco => !ehTexto(f))
      .map((item) => {
        const paragrafos = (item.content ?? [])
          .filter((p): p is NoBloco => !ehTexto(p))
          .map((p) => converterBloco(p, estilos))
          .join("");
        return `<text:list-item>${paragrafos}</text:list-item>`;
      })
      .join("");
    return `<text:list text:style-name="${nomeLista}">${itens}</text:list>`;
  }

  if (no.type === "horizontalRule") {
    return `<text:p text:style-name="Standard"/>`;
  }

  // Qualquer tipo de nó não tratado explicitamente: tenta converter os
  // filhos mesmo assim, em vez de descartar o conteúdo em silêncio.
  const blocos = filhos.filter((f): f is NoBloco => !ehTexto(f));
  if (blocos.length > 0) return blocos.map((b) => converterBloco(b, estilos)).join("");
  return "";
}

function gerarContentXml(doc: NoBloco, estilos: RegistroEstilos): string {
  const corpo = (doc.content ?? []).map((no) => converterBloco(no as NoBloco, estilos)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:automatic-styles>${estilos.xml}</office:automatic-styles>
<office:body><office:text>${corpo}</office:text></office:body>
</office:document-content>`;
}

function gerarStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
<office:styles>
<style:style style:name="Standard" style:family="paragraph" style:class="text">
<style:paragraph-properties fo:margin-bottom="0.25cm" fo:line-height="150%"/>
<style:text-properties fo:font-size="11pt" style:font-name="Arial"/>
</style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard">
<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.3cm"/>
<style:text-properties fo:font-size="18pt" fo:font-weight="bold" fo:color="#0F4C5C"/>
</style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Standard">
<style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.2cm"/>
<style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#0F4C5C"/>
</style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Standard">
<style:paragraph-properties fo:margin-top="0.25cm" fo:margin-bottom="0.15cm"/>
<style:text-properties fo:font-size="13pt" fo:font-weight="bold"/>
</style:style>
<style:style style:name="CabecalhoTitulo" style:family="paragraph">
<style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.1cm"/>
<style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:color="#0F4C5C"/>
</style:style>
<style:style style:name="RodapeTexto" style:family="paragraph">
<style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.15cm"/>
<style:text-properties fo:font-size="8pt" fo:color="#555555"/>
</style:style>
<style:style style:name="RodapeLogos" style:family="paragraph">
<style:paragraph-properties fo:text-align="center"/>
</style:style>
<text:list-style style:name="LB1">
<text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;"><style:list-level-properties text:min-label-width="0.5cm"/></text:list-level-style-bullet>
</text:list-style>
<text:list-style style:name="LN1">
<text:list-level-style-number text:level="1" style:num-format="1" text:num-suffix="."><style:list-level-properties text:min-label-width="0.6cm"/></text:list-level-style-number>
</text:list-style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="PM1">
<style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2.2cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm">
<style:header-style><style:header-footer-properties fo:min-height="2.8cm" fo:margin-bottom="0.5cm"/></style:header-style>
<style:footer-style><style:header-footer-properties fo:min-height="2.5cm" fo:margin-top="0.5cm"/></style:footer-style>
</style:page-layout-properties>
</style:page-layout>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="PM1">
<style:header>
<text:p text:style-name="CabecalhoTitulo"><draw:frame draw:name="LogoCabecalho" text:anchor-type="as-char" svg:width="1.8cm" svg:height="1.8cm"><draw:image xlink:href="Pictures/logo_hemc.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>
<text:p text:style-name="CabecalhoTitulo">HOSPITAL ESTADUAL M&#193;RIO COVAS</text:p>
</style:header>
<style:footer>
<text:p text:style-name="RodapeTexto">Rua Doutor Henrique Calderazzo, 321 | CEP 09190-615 | Santo Andr&#233;, SP</text:p>
<text:p text:style-name="RodapeLogos"><draw:frame draw:name="LogoRodapeHemc" text:anchor-type="as-char" svg:width="1.3cm" svg:height="1.3cm"><draw:image xlink:href="Pictures/logo_hemc.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame><text:s text:c="3"/><draw:frame draw:name="LogoRodapeFuabc" text:anchor-type="as-char" svg:width="1.3cm" svg:height="1.3cm"><draw:image xlink:href="Pictures/logo_fuabc.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame><text:s text:c="3"/><draw:frame draw:name="LogoRodapeSp" text:anchor-type="as-char" svg:width="1.3cm" svg:height="1.3cm"><draw:image xlink:href="Pictures/logo_sp.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>
</style:footer>
</style:master-page>
</office:master-styles>
</office:document-styles>`;
}

function gerarMetaXml(titulo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">
<office:meta><dc:title>${escaparXml(titulo)}</dc:title><meta:generator>Padrão HEMC</meta:generator></office:meta>
</office:document-meta>`;
}

function gerarManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Pictures/logo_hemc.png" manifest:media-type="image/png"/>
<manifest:file-entry manifest:full-path="Pictures/logo_fuabc.png" manifest:media-type="image/png"/>
<manifest:file-entry manifest:full-path="Pictures/logo_sp.png" manifest:media-type="image/png"/>
</manifest:manifest>`;
}

export async function gerarODT(params: { titulo: string; conteudo: unknown }): Promise<Blob> {
  const zip = new JSZip();

  // O mimetype precisa ser o primeiro arquivo do zip e SEM compressão —
  // é assim que LibreOffice/Word reconhecem o formato antes mesmo de abrir
  // o resto do pacote.
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });

  const [logoHemc, logoFuabc, logoSp] = await Promise.all([
    fetch("/logos/logo_hemc.png").then((r) => r.arrayBuffer()),
    fetch("/logos/logo_fuabc.png").then((r) => r.arrayBuffer()),
    fetch("/logos/logo_sp.png").then((r) => r.arrayBuffer()),
  ]);
  const pastaImagens = zip.folder("Pictures")!;
  pastaImagens.file("logo_hemc.png", logoHemc);
  pastaImagens.file("logo_fuabc.png", logoFuabc);
  pastaImagens.file("logo_sp.png", logoSp);

  const estilos = new RegistroEstilos();
  zip.file("content.xml", gerarContentXml(params.conteudo as NoBloco, estilos));
  zip.file("styles.xml", gerarStylesXml());
  zip.file("meta.xml", gerarMetaXml(params.titulo));
  zip.file("META-INF/manifest.xml", gerarManifestXml());

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.oasis.opendocument.text",
    compression: "DEFLATE",
  });
}