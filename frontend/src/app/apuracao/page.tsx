import { redirect } from "next/navigation";

/** A central de apuração aponta para a eleição em acompanhamento. */
export default function ApuracaoIndex() {
  redirect("/apuracao/2026/presidente/segundo-turno");
}
