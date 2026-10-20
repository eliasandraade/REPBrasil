import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAudit } from "@/components/admin/AdminAudit";

export const metadata: Metadata = { title: "Auditoria" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AdminAudit />
    </Suspense>
  );
}
