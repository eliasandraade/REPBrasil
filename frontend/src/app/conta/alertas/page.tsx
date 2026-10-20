import type { Metadata } from "next";
import { AlertsSection } from "@/components/account/AlertsSection";

export const metadata: Metadata = { title: "Alertas" };

export default function Page() {
  return <AlertsSection />;
}
