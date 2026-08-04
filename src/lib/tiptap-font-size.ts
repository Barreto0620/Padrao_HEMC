import { Extension } from "@tiptap/core";
import "@tiptap/extension-text-style";

// A extensão oficial (@tiptap/extension-font-size) só existe em versão
// "next" instável no momento em que isso foi escrito — em vez de depender
// de um pré-lançamento, implementamos a mesma coisa aqui, seguindo o
// padrão documentado oficialmente pelo TipTap pra estender o TextStyle.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (tamanho: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (tamanho: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: tamanho }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});