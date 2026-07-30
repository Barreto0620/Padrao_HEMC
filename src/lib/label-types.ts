export type ElementoBase = {
  id: string;
  x: number; // mm
  y: number; // mm
};

export type ElementoTexto = ElementoBase & {
  tipo: "texto";
  texto: string;
  tamanhoMm: number;
  negrito: boolean;
  alinhamento: "left" | "center" | "right";
};

export type ElementoQR = ElementoBase & {
  tipo: "qrcode";
  conteudo: string;
  larguraMm: number;
};

export type ElementoRetangulo = ElementoBase & {
  tipo: "retangulo";
  larguraMm: number;
  alturaMm: number;
  espessuraMm: number;
  preenchido: boolean;
};

export type ElementoLinha = ElementoBase & {
  tipo: "linha";
  larguraMm: number;
  espessuraMm: number;
};

export type ElementoImagem = ElementoBase & {
  tipo: "imagem";
  src: string; // data URL (base64) da imagem, gerada no upload
  larguraMm: number;
  alturaMm: number;
  nomeArquivo?: string;
  // Proporção largura/altura do arquivo original, capturada no upload.
  // Usada para travar o redimensionamento e nunca distorcer a imagem.
  proporcaoOriginal?: number;
};

export type ElementoEtiqueta =
  | ElementoTexto
  | ElementoQR
  | ElementoRetangulo
  | ElementoLinha
  | ElementoImagem;

export type ConteudoEtiqueta = {
  elementos: ElementoEtiqueta[];
};

export type ModoImpressao = "zebra" | "folha";

export const PRESETS_ZEBRA: { rotulo: string; largura: number; altura: number }[] = [
  { rotulo: "33 × 25 mm", largura: 33, altura: 25 },
  { rotulo: "50 × 25 mm", largura: 50, altura: 25 },
  { rotulo: "50 × 30 mm", largura: 50, altura: 30 },
  { rotulo: "80 × 40 mm", largura: 80, altura: 40 },
  { rotulo: "100 × 34 mm", largura: 100, altura: 34 },
  { rotulo: "100 × 50 mm", largura: 100, altura: 50 },
  { rotulo: "100 × 100 mm", largura: 100, altura: 100 },
];

// Limite de tamanho de arquivo aceito no upload de imagem do editor.
// Evita que o JSONB de templates_etiqueta no Supabase infle demais — imagem
// em base64 fica ~33% maior que o arquivo original. Ver observação sobre
// Supabase Storage como evolução futura, se o uso de imagens crescer muito.
export const LIMITE_IMAGEM_BYTES = 2 * 1024 * 1024; // 2 MB