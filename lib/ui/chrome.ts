/**
 * Shared "control chrome" vocabulary — the Apple Liquid Glass language.
 *
 * Layering law (Apple HIG): floating CONTROLS get frosted glass (blur + white
 * rim + soft shadow); CONTENT (chips, cards, list rows) stays flat with a
 * tinted fill only. `.glass-control` / `.glass-surface` live in globals.css.
 */

/** Frosted capsule action button (sort / filter / toolbar controls). */
export const glassAction =
  "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium " +
  "text-foreground/85 hover:text-foreground glass-control active:translate-y-px " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-[color,background-color,transform]";

/** Active/on state for a glassAction toggle — the stronger white fill (Aturno). */
export const glassActionActive =
  "!bg-white/90 supports-[backdrop-filter]:!bg-white/90 !text-foreground " +
  "dark:!bg-white/20 dark:supports-[backdrop-filter]:!bg-white/20";

/** Frosted circular icon button. */
export const glassIconButton =
  "inline-flex items-center justify-center size-7 rounded-full text-foreground/70 " +
  "hover:text-foreground glass-control active:translate-y-px transition-[color,background-color,transform]";

/** Primary brand capsule (blue) — the one saturated control. */
export const bluePill =
  "inline-flex items-center gap-1.5 h-7 px-3.5 rounded-full text-xs font-medium " +
  "bg-brand text-white hover:bg-brand-strong active:translate-y-px transition-colors " +
  "shadow-[0_1px_3px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.2)]";

/** Flat recessed content pill (no glass) — for chips / soft toggles. */
export const softPill =
  "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium select-none " +
  "bg-black/[0.04] text-foreground/80 hover:bg-black/[0.07] hover:text-foreground " +
  "dark:bg-white/[0.06] dark:hover:bg-white/[0.1] transition-colors";

/** Floating glass menu / popover surface. */
export const glassMenuSurface =
  "rounded-[20px] glass-surface p-1.5";
