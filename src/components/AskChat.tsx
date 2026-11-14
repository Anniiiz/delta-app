"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUp, RotateCcw } from "lucide-react";
import { cls } from "./ui";

interface Source {
  label: string;
  href: string;
}
interface Msg {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  tools?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Where is the Dumle advent calendar most expensive?",
  "Which of my products have the widest price spread?",
  "Which of my promotions end this week?",
  "What is Marabou running against me right now?",
  "Am I cheaper at S Group or K Group?",
  "What is happening in my area?",
];

/** Human names for the lookups the assistant ran (tool names come from src/lib/ask.ts). */
const TOOL_LABEL: Record<string, string> = {
  account_summary: "account summary",
  search_products: "product search",
  product_detail: "product detail",
  list_promotions: "promotions",
  price_spreads: "price spreads",
  chain_comparison: "S Group vs K Group",
  listing_coverage: "store coverage",
  my_area: "my area",
};

const MAX_LEN = 500;

export function AskChat() {
  const [thread, setThread] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || q.length > MAX_LEN) return;
    const history = thread.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setThread((t) => [...t, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", text: q }].slice(-8) }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; sources?: Source[]; tools?: string[]; error?: string };
      if (!res.ok || !data.answer) throw new Error(data.error ?? `Request failed (${res.status})`);
      setThread((t) => [...t, { role: "assistant", text: data.answer!, sources: data.sources ?? [], tools: data.tools ?? [] }]);
    } catch (e) {
      setThread((t) => [...t, { role: "assistant", text: (e as Error).message || "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const empty = thread.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {empty ? (
        <div className="pt-2">
          <div className="label mb-2">Try asking</div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="btn-soft h-auto min-h-8 whitespace-normal py-1.5 text-left text-[13px]">
                {s}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-faint">Answers come from the captured retailer pages (13 to 14 Nov 2026, Helsinki and Espoo). No sales volumes, margins or stock.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-4" aria-live="polite">
          {thread.map((m, i) => (
            <li key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-ink">{m.text}</div>
              ) : (
                <div className={cls("card max-w-full min-w-0 px-4 py-3 sm:max-w-[92%]", m.error && "border-berry/30 bg-berrybg")}>
                  {m.error ? <p className="text-[13px] text-berry">{m.text}</p> : <Answer text={m.text} />}
                  {!!m.sources?.length && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                      <span className="text-xs text-mute">Open in delta.</span>
                      {m.sources.map((s) => (
                        <Link key={s.href} href={s.href} className="chip max-w-full text-ink-2 hover:border-tag/40 hover:text-tag" title={s.href}>
                          <span className="truncate">{s.label}</span>
                          <ArrowRight size={11} aria-hidden className="shrink-0" />
                        </Link>
                      ))}
                    </div>
                  )}
                  {!!m.tools?.length && <div className="mt-1.5 text-[11px] text-faint">Looked up: {m.tools.map((t) => TOOL_LABEL[t] ?? t).join(", ")}</div>}
                </div>
              )}
            </li>
          ))}
          {busy && (
            <li className="flex justify-start" role="status">
              <div className="card flex items-center gap-2 px-4 py-3 text-[13px] text-mute">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-tag" aria-hidden />
                Looking it up in the captured data…
              </div>
            </li>
          )}
        </ol>
      )}
      <div ref={endRef} className="h-px" />

      <form
        className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mt-4 md:bottom-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-line bg-raised p-2 shadow-2xl focus-within:border-tag/50">
          <label htmlFor="ask-input" className="sr-only">
            Ask a question about your products
          </label>
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_LEN}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your prices, promotions or stores…"
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] text-ink outline-none placeholder:text-faint"
          />
          {!empty && (
            <button type="button" className="btn-ghost h-8 min-h-8 px-2" onClick={() => setThread([])} disabled={busy} aria-label="New conversation" title="New conversation">
              <RotateCcw size={14} aria-hidden />
            </button>
          )}
          <button type="submit" className="btn-leaf h-8 min-h-8 px-2.5" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp size={15} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ minimal, safe markdown → React

/** **bold** inside a line; everything else is plain text (React escapes it). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={m.index} className="font-semibold text-ink">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length)
      blocks.push(
        <p key={blocks.length}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l)}
            </Fragment>
          ))}
        </p>,
      );
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(
        list.ordered ? (
          <ol key={blocks.length} className="list-decimal space-y-1 pl-5 marker:text-faint">
            {items}
          </ol>
        ) : (
          <ul key={blocks.length} className="list-disc space-y-1 pl-5 marker:text-faint">
            {items}
          </ul>
        ),
      );
    }
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list = list ?? { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#+\s*/, ""));
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2 break-words text-[14px] leading-relaxed text-ink-2">{blocks}</div>;
}
