import type { Row as FullRow } from "./analytics";

/** Only the fields the explorer shows, so the page sends far less data to the browser. */
export type ExplorerRow = Pick<
  FullRow,
  "productId" | "name" | "brand" | "company" | "segment" | "ean" | "sizeValue" | "sizeIsRange" | "sizeRaw" | "productUrl" | "imageUrl" | "storeId" | "storeName" | "retailer" | "banner" | "level" | "price" | "unitPrice" | "regularPrice" | "lowest30d" | "flags" | "sourceUrl" | "capturedAt"
> & { promo: { type: string; label: string | null; active: boolean } | null };

export function toExplorerRows(rows: FullRow[]): ExplorerRow[] {
  return rows.map((r) => ({
    productId: r.productId, name: r.name, brand: r.brand, company: r.company, segment: r.segment, ean: r.ean, sizeValue: r.sizeValue, sizeIsRange: r.sizeIsRange,
    sizeRaw: r.sizeRaw, productUrl: r.productUrl, imageUrl: r.imageUrl, storeId: r.storeId, storeName: r.storeName, retailer: r.retailer, banner: r.banner, level: r.level,
    price: r.price, unitPrice: r.unitPrice, regularPrice: r.regularPrice, lowest30d: r.lowest30d, flags: r.flags, sourceUrl: r.sourceUrl, capturedAt: r.capturedAt,
    promo: r.promo ? { type: r.promo.type, label: r.promo.label, active: r.promo.active } : null,
  }));
}
