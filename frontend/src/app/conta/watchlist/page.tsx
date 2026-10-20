import type { Metadata } from "next";
import { SavedSection } from "@/components/account/SavedSection";

export const metadata: Metadata = { title: "Watchlist" };

export default function Page() {
  return <SavedSection collection="watchlist" />;
}
