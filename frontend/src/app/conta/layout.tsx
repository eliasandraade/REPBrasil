import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountHub } from "@/components/account/AccountHub";

export const metadata: Metadata = {
  title: { default: "Sua conta", template: "%s · Conta · REPBrasil" },
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AccountHub>{children}</AccountHub>;
}
