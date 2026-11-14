import { ArrowDownRight, ArrowUpRight, EyeOff, Scale, Tag, TagsIcon } from "lucide-react";
import type { AlertRow } from "@/lib/analytics";
import { Price, SourceLink, cls, stamp } from "./ui";

const ICON = {
  price_decrease: ArrowDownRight,
  price_increase: ArrowUpRight,
  promo_started: Tag,
  promo_ended: TagsIcon,
  left_offer_page: EyeOff,
  position_changed: Scale,
} as const;

const KIND_LABEL: Record<string, string> = {
  price_decrease: "Price decreased",
  price_increase: "Price increased",
  promo_started: "New promotion",
  promo_ended: "Promotion ended",
  left_offer_page: "No longer shown online",
  position_changed: "Relative position changed",
};

export function AlertItem({ a, company, compact }: { a: AlertRow; company: string; compact?: boolean }) {
  const Icon = ICON[a.kind as keyof typeof ICON] ?? Tag;
  const own = a.company === company;
  const outside = !a.segment && a.kind !== "position_changed";
  const before = a.before as { price?: number; promoLabel?: string; capturedAt?: string } | null;
  const after = a.after as { price?: number; promoLabel?: string; capturedAt?: string } | null;
  return (
    <li className={cls("px-4 py-3", outside && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className={cls(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
            a.kind === "price_decrease" || a.kind === "promo_started" ? "bg-sunbg text-sun" : a.kind === "price_increase" ? "bg-berrybg text-berry" : "bg-raised text-mute",
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-medium text-ink-2">{KIND_LABEL[a.kind] ?? a.kind}</span>
            {a.origin === "replay" ? (
              <span className="chip border-violet/30 bg-violetbg text-violet">Replay · recorded {stamp(a.observedAt)}</span>
            ) : (
              <span className="chip border-leaf/30 bg-mint text-leaf">Context.dev monitor</span>
            )}
            {own ? <span className="chip border-tag/30 bg-tagbg text-tag">Your brand</span> : a.brand && <span className="chip text-mute">Competitor · {a.company}</span>}
            {outside && <span className="chip text-faint">Outside tracked category · low priority</span>}
          </div>
          <div className="mt-1 text-[13px] text-ink">{a.title}</div>
          {!compact && a.why && <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{a.why}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
            {(before || after) && (
              <span className="num">
                {before?.price != null ? <Price value={before.price} className="text-ink-2" /> : "not listed"}
                {before?.promoLabel && <span className="text-faint"> ({before.promoLabel})</span>}
                <span className="mx-1 text-faint">→</span>
                {after?.price != null ? <Price value={after.price} className="text-ink" /> : <span className="text-ink-2">not shown</span>}
                {after?.promoLabel && <span className="text-faint"> ({after.promoLabel})</span>}
              </span>
            )}
            {a.storeName && <span>{a.storeName}</span>}
            <span>{stamp(a.observedAt ?? a.createdAt)}</span>
            <SourceLink url={a.sourceUrl} />
          </div>
        </div>
      </div>
    </li>
  );
}
