// Integração com o Agente de Impressão Padrão HEMC — um script PowerShell
// próprio (agente-impressao/hemc-print-agent.ps1) que roda em background no
// PC, escutando em localhost. Ele recebe o ZPL e executa
// "copy /b arquivo.zpl LPT1", o mesmo comando que a TI já usa manualmente
// com o "net use lpt1 \\SERVIDOR\COMPARTILHAMENTO" mapeado.
//
// Diferente do Zebra Browser Print: sem instalar nada de terceiro, sem
// formulário, sem SDK — só o script .ps1 rodando na máquina. Em
// contrapartida, é a TI que assume a manutenção dele (não tem suporte da
// Zebra por trás).

const AGENTE_URL = "http://localhost:38900";
const TIMEOUT_MS = 1500;

async function fetchComTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type StatusAgenteImpressao =
  | { status: "verificando" }
  | { status: "conectado" }
  | { status: "nao_encontrado" };

/**
 * Verifica se o agente local está rodando (GET /status). Se não responder
 * dentro do timeout — ou não estiver rodando mesmo — cai em "nao_encontrado".
 */
export async function verificarAgenteImpressao(): Promise<StatusAgenteImpressao> {
  try {
    const res = await fetchComTimeout(`${AGENTE_URL}/status`, { method: "GET" });
    if (res.ok) return { status: "conectado" };
    return { status: "nao_encontrado" };
  } catch {
    return { status: "nao_encontrado" };
  }
}

/**
 * Envia o ZPL já gerado para o agente local, que encaminha pra LPT1.
 * Lança erro com a mensagem do agente quando a impressão falha.
 */
export async function enviarZPLParaAgente(zpl: string): Promise<void> {
  const res = await fetch(`${AGENTE_URL}/imprimir`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: zpl,
  });

  if (!res.ok) {
    let mensagem = "Falha ao enviar a etiqueta para o agente de impressão.";
    try {
      const data = await res.json();
      if (data?.erro) mensagem = data.erro;
    } catch {
      // resposta não veio em JSON — mantém a mensagem genérica
    }
    throw new Error(mensagem);
  }
}