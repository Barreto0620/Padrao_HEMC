// Integração com o Zebra Browser Print — o aplicativo local (instalado uma
// vez no PC) que faz a ponte entre o navegador e a porta da impressora.
// É a ÚNICA forma de imprimir sem abrir o diálogo nativo do Windows —
// nenhum navegador permite um site escrever direto numa porta de
// impressora, por segurança. O SDK é servido localmente (public/vendor),
// sem depender de CDN externo, pra funcionar mesmo em rede com proxy
// restritivo (comum em ambiente hospitalar).

const SDK_URL = "/vendor/BrowserPrint-3.0.216.min.js";

export interface DispositivoZebra {
  name: string;
  uid: string;
  connection: string;
  send: (
    dados: string,
    onSucesso?: () => void,
    onErro?: (erro: unknown) => void,
  ) => void;
}

declare global {
  interface Window {
    BrowserPrint?: {
      getDefaultDevice: (
        tipo: string,
        onSucesso: (device: DispositivoZebra) => void,
        onErro: (erro: unknown) => void,
      ) => void;
    };
  }
}

let sdkPromise: Promise<void> | null = null;

function carregarSDK(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.BrowserPrint) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existente) {
      existente.addEventListener("load", () => resolve());
      existente.addEventListener("error", () => reject(new Error("Falha ao carregar o SDK do Zebra Browser Print.")));
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o SDK do Zebra Browser Print."));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export type StatusImpressoraZebra =
  | { status: "verificando" }
  | { status: "conectada"; device: DispositivoZebra }
  | { status: "sdk_indisponivel" }
  | { status: "app_nao_respondeu" };

/**
 * Verifica se o Zebra Browser Print está instalado, aberto e com uma
 * impressora padrão configurada. Três resultados possíveis além de
 * "conectada":
 *  - sdk_indisponivel: o arquivo do SDK não carregou (problema de deploy)
 *  - app_nao_respondeu: SDK carregou, mas o aplicativo local não está
 *    rodando, ou não há impressora Zebra configurada nele
 */
export async function verificarImpressoraZebra(): Promise<StatusImpressoraZebra> {
  try {
    await carregarSDK();
  } catch {
    return { status: "sdk_indisponivel" };
  }
  if (!window.BrowserPrint) return { status: "sdk_indisponivel" };

  return new Promise((resolve) => {
    window.BrowserPrint!.getDefaultDevice(
      "printer",
      (device) => resolve({ status: "conectada", device }),
      () => resolve({ status: "app_nao_respondeu" }),
    );
  });
}

export function enviarZPLParaImpressora(device: DispositivoZebra, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    device.send(
      zpl,
      () => resolve(),
      (erro) => reject(erro instanceof Error ? erro : new Error(String(erro ?? "Falha ao enviar para a impressora."))),
    );
  });
}