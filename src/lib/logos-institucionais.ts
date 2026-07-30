export interface LogoInstitucional {
  id: string;
  nome: string;
  // Caminho estático dentro de /public — coloque os arquivos reais em
  // public/logos/ com esses mesmos nomes. Formato recomendado: PNG com
  // fundo transparente (ver observação no editor sobre o porquê).
  src: string;
}

export const LOGOS_INSTITUCIONAIS: LogoInstitucional[] = [
  { id: "hemc", nome: "HEMC", src: "/logos/logo_hemc.png" },
  { id: "fuabc", nome: "FUABC", src: "/logos/logo_fuabc.png" },
  { id: "governo-sp", nome: "Governo SP", src: "/logos/logo_sp.png" },
];