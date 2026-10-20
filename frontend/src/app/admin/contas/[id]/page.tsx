import type { Metadata } from "next";
import { AdminUserDetailView } from "@/components/admin/AdminUserDetailView";

export const metadata: Metadata = { title: "Conta" };

export default async function Page({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <AdminUserDetailView id={id} />;
}
