import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const metadata: Metadata = { title: "Contas" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AdminUsers />
    </Suspense>
  );
}
