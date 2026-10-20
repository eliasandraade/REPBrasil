import type { Metadata } from "next";
import { NotificationsSection } from "@/components/account/NotificationsSection";

export const metadata: Metadata = { title: "Notificações" };

export default function Page() {
  return <NotificationsSection />;
}
