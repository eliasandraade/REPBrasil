/** Chave e script de inicialização do tema — módulo de servidor (usado no <head> do layout). */

export const THEME_STORAGE_KEY = "repbrasil-theme";

/** Script síncrono no <head>: marca `html.js` e aplica o tema antes de pintar (sem "flash"). */
export const THEME_BOOTSTRAP = `(function(){var d=document.documentElement;d.classList.add('js');try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='light'&&p!=='dark')p='system';var r=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;d.dataset.theme=r;d.dataset.themePref=p;}catch(e){}})();`;
