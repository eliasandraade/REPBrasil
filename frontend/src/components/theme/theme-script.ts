/** Chave e script de inicialização do tema — módulo de servidor (usado no <head> do layout). */

export const THEME_STORAGE_KEY = "repbrasil-theme";

/**
 * Script síncrono no <head> (public/theme-init.js): marca `html.js` e aplica o tema antes de pintar (sem
 * "flash"). Arquivo estático do próprio domínio em vez de HTML inline: nada de dangerouslySetInnerHTML e
 * compatível com uma Content-Security-Policy sem 'unsafe-inline'.
 */
export const THEME_INIT_SRC = "/theme-init.js";
