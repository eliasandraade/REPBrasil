import type { Metadata } from "next";
import { AdminApiCatalog } from "@/components/admin/AdminApiCatalog";

export const metadata: Metadata = { title: "API" };

export default function Page() {
  return <AdminApiCatalog />;
}
