import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { FilePlus2 } from "lucide-react";

// Observação: este arquivo fica em documentos/editor/index.tsx (não
// documentos/editor.tsx) só para não ter dois arquivos chamados "editor.tsx"
// no projeto (o outro é src/routes/_authenticated/editor.tsx, do editor de
// etiquetas). A rota final continua sendo /documentos/editor — só o local
// em disco mudou, nada de comportamento.
export const Route = createFileRoute("/_authenticated/documentos/editor/")({
  head: () => ({
    meta: [
      { title: "Editor de Documentos — Padrão HEMC" },
      { name: "description", content: "Editor de documentos institucionais do Padrão HEMC." },
    ],
  }),
  component: EditorDocumentos,
});

function EditorDocumentos() {
  return (
    <div>
      <PageHeader
        titulo="Editor de Documentos"
        descricao="Criação e padronização de documentos institucionais."
      />
      <div className="p-4 md:p-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <FilePlus2 className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold">Módulo em desenvolvimento</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Em breve você poderá criar e padronizar documentos institucionais
              (formato .odt, compatível com Word e LibreOffice) diretamente por aqui.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}