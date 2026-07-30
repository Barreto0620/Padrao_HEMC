// src/lib/zebra-browser-print.ts
//
// Cliente para o serviço "Zebra Browser Print" (agente local instalado na
// máquina do usuário). Ele expõe uma API HTTP em localhost:9100 (padrão)
// que permite listar impressoras Zebra e enviar ZPL diretamente, sem passar
// pela caixa de diálogo de impressão do navegador.
//
// Download do agente (o usuário precisa instalar uma vez por máquina):
// https://www.zebra.com/us/en/support-downloads/printer-software/browser-print.html

const BROWSER_PRINT_URL = "http://127.0.0.1:9101";

export type ImpressoraZebra = {
  uid: string;
  name: string;
  connection: string; // "usb" | "network" | "driver" etc.
  deviceType: string;
};

/**
 * Verifica se o serviço Zebra Browser Print está rodando na máquina do usuário.
 */
export async function browserPrintDisponivel(): Promise<boolean> {
  try {
    const resp = await fetch(`${BROWSER_PRINT_URL}/available`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Lista as impressoras Zebra disponíveis (USB, rede e driver) cadastradas
 * no Browser Print.
 */
export async function listarImpressoras(): Promise<ImpressoraZebra[]> {
  const resp = await fetch(`${BROWSER_PRINT_URL}/available`, {
    method: "GET",
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) throw new Error("Zebra Browser Print não respondeu.");
  const data = await resp.json();

  const brutos: unknown[] = [
    ...(data?.usb ?? []),
    ...(data?.network ?? []),
    ...(data?.driver ?? []),
  ];

  return brutos.map((p) => {
    const dev = p as Record<string, unknown>;
    return {
      uid: String(dev.uid ?? dev.name ?? crypto.randomUUID()),
      name: String(dev.name ?? "Impressora Zebra"),
      connection: String(dev.connection ?? "desconhecida"),
      deviceType: String(dev.deviceType ?? "printer"),
    };
  });
}

/**
 * Envia ZPL bruto diretamente para a impressora identificada por `uid`
 * (o valor retornado em `listarImpressoras`).
 */
export async function imprimirZpl(uid: string, zpl: string): Promise<void> {
  const resp = await fetch(`${BROWSER_PRINT_URL}/write`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      device: { uid },
      data: zpl,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error("Falha ao enviar etiqueta para a impressora Zebra.");
  }
}

const CHAVE_IMPRESSORA_PADRAO = "hemc:zebra-impressora-padrao";

export function obterImpressoraPadrao(): string | null {
  return localStorage.getItem(CHAVE_IMPRESSORA_PADRAO);
}

export function salvarImpressoraPadrao(uid: string): void {
  localStorage.setItem(CHAVE_IMPRESSORA_PADRAO, uid);
}