import type { Metadata } from "next";
import { PlansPage } from "@/components/account/PlansPage";

export const metadata: Metadata = {
  title: "Planos",
  description:
    "Planos Gratuito, Avançado e Profissional. O dado público essencial continua aberto a todos; os planos acrescentam profundidade, alertas e ferramentas profissionais.",
};

export default function Page() {
  return <PlansPage />;
}
