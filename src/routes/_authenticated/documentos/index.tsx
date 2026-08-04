import { createFileRoute } from "@tanstack/react-router";
import { FileText, Hammer } from "lucide-react";

// Fica em /documentos (a "Biblioteca de Documentos" do menu) — migrado de
// documentos.tsx, que agora é só o layout pai (ver documentos.tsx).
export const Route = createFileRoute("/_authenticated/documentos/")({
  head: () => ({
    meta: [
      { title: "Documentos — Padrão HEMC" },
      { name: "description", content: "Módulo de documentos institucionais do Padrão HEMC." },
    ],
  }),
  component: PaginaDocumentos,
});

function PaginaDocumentos() {
  return (
    <div className="p-6 md:p-10 min-h-full grid place-items-center">
      <div className="max-w-lg text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-muted mb-6">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold flex items-center justify-center gap-2">
          Documentos institucionais
          <Hammer className="h-5 w-5 text-warning" />
        </h1>
        <p className="mt-3 text-muted-foreground">
          Módulo em desenvolvimento. Em breve você poderá criar e padronizar documentos institucionais aqui.
        </p>
      </div>
    </div>
  );
}