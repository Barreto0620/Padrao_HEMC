import { Extension } from "@tiptap/core";
import "@tiptap/extension-text-style";

// Mesma técnica do tiptap-font-size.ts: estende o mark "textStyle" (que já
// está instalado) em vez de depender do pacote oficial @tiptap/extension-
// color — evita mais uma instalação de dependência.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (cor: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

export const TextColor = Extension.create({
  name: "textColor",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.color || null,
            renderHTML: (attributes: { color?: string | null }) => {
              if (!attributes.color) return {};
              return { style: `color: ${attributes.color}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextColor:
        (cor: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { color: cor }).run(),
      unsetTextColor:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { color: null }).removeEmptyTextStyle().run(),
    };
  },
});