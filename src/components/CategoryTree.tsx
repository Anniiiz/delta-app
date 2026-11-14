import Link from "next/link";
import type { ReactNode } from "react";
import type { CategoryNode } from "@/lib/favourites";
import { FavButton } from "./FavButton";
import { Card, cls } from "./ui";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Categories card: each category with its subcategories, a star on both levels and product counts. */
export function CategoryTree({
  tree,
  catHref,
  subHref,
  active,
  right,
  sub,
}: {
  tree: CategoryNode[];
  catHref: (category: string) => string;
  subHref: (subcategory: string) => string;
  active?: { cat?: string | null; sub?: string | null };
  right?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card id="categories" title="Categories" sub={sub} right={right} pad={false}>
      <div className="grid gap-px overflow-hidden rounded-b-lg bg-line sm:grid-cols-2 xl:grid-cols-4">
        {tree.map((c) => (
          <div key={c.name} className="min-w-0 bg-card px-2 py-2.5">
            <div className="flex items-center gap-0.5">
              <FavButton kind="category" id={c.name} on={c.on} label={`the ${c.name} category`} />
              <Link
                href={catHref(c.name)}
                className={cls("min-w-0 truncate text-[13px] font-semibold hover:text-tag", active?.cat === c.name ? "text-tag" : "text-ink")}
                aria-current={active?.cat === c.name ? "true" : undefined}
              >
                {c.name}
              </Link>
            </div>
            <div className="pl-[30px] text-xs text-mute">
              {plural(c.subcategories.length, "subcategory", "subcategories")} · {plural(c.products, "product")}
              {c.inArea > 0 && <span className="text-tag"> · {c.inArea} in my area</span>}
            </div>
            <ul className="mt-1">
              {c.subcategories.map((s) => (
                <li key={s.name} className="flex items-center gap-0.5">
                  <FavButton kind="subcategory" id={s.name} on={s.on} implied={c.on ? c.name : undefined} label={s.name} />
                  <Link
                    href={subHref(s.name)}
                    className={cls("min-w-0 flex-1 truncate text-[13px] hover:text-tag", active?.sub === s.name ? "text-tag" : "text-ink-2")}
                    aria-current={active?.sub === s.name ? "true" : undefined}
                    title={`Show ${s.name} products`}
                  >
                    {s.name}
                  </Link>
                  <span className="num pr-1.5 text-xs text-faint" title={`${plural(s.products, "product")}${s.starred ? `, ${s.starred} starred` : ""}`}>
                    {s.starred > 0 && <span className="text-tag">{s.starred}★ </span>}
                    {s.products}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
