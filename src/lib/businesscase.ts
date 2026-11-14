/** Business-case arithmetic for the Demo page. Inputs are editable assumptions. Subscription prices are deliberately not part of it. */

/** Subscription tiers by name and content only: prices are not disclosed anywhere in the product or pitch material. */
export const TIERS = [
  { name: "Starter", includes: "Limited product monitoring, competitor comparisons, daily updates." },
  { name: "Business", includes: "Adds retailer coverage, promotion alerts, price history, automated reports and category intelligence." },
] as const;

export const WEEKS = 52;

export interface CaseInputs {
  products: number;
  stores: number;
  perWeek: number;
  minutes: number;
  hourly: number;
  sharePct: number;
}

export interface CaseResult {
  fullChecks: number;
  fullHours: number;
  fullCost: number;
  todayChecks: number;
  todayHours: number;
  todayCost: number;
  coverageMultiple: number | null;
}

/** Pure arithmetic, shared by the page (headline numbers) and the calculator. */
export function computeCase(i: CaseInputs): CaseResult {
  const fullChecks = i.products * i.stores * i.perWeek * WEEKS;
  const fullHours = (fullChecks * i.minutes) / 60;
  const fullCost = fullHours * i.hourly;
  const share = i.sharePct / 100;
  const todayChecks = fullChecks * share;
  const todayHours = fullHours * share;
  const todayCost = fullCost * share;
  return {
    fullChecks,
    fullHours,
    fullCost,
    todayChecks,
    todayHours,
    todayCost,
    coverageMultiple: share > 0 ? 1 / share : null,
  };
}

const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
export const fmt = (n: number) => nf0.format(Math.round(n));
export const fmtEur = (n: number) => `${n < 0 ? "−" : ""}€${nf0.format(Math.round(Math.abs(n)))}`;

