import type { Metadata } from "next";
import { SecuritySection } from "@/components/account/SecuritySection";

export const metadata: Metadata = { title: "Segurança" };

export default function Page() {
  return <SecuritySection />;
}
