import { companies, latestRows, DEFAULT_SCOPE } from "./analytics";
import { DEMO_CATEGORY } from "./taxonomy";

/** The signed-in customer account. Delta shows one company's view; there is no company switcher. */
export const ACCOUNT_COMPANY = "Fazer";
/** Kept for existing imports. */
export const DEFAULT_COMPANY = ACCOUNT_COMPANY;

/** Page data for the account company. A `?company=` parameter is ignored. */
export async function pageContext(searchParams: Promise<Record<string, string | string[] | undefined>>) {
  const sp = await searchParams;
  const rows = latestRows(DEFAULT_SCOPE);
  const cos = companies(rows);
  const company = ACCOUNT_COMPANY;
  return { sp, rows, companies: cos, company, companyInfo: cos.find((c) => c.name === company) ?? { name: company, brands: [company], products: 0 }, category: DEMO_CATEGORY };
}
