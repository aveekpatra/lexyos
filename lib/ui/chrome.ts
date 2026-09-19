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

/* ── Entity properties rail ──
   Filled pills reuse `softPill`; this is its dashed counterpart for a field
   with no value. Identical geometry, so filled and empty pills line up. */

/** Empty property pill — dashed placeholder at softPill's geometry. */
export const emptyPill =
  "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium select-none " +
  "border border-dashed border-line-strong text-text-muted " +
  "hover:border-brand-border hover:text-foreground transition-colors";


/* ── Menus and popovers: ONE material, ONE geometry (Aturno, verbatim) ──
   Shell radius 26px = h-9 capsule rows (18px) + p-2 (8px). Every floating
   list (dropdown, context menu, submenu, property popover) uses these. */

/** Frosted menu surface: translucent white over real blur, soft rim, small float. */
export const frostedMenuSurface =
  "border-2 border-white/70 dark:border-white/20 bg-white/65 supports-[backdrop-filter]:bg-white/55 " +
  "backdrop-blur-xl dark:bg-white/10 dark:supports-[backdrop-filter]:bg-white/10 " +
  "shadow-[0_8px_24px_rgba(15,23,42,0.16)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]";

/** The concentric shell: pair with frostedMenuSurface. */
export const menuShell = "rounded-[26px] p-2 space-y-0.5";

/** Capsule row inside a menu shell. No fill of its own: the highlight slides behind it. */
export const menuRow =
  "relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-full px-3.5 text-[13px] " +
  "text-foreground outline-none transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-muted";

/** Recessed input inside a menu shell (a field is inset, never raised). */
export const menuInput =
  "h-9 w-full rounded-full bg-black/[0.04] px-3.5 text-[13px] text-foreground outline-none " +
  "placeholder:text-text-faint dark:bg-white/[0.06]";

/** Section label inside a menu shell. */
export const menuSectionLabel =
  "px-3.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-faint";

/* ── Board columns ──
   Every board (Inbox overview, day, week, month, project) uses one rule:
   columns grow to fill the row when they fit; below the minimum the row
   scrolls sideways. The minimum matches the Inbox overview's comfortable width. */
export const BOARD_COLUMN_WIDTH = "min-w-[300px] flex-1 basis-0";
