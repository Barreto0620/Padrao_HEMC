import type { ReactNode } from "react";

export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b bg-card px-4 py-4 md:px-8 md:py-6">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold truncate">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
        ) : null}
      </div>
      {acoes ? <div className="shrink-0 flex flex-wrap gap-2 justify-end">{acoes}</div> : null}
    </div>
  );
}
