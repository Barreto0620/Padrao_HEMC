import { createFileRoute, Outlet } from "@tanstack/react-router";

// Este arquivo é o layout PAI de tudo que fica sob /documentos/* (inclusive
// /documentos/editor). Ele só precisa passar a rota filha adiante — o
// conteúdo real de "Biblioteca de Documentos" (quando alguém está
// exatamente em /documentos, sem nada depois) mora em documentos/index.tsx.
// Sem o <Outlet /> aqui, o placeholder deste arquivo aparecia por cima de
// QUALQUER rota filha, inclusive o editor — foi exatamente esse bug que
// impedia o /documentos/editor de renderizar.
export const Route = createFileRoute("/_authenticated/documentos")({
  component: () => <Outlet />,
});