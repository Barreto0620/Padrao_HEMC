import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Tema = "light" | "dark";

const CHAVE_TEMA = "hemc-theme";

interface ThemeContextValue {
  tema: Tema;
  alternarTema: () => void;
  definirTema: (tema: Tema) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Lê o tema inicial a partir da classe já aplicada em <html> pelo script
 * bloqueante em __root.tsx (roda antes da hidratação, evita flash de tema
 * errado). Não lê localStorage aqui de novo — a classe já reflete a
 * preferência salva (ou o padrão "dark", institucional).
 */
function lerTemaAtual(): Tema {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(lerTemaAtual);

  useEffect(() => {
    const root = document.documentElement;
    if (tema === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      window.localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      // localStorage indisponível (modo privado, por exemplo) — a escolha
      // simplesmente não persiste entre sessões, sem impacto funcional.
    }
  }, [tema]);

  function alternarTema() {
    setTema((atual) => (atual === "dark" ? "light" : "dark"));
  }

  return (
    <ThemeContext.Provider value={{ tema, alternarTema, definirTema: setTema }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const contexto = useContext(ThemeContext);
  if (!contexto) {
    throw new Error("useTheme precisa ser usado dentro de <ThemeProvider>.");
  }
  return contexto;
}

/**
 * Script bloqueante para colar em __root.tsx, dentro de <head>, ANTES de
 * <HeadContent />. Roda de forma síncrona no servidor->cliente, antes da
 * primeira pintura — sem isso, a página abriria sempre no tema padrão por
 * uma fração de segundo antes de trocar pro tema salvo (flash visível).
 * Padrão institucional: escuro, a menos que "light" esteja salvo.
 */
export const SCRIPT_TEMA_INICIAL = `(function(){try{var t=localStorage.getItem('${CHAVE_TEMA}');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;