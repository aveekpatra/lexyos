"use client";

/**
 * Properties rail vocabulary shared by every detail surface (task, project).
 * One row geometry: 36px capsule, label left, one value pill right. Filled and
 * empty pills share the same geometry so rows never jog.
 */

export function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 px-3 text-[12px] font-medium uppercase tracking-[0.06em] text-text-faint">{children}</h2>
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

export function Dot({ color }: { color: string }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}
