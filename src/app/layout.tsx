import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import { companies, latestRows, history, DEFAULT_SCOPE } from "@/lib/analytics";
import { db } from "@/lib/db";
import { hasContextKey } from "@/lib/contextdev";
import { DEMO_CATEGORY } from "@/lib/taxonomy";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Delta: competitive intelligence for FMCG brands",
  description: "Competitor pricing, promotions and assortment changes from retailer websites in one place, kept fresh with Context.dev.",
};
export const viewport: Viewport = { themeColor: "#08090A", colorScheme: "dark", width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const rows = latestRows(DEFAULT_SCOPE);
  const h = history(DEFAULT_SCOPE);
  const one = (sql: string) => (db().prepare(sql).get() as { n: number | null }).n ?? 0;
  const latestInScope = rows.reduce<string | null>((m, r) => (!m || r.capturedAt > m ? r.capturedAt : m), null);
  const info = {
    companies: companies(rows),
    unread: one("SELECT COUNT(*) AS n FROM alerts WHERE read = 0"),
    lastUpdate: latestInScope ?? h.lastCapture,
    replayAlerts: one("SELECT COUNT(*) AS n FROM alerts WHERE origin = 'replay'"),
    hasKey: hasContextKey(),
    liveMonitors: one("SELECT COUNT(*) AS n FROM monitors WHERE origin = 'shelfintel'"),
    scopeLabel: `${DEMO_CATEGORY} · ${new Set(rows.map((r) => r.storeId)).size} panel stores · Helsinki`,
  };
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Shell info={info}>{children}</Shell>
      </body>
    </html>
  );
}
