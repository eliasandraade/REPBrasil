import type { MetadataRoute } from "next";
import { INDEXING, SITE_URL } from "@/lib/site";

/** Sem indexação explícita (NEXT_PUBLIC_ALLOW_INDEXING=true + NEXT_PUBLIC_SITE_URL), bloqueia tudo. */
export default function robots(): MetadataRoute.Robots {
  if (!INDEXING || !SITE_URL) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
