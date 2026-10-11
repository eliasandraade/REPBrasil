/*
 * REPBrasil — inicialização do tema, carregada de forma síncrona no <head> (antes da primeira pintura).
 * Marca `html.js` (estados de revelação só existem com JS) e aplica `data-theme` com o tema resolvido
 * a partir da preferência salva ("light" | "dark" | sistema), sem "flash" de tema errado.
 * Arquivo estático do próprio domínio: nada de script inline (compatível com uma CSP sem 'unsafe-inline').
 * A chave precisa ser igual a THEME_STORAGE_KEY (src/components/theme/theme-script.ts) — há teste para isso.
 */
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  try {
    var p = window.localStorage.getItem("repbrasil-theme");
    if (p !== "light" && p !== "dark") p = "system";
    var r = p === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : p;
    d.dataset.theme = r;
    d.dataset.themePref = p;
  } catch (e) {
    // armazenamento bloqueado (modo privado, política do navegador): fica o tema do sistema via CSS
  }
})();
