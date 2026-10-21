import type { Metadata } from "next";
import { AdminSupport } from "@/components/admin/AdminSupport";

export const metadata: Metadata = { title: "Suporte" };

export default function Page() {
  return <AdminSupport />;
}
