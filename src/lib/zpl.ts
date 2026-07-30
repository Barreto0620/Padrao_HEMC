import type { ElementoEtiqueta, ElementoImagem } from "./label-types";

const MM_TO_DOTS = 8; // 203 dpi ~ 8 dots/mm

const mm = (v: number) => Math.round(v * MM_TO_DOTS);

// ============================================================================
// CALIBRAÇÃO DE POSIÇÃO — ajuste aqui, não no tamanho da etiqueta
// ============================================================================
// Cada impressora térmica tem uma pequena variação mecânica de onde o
// cabeçote realmente começa a imprimir, mesmo com o tamanho da etiqueta
// configurado certo dos dois lados (impressora e sistema). O comando ^LT
// (Label Top) desloca TODO o conteúdo pra cima/baixo sem recalcular a
// posição de cada elemento — é a forma correta de corrigir isso.
//
// Valor em milímetros. Positivo = desloca pra BAIXO. Negativo = pra CIMA.
// Comece com este valor, imprima uma etiqueta de teste, e ajuste aos poucos
// (ex.: de 0.5 em 0.5 mm) até o conteúdo ficar centralizado na etiqueta
// física. A faixa segura na maioria das Zebra desktop é de -15 a +15 mm.
const AJUSTE_TOPO_MM = 3;

export async function gerarZPL(params: {
  larguraMm: number;
  alturaMm: number;
  elementos: ElementoEtiqueta[];
  copias: number;
}): Promise<string> {
  const { larguraMm, alturaMm, elementos, copias } = params;
  const partes: string[] = [];
  partes.push("^XA");
  partes.push(`^PW${mm(larguraMm)}`);
  partes.push(`^LL${mm(alturaMm)}`);
  partes.push("^LH0,0");
  partes.push(`^LT${mm(AJUSTE_TOPO_MM)}`);
  partes.push("^CI28"); // UTF-8

  for (const el of elementos) {
    const x = mm(el.x);
    const y = mm(el.y);
    if (el.tipo === "texto") {
      const h = Math.max(10, mm(el.tamanhoMm ?? 3));
      partes.push(`^FO${x},${y}^A0N,${h},${h}^FD${escapar(el.texto)}^FS`);
    } else if (el.tipo === "qrcode") {
      const mag = Math.max(2, Math.round((el.larguraMm ?? 15) / 5));
      partes.push(`^FO${x},${y}^BQN,2,${mag}^FDLA,${escapar(el.conteudo)}^FS`);
    } else if (el.tipo === "retangulo") {
      const w = mm(el.larguraMm ?? 10);
      const h = mm(el.alturaMm ?? 10);
      const t = Math.max(1, mm(el.espessuraMm ?? 0.3));
      partes.push(`^FO${x},${y}^GB${w},${h},${t}^FS`);
    } else if (el.tipo === "linha") {
      const w = mm(el.larguraMm ?? 10);
      const t = Math.max(1, mm(el.espessuraMm ?? 0.3));
      partes.push(`^FO${x},${y}^GB${w},${t},${t}^FS`);
    } else if (el.tipo === "imagem") {
      const bitmap = await imagemParaZPL(el);
      partes.push(`^FO${x},${y}${bitmap}`);
    }
  }

  if (copias > 1) partes.push(`^PQ${copias}`);
  partes.push("^XZ");
  return partes.join("\n");
}

function escapar(s: string): string {
  return s.replace(/\^/g, " ").replace(/~/g, " ");
}

// Converte a imagem (data URL base64) em um bitmap monocromático no formato
// de campo gráfico ^GFA do ZPL. A impressora térmica não tem escala de cinza
// nem cor — cada pixel vira preto ou branco por limiar de luminância.
async function imagemParaZPL(el: ElementoImagem): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("A conversão de imagem para ZPL só funciona no navegador.");
  }

  const img = await carregarImagem(el.src);

  const wDots = Math.max(8, mm(el.larguraMm));
  const hDots = Math.max(8, mm(el.alturaMm));

  const canvas = document.createElement("canvas");
  canvas.width = wDots;
  canvas.height = hDots;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a imagem para impressão.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, wDots, hDots);
  ctx.drawImage(img, 0, 0, wDots, hDots);

  const { data } = ctx.getImageData(0, 0, wDots, hDots);
  const bytesPerRow = Math.ceil(wDots / 8);
  const totalBytes = bytesPerRow * hDots;
  const bytes = new Uint8Array(totalBytes);

  for (let y = 0; y < hDots; y++) {
    for (let x = 0; x < wDots; x++) {
      const i = (y * wDots + x) * 4;
      const luminancia = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luminancia < 140) {
        bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");

  return `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex.toUpperCase()}`;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível carregar a imagem para impressão."));
    img.src = src;
  });
}

export function baixarArquivoZPL(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.endsWith(".zpl") ? nome : `${nome}.zpl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
} 