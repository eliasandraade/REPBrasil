import type { Metadata } from "next";
import { PlansPage } from "@/components/account/PlansPage";

export const metadata: Metadata = {
  title: "Planos",
  description:
    "Gratuito, Avançado (R$ 24,90/mês) e Profissional (R$ 69,90/mês). O dado público essencial continua aberto a todos; os planos acrescentam profundidade, alertas e ferramentas profissionais.",
};

export default function Page() {
  return <PlansPage />;
}
