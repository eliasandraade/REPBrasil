import type { Metadata } from "next";
import { ProfileSection } from "@/components/account/ProfileSection";

export const metadata: Metadata = { title: "Perfil" };

export default function Page() {
  return <ProfileSection />;
}
