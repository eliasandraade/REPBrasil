import type { Metadata } from "next";
import { AdminSubscriptions } from "@/components/admin/AdminSubscriptions";

export const metadata: Metadata = { title: "Assinaturas" };

export default function Page() {
  return <AdminSubscriptions />;
}
