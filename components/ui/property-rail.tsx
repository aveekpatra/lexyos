"use client";

/**
 * Properties rail vocabulary shared by every detail surface (task, project).
 * One row geometry: 36px capsule, label left, one value pill right. Filled and
 * empty pills share the same geometry so rows never jog.
 */

export function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 px-3 text-[12px] font-semibold text-text-secondary">{children}</h2>
  );
}

export function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid h-9 grid-cols-[84px_minmax(0,1fr)] items-center rounded-full px-3 transition-colors hover:bg-hover">
      <span className="text-[13px] text-text-muted">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

/** Radial progress ring. `size` in px; label defaults to the percentage. */
export function RadialProgress({ value, total, size = 64, stroke = 6, label }: { value: number; total: number; size?: number; stroke?: number; label?: React.ReactNode }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-black/[0.07] dark:stroke-white/[0.1]" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className={`fill-none ${pct >= 1 ? "stroke-emerald-500" : "stroke-brand"} transition-[stroke-dashoffset] duration-500`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="relative text-[12px] font-semibold tabular-nums text-text-strong">{label ?? `${Math.round(pct * 100)}%`}</span>
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}
