/**
 * Alerta opcional de definição matemática (Notification API do navegador). A permissão só é pedida depois de
 * um clique explícito; o aviso dispara no máximo uma vez por eleição (chave no localStorage, sempre em
 * try/catch: modo privado ou armazenamento bloqueado não quebram a página).
 */

const optInKey = (electionCode: number) => `repbrasil-live-math-alert-${electionCode}`;
const firedKey = (electionCode: number) => `repbrasil-live-math-alert-fired-${electionCode}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // armazenamento indisponível: o alerta continua valendo só nesta aba
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isOptedIn(electionCode: number): boolean {
  return notificationsSupported() && Notification.permission === "granted" && read(optInKey(electionCode)) === "1";
}

/** Pede a permissão (só a partir de um clique) e registra a escolha desta eleição. */
export async function optIn(electionCode: number): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission === "granted") write(optInKey(electionCode), "1");
  return permission;
}

export function optOut(electionCode: number): void {
  write(optInKey(electionCode), "0");
}

/** Dispara o aviso de definição matemática uma única vez por eleição. Texto neutro, sem nome de vencedor. */
export function notifyMathematicallyDefined(electionCode: number, body: string): boolean {
  if (!isOptedIn(electionCode) || read(firedKey(electionCode)) === "1") return false;
  write(firedKey(electionCode), "1");
  try {
    new Notification("Eleição matematicamente definida", { body, tag: `repbrasil-math-${electionCode}` });
    return true;
  } catch {
    return false;
  }
}
