/** Shown while a page is being prepared (first visits and page switches): an animated Δ and skeleton cards. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 pt-1">
        <span className="delta-loader" aria-hidden>
          <svg viewBox="0 0 32 32" width="28" height="28">
            <path d="M16 4 L29 27 H3 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <div className="text-[15px] font-medium text-ink">Loading your shelf data…</div>
          <div className="loader-bar mt-1.5 h-1 w-48 overflow-hidden rounded-full bg-raised" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card skeleton h-[74px]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="card skeleton h-64" />
        <div className="card skeleton h-64" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
