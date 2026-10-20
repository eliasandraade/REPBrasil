import type { Metadata } from "next";
import { PlanSection } from "@/components/account/PlanSection";

export const metadata: Metadata = { title: "Plano" };

export default function Page() {
  return <PlanSection />;
}
