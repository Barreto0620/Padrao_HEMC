import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Terminal, AlertTriangle, Cpu, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_authenticated/agente-impressao")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Agente de Impressão — Padrão HEMC" },
      {
        name: "description",
        content: "Como instalar o agente local que permite imprimir etiquetas direto, sem diálogo.",
      },
    ],
  }),
  // Restrito ao admin (TI) — o colaborador não deve lidar com instalação
  // técnica no próprio PC, mesma lógica já aplicada ao diálogo de
  // impressão. Isso barra a rota de verdade, não só esconde do menu — sem
  // isso, a URL continuaria acessível direto pra qualquer usuário logado.
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/editor" });
  },
  component: PaginaAgente,
});

function baixarArquivoEstatico(caminho: string, nome: string) {
  const a = document.createElement("a");
  a.href = caminho;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function Codigo({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  );
}

function SecaoCard({
  icone,
  titulo,
  corIcone = "bg-primary/10 text-primary",
  children,
}: {
  icone: ReactNode;
  titulo: string;
  corIcone?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${corIcone}`}>
            {icone}
          </div>
          <h2 className="text-base font-semibold">{titulo}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function PassoInstalacao({
  numero,
  titulo,
  destaque,
  children,
}: {
  numero: number;
  titulo: string;
  destaque?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
          destaque ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {numero}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="text-sm font-medium">{titulo}</div>
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function ArquivosSeparados() {
  const [aberto, setAberto] = useState(false);
  const arquivos = [
    { nome: "hemc-print-agent.ps1", desc: "O agente em si" },
    { nome: "iniciar-agente-oculto.vbs", desc: "Lançador invisível" },
    { nome: "registrar-agente.ps1", desc: "Cria a tarefa agendada" },
    { nome: "configurar-agente.bat", desc: "Executa a instalação" },
  ];
  return (
    <Collapsible open={aberto} onOpenChange={setAberto}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} />
          Precisa baixar um arquivo separado (ex.: pra substituir só um)?
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {arquivos.map((a) => (
            <Button
              key={a.nome}
              variant="outline"
              size="sm"
              className="h-auto justify-start py-2"
              onClick={() => baixarArquivoEstatico(`/agente-impressao/${a.nome}`, a.nome)}
            >
              <Download className="mr-2 h-3.5 w-3.5 shrink-0" />
              <div className="text-left">
                <div className="text-xs font-medium">{a.nome}</div>
                <div className="text-xs text-muted-foreground">{a.desc}</div>
              </div>
            </Button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PaginaAgente() {
  return (
    <div>
      <PageHeader
        titulo="Agente de Impressão"
        descricao="Instalação do agente local que permite imprimir etiquetas direto, sem diálogo."
      />

      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <SecaoCard icone={<Cpu className="h-4 w-4" />} titulo="O que é isso?">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Por segurança, nenhum navegador permite que um site escreva direto numa porta de
            impressora (como <Codigo>LPT1</Codigo>). O <strong>Agente de Impressão HEMC</strong> é
            um script próprio — não é da Zebra nem de terceiros — que roda em segundo plano no
            computador e faz essa ponte. É o que permite o botão <strong>"Imprimir agora"</strong>{" "}
            mandar a etiqueta direto pra impressora, sem abrir nenhuma caixa de diálogo.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Precisa ser instalado <strong>uma vez em cada computador</strong> que for imprimir
            etiquetas. Depois de instalado, inicia sozinho a cada login do usuário, de forma
            totalmente invisível — sem janela, sem nada pra fechar ou mexer sem querer.
          </p>
        </SecaoCard>

        <SecaoCard icone={<Download className="h-4 w-4" />} titulo="Baixar os arquivos">
          <p className="text-sm text-muted-foreground">
            Um clique baixa os 4 juntos, num só arquivo <Codigo>.zip</Codigo>. Extraia o conteúdo
            direto na pasta <Codigo>C:\HEMC\agente-impressao\</Codigo>.
          </p>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() =>
              baixarArquivoEstatico(
                "/agente-impressao/agente-impressao-completo.zip",
                "agente-impressao-completo.zip",
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Baixar tudo (.zip)
          </Button>

          <ArquivosSeparados />
        </SecaoCard>

        <SecaoCard icone={<Terminal className="h-4 w-4" />} titulo="Passo a passo de instalação">
          <ol className="space-y-4">
            <PassoInstalacao numero={1} titulo="Confirme que a impressora já está mapeada">
              A porta da impressora precisa estar mapeada como <Codigo>LPT1</Codigo> neste
              computador — o comando{" "}
              <Codigo>net use lpt1 \\SERVIDOR\COMPARTILHAMENTO /persistent:yes</Codigo> que a TI já
              usa em outros setores. O agente não faz esse mapeamento sozinho, só usa o que já
              existe.
            </PassoInstalacao>

            <PassoInstalacao numero={2} titulo="Extraia o .zip numa pasta fixa">
              Crie a pasta <Codigo>C:\HEMC\agente-impressao\</Codigo> e extraia o conteúdo do{" "}
              <Codigo>.zip</Codigo> baixado direto ali dentro (os 4 arquivos juntos).
            </PassoInstalacao>

            <PassoInstalacao
              numero={3}
              titulo="Dê duplo clique em configurar-agente.bat"
              destaque
            >
              Esse é o único passo manual de verdade. Ele cria a Tarefa Agendada do Windows — não
              precisa ser administrador do computador pra isso, só o usuário comum que vai usar a
              impressora. Uma janela preta abre, mostra "Tarefa criada com sucesso" e fecha
              sozinha depois de você apertar uma tecla.
            </PassoInstalacao>

            <PassoInstalacao numero={4} titulo="Teste sem precisar deslogar">
              Aperte <Tecla>Win</Tecla> + <Tecla>R</Tecla>, digite{" "}
              <Codigo>taskschd.msc</Codigo> e aperte Enter — abre o Agendador de Tarefas do
              Windows. Procure <Codigo>HEMC - Agente de Impressao</Codigo> na lista, clique com o
              botão direito e escolha <strong>"Executar"</strong>. Isso já inicia o agente
              agora, sem precisar reiniciar o computador.
            </PassoInstalacao>

            <PassoInstalacao numero={5} titulo="Confirme no sistema" destaque>
              Volte pro Padrão HEMC, abra "Imprimir etiqueta" — deve aparecer{" "}
              <strong>"Agente de impressão conectado"</strong>. Pronto: a partir de agora ele
              inicia sozinho a cada login deste usuário, sem nenhuma janela visível, e reinicia
              automaticamente se cair por algum motivo.
            </PassoInstalacao>
          </ol>
        </SecaoCard>

        <SecaoCard
          icone={<AlertTriangle className="h-4 w-4" />}
          titulo="Problemas comuns"
          corIcone="bg-warning/10 text-warning"
        >
          <div className="space-y-4 text-sm">
            <div>
              <div className="font-medium">"Erro de sistema 66" ao rodar o net use</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                O compartilhamento não é do tipo impressora. Rode{" "}
                <Codigo>net view \\SERVIDOR</Codigo> e procure a coluna "Type" — precisa aparecer{" "}
                <Codigo>Print</Codigo>, não <Codigo>Disk</Codigo>.
              </p>
            </div>
            <div>
              <div className="font-medium">Sistema mostra "Agente não encontrado"</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Abra o Agendador de Tarefas (<Codigo>taskschd.msc</Codigo>), ache{" "}
                <Codigo>HEMC - Agente de Impressao</Codigo> e confira a coluna "Status" —
                se não estiver "Em execução", clique com o botão direito e escolha "Executar".
              </p>
            </div>
            <div>
              <div className="font-medium">Funcionou no passo 4, mas amanhã não conecta mais</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                O passo 3 (rodar <Codigo>configurar-agente.bat</Codigo>) não chegou a ser feito, ou
                deu erro — sem ele, a tarefa nunca foi criada de verdade, e o agente não inicia
                sozinho no próximo login.
              </p>
            </div>
            <div>
              <div className="font-medium">Preciso desinstalar de um computador</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Abra o Agendador de Tarefas (<Codigo>taskschd.msc</Codigo>), ache{" "}
                <Codigo>HEMC - Agente de Impressao</Codigo>, botão direito → Excluir. Não precisa
                mexer em nenhum outro lugar do Windows.
              </p>
            </div>
          </div>
        </SecaoCard>
      </div>
    </div>
  );
}