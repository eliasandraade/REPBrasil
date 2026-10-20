import type { Metadata } from "next";
import { SavedSection } from "@/components/account/SavedSection";

export const metadata: Metadata = { title: "Favoritos" };

export default function Page() {
  return <SavedSection collection="favorite" />;
}
