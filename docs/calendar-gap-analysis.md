# Calendar gap analysis

Scope: `components/planner/PlannerView.tsx` (time grid + month grid), with the sync
path it drives: `lib/calendar-api.ts`, `lib/google-sync.ts`, `app/actions/calendarSync.ts`,
`convex/tasks.ts`. Reference points: FullCalendar (feature superset) and
react-big-calendar (React-native API). Every finding cites `file:line` as of this commit.

Method: two independent read-throughs of the source (one by hand, one by a separate
agent), reconciled; the highest-severity claims were then re-verified against the
quoted lines before being recorded here.

Abbreviations: PV = PlannerView.tsx, CA = lib/calendar-api.ts, GS = lib/google-sync.ts,
CS = app/actions/calendarSync.ts, CT = convex/tasks.ts, LY = app/(app)/layout.tsx.

---

## 1. Feature matrix vs. FullCalendar / react-big-calendar

| Capability | FullCalendar | RBC | UniFocus | Notes |
|---|---|---|---|---|
| Day / week / month views | yes | yes | **yes** | PV:48, PV:114-123 |
| N-day (custom range) view | yes (custom views) | work_week | **yes** (2-6) | PV:59, PV:567-581 |
| List / agenda view | yes | agenda | **no** | |
| Prev / next / today / date picker | yes | toolbar | **yes** | PV:134-146, 428-444, 584 |
| Title per view (`titleFormat`) | yes | formats | **yes** | PV:399-408 |
| Week numbers | `weekNumbers` | - | no (removed; was week-of-month) | |
| First day of week (`firstDay`) | yes | localizer | hardcoded Monday | PV:117, 773; picker popover follows locale instead (components/ui/calendar.tsx:15-22) |
| Timezone option (`timeZone`) | local/UTC/named | localizer | label only | PV:677; math is local wall-clock |
| Locale / i18n | yes | culture | **no** (en, hardcoded strings) | |
| Now indicator | `nowIndicator` | `getNow` | **yes** (today column only) | PV:1274-1293 |
| Scroll to time on load (`scrollTime`) | yes | `scrollToTime` | yes (now - 2h) | PV:320-329 |
| Slot duration / label interval | `slotDuration` | `step`/`timeslots` | fixed 15-min slots, hourly labels | PV:43-46, 1031-1039 |
| Min/max visible hours (`slotMinTime/MaxTime`) | yes | `min`/`max` | **no** (always 0-24) | PV:44-45 |
| All-day slot / all-day events | `allDaySlot` | `allDayAccessor` | **no** | Google all-day events get no times (CT:439-443) and never render on the grid |
| Multi-day spanning events | yes | `showMultiDayTimes` | **no** | midnight-crossing is clamped, see 2.7 |
| Recurring events | RRule plugin | via events | **no expansion** | task has `recurrence` field but the calendar renders one instance |
| Business hours | `businessHours` | - | **no** | |
| Weekend toggle / hidden days | `weekends`, `hiddenDays` | - | no (weekend tint only) | PV:1008 |
| Event overlap layout | `slotEventOverlap` | `dayLayoutAlgorithm` | **partial** (per-item, not cluster) | PV:1057-1072, see 2.9 |
| Drag to move | yes | DnD addon `onEventDrop` | **yes** | PV:966-1000 |
| Resize | yes | `onEventResize` | **yes** (bottom edge) | PV:1140-1187 |
| Click / drag-select empty slot to create (`selectable`, `dateClick`) | yes | `onSelectSlot` | **no** | only sidebar quick-add + Tab dialog |
| Event click | `eventClick` | `onSelectEvent` | context menu only | PV:1203 |
| Event hover / tooltip | `eventMouseEnter` | - | **no** | |
| "+N more" in month | `moreLinkClick` popover | `popup` | text only, count wrong | PV:902-903, see 2.11 |
| Background events | yes | `backgroundEvents` | **no** | |
| External drag-in (`droppable`) | yes | `onDropFromOutside` | yes (sidebar -> grid/month) | PV:387-396, 842-849 |
| Keyboard navigation of cells | partial | - | Tab/Enter on month cells only | PV:853-859; no arrow keys; blocks not keyboard-operable |
| ARIA grid semantics | yes | partial | **partial** | month is `grid/row/columnheader/gridcell` (PV:779-857); time-grid columns are `gridcell` with no `grid`/`row` ancestor (PV:1004-1006) |
| Touch / long-press | yes | `longPressThreshold` | native DnD only (no touch DnD) | |
| Print | premium | - | no | |

Summary of the biggest functional gaps, in the order a user hits them:
1. No all-day row; all-day Google events vanish from the grid.
2. Due-time-only tasks are never drawn on the grid (2.1 below), which also makes
   drag-to-schedule appear broken.
3. No click/drag-select on empty slots to create.
4. No multi-day / midnight-crossing rendering.
5. Month "+N more" is a label, not a popover, and the count is wrong.
6. Keyboard: no arrow navigation, no keyboard move/resize.

---

## 2. Correctness findings (ranked)

Severity: **S1** data loss, **S2** silent local/Google divergence, **S3** visible
breakage, **S4** accessibility/structure, **S5** cosmetic or latent risk.

### S1 - data loss

**2.1 Sync can mass-delete Google-sourced tasks (S1).**
`getCalendarEvents` requests `maxResults: "250"` per calendar with no `nextPageToken`
loop (CA:111-116) and swallows every per-calendar failure (CA:134-136), so a 401/429
or a truncated calendar yields a silently shorter list. PlannerView then passes that possibly-partial id list to
`removeDeletedGoogleEvents` as `knownGoogleEventIds` (PV:295-300) over a ~140-day
window (PV:263-264, 280-282), and the server deletes every `google_calendar` row in
range whose id is missing (CT:689-699). One calendar with >250 events, or one
transient API error, deletes rows across the whole window; `loadedRangeRef` then
marks the range as covered (PV:301-305) so they are not refetched until reload.
Same construction in the manual sync button (LY:165-185).

**2.2 Delete range is UTC, task dates are local (S1).**
`syncRangeStart/End` are `timeMin.slice(0,10)` of an ISO (UTC) string (PV:296-300)
but `removeDeletedGoogleEvents` compares them to local `yyyy-MM-dd` task dates
(CT:694). In UTC+N, local midnight Sep 1 is Aug 31 in UTC, so the delete window
starts a day earlier than the fetch window; Google-sourced tasks dated Aug 31 are
in range, absent from `knownIds`, and deleted, then re-inserted on the next fetch as
fresh rows with status/priority/project reset (CT:634-656). Mirror problem west of UTC.

**2.3 Delete window races the incremental pull (S1).**
`removeDeleted` runs with ids from a fetch snapshot taken seconds earlier
(PV:291 -> PV:295). The layout's 2-minute incremental pull (LY:47-55) can insert an
event created in Google after that snapshot; `removeDeleted` then deletes it, and
because the incremental `syncToken` has advanced it is not re-delivered. The row
reappears only on reload.

### S2 - silent divergence between Convex and Google

**2.4 Grid drop sends Google the old end time (S2).**
The drop passes only `{dueDate, dueTime}` (PV:995). `syncTaskUpdateToGoogle` takes
`newEndTime = changes.scheduledEndTime || task.scheduledEndTime` (GS:86), so Google
gets a moved start and the original end: an earlier drop stretches the event, a later
drop inverts it and Google returns 400, which is only `console.warn`ed (PV:996-998).
Convex (which preserved the duration, CT:246-258) and Google now disagree; the next
Google-side edit reverts the local move.

**2.5 Discarded push result creates duplicate Google events (S2).**
For a local task with no `googleEventId`, the same call falls through to
`pushLocalTaskToGoogle` (GS:133-142) and returns `{googleEventId, googleCalendarId}`,
which PV discards (PV:995; resize does the same at PV:1179). Convex never stores the
id, so every later drop/resize pushes another duplicate to Google until a full sync
happens to match by `unifocus_id` (CT:594-595). `KanbanCard` stores the result;
PlannerView does not.

**2.6 Month-cell and sidebar drops never write back to Google (S2).**
PV:848 and PV:395 update Convex only. A Google-linked task moved in month view keeps
its old date in Google.

**2.7 Duration wrap past midnight (S2 + S3).**
`update` preserves duration with `% 24` (CT:253-257): dragging a 3h task to 23:00
stores `scheduledEndTime: "02:00"` on the same date. The layout clamps that to 23:59
(PV:1052-1054) but the block's own height check `dur > 0` fails (PV:1117-1118) and
falls back to a 30-min block, the end label shows "11:30 pm" (PV:1195-1200), and the
event never renders on the next day (PV:944-946). `syncTaskUpdateToGoogle` has the
same wrap (GS:103-112) and sends end < start to Google.

**2.8 First sync overwrites locally pushed tasks (S2, latent).**
`bulkUpsertFromGoogle` only skips content fields when `googleUpdatedAt < lastSyncedAt`
(CT:602-604); a task pushed from local has `lastSyncedAt = 0` on first match
(CT:594-595), so Google's copy overwrites local title/description/dates (CT:619-629).
Also `lastSyncedAt = Date.now()` is stamped at PATCH time, not fetch time (CT:615),
so a Google edit made between fetch and upsert is never applied.

### S3 - visible breakage

**2.9 Overlapping events can visually collide (S3).**
`totalCols` is the max column among an item's *direct* overlaps, not its connected
cluster (PV:1069-1072). Reproduced by simulation: P 09:00-10:00, Q 09:30-11:00,
R 10:00-10:30, U 10:00-10:15 gives P at 0-50% and Q at 33-67%, overlapping between
33% and 50% while overlapping in time. FullCalendar and RBC's `no-overlap` compute
widths per cluster.

**2.10 Due-time-only tasks are invisible on the grid; drag-to-schedule appears broken (S3).**
The column renders only tasks with both `scheduledStartTime` and `scheduledEndTime`
(PV:947). The drop writes `dueTime` (PV:985/987) and the server only sets
`scheduledEndTime` if both scheduled fields already existed (CT:246). Net effect: a
sidebar task dropped at 10:00 gets a time, shows it in the sidebar, and does not
appear in the column it was dropped on.

**2.11 Month "+N more" count is wrong (S3).**
Shown chips are `min(2, google) + min(2, local)` (PV:878, 889) but the label uses
`dayTasks.length > 4` (PV:902-903). 3 Google + 0 local hides one with no label;
5 Google + 0 local says "+1" while 3 are hidden. There is no popover to see them.

**2.12 Quick-add double submit (S3).**
`handleAdd` (PV:357-362) has no in-flight guard and clears `newTitle` only after the
mutation resolves; Enter twice creates two tasks. `KanbanBoard.handleQuickAdd` has the
same shape. Tab to the full editor (PV:469) drops the typed title (PV:366, 758).
Planner quick-add also does not push to Google while the timeline's does.

**2.13 Resize past midnight yields end <= start (S3).**
No upper bound on the drag (PV:1151) and the end clamp wraps minutes
(PV:1163-1167): 23:30 + 60 min stores "23:30" (zero duration). The block overflows
the 2304px grid during the drag.

**2.14 A sync request can be silently dropped (S3).**
The debounced effect returns early if a fetch is in flight (PV:275-277) and nothing
re-arms it after `finally` (PV:310-313). Jumping to an uncovered range during the
initial multi-calendar fetch leaves that range unsynced until the next anchor/view
change. Additionally `loadedRangeRef` merges disjoint ranges into one span
(PV:301-305): fetch January, jump to June, and February-May are marked covered but
never fetched.

**2.15 Production hydration mismatch (S3).**
The timezone label evaluates `Intl.DateTimeFormat().resolvedOptions().timeZone` on the
server (PV:677) and again on the client; any non-UTC user gets a text mismatch and a
recoverable hydration error. `useState(new Date())` (PV:65-66) feeding the title
(PV:399-408) has the same problem near midnight. Not visible in local dev because
server and client share a timezone.

### S4 - accessibility / structure

**2.16** Time-grid columns are `role="gridcell"` with no enclosing `role="grid"` /
`role="row"` (PV:1004-1006), which is an invalid ARIA tree. Month grid is correct
(PV:779-857).
**2.17** Task blocks and the resize handle have no role, name, or keyboard path
(PV:1203-1268); DnD and resize are mouse-only. No arrow-key navigation between cells.
**2.18** Global `c`/`t` shortcuts skip only INPUT/TEXTAREA (PV:372-375); they fire
inside contenteditable editors and open dialogs.

### S5 - cosmetic / latent

- **Momentum-scroll double shift**: two scroll events before the recenter effect
  commits apply two functional `setCalAnchor` updates (PV:203-211); `Math.round`
  then snaps up to half a column.
- **`colWidth` division by zero** when the grid is hidden (`clientWidth` 0, PV:181,
  195) -> `daysScrolled = NaN` -> `subDays(d, NaN)` -> invalid anchor.
- **Header/grid width drift** on platforms with non-overlay scrollbars: header row
  and column scroller have different available widths (PV:675-682 vs PV:715).
- **Column remounts on every anchor shift**: keys are `day.toISOString()` (PV:739)
  and nav preserves time-of-day while the picker gives midnight, so the same day gets
  a new key and `isOver`/`CurrentTimeLine`/block height state reset.
- **`dragover` re-render storm**: `setDropIndicator` with a fresh object on every
  `dragover` (PV:963) re-renders 96 slot divs and the O(n^2) overlap pass.
- **Resize snap-back flicker**: `setIsResizing(false)` (PV:1158) precedes the await
  (PV:1170), so the height-sync effect (PV:1127-1138) briefly restores the old height.
- **Leaked window listeners** if a block unmounts mid-resize (PV:1156-1157).
- **Frozen "today"**: `dayTasks` memo captures `new Date()` (PV:337-338); overdue
  split is stale across midnight until an unrelated re-render.
- **Anchor drift**: `addMonths(Jan 31, 1)` -> Feb 28 -> Mar 28 (PV:137, 144);
  switching back to week lands on the 28th.
- **Date-picker week start** follows locale (Sunday in en-US) while the grid is
  Monday-first (PV:436; components/ui/calendar.tsx:15-22).
- **View flash**: initial render is always "week" (PV:67); the persisted view is
  applied post-mount (PV:105), causing one extra layout and a cancelled sync timer.
- **Swallowed calendar-list errors**: `getCalendarList().catch(() => {})` (PV:220)
  makes auth failure look like "No calendars found" (PV:604).
- **Dateless Google rows**: an event with neither `start.dateTime` nor `start.date`
  is inserted with no date (CT:433-443) and is invisible and never removed (CT:692-693).
- **All-day end date shifts** for UTC+ users in `pushLocalTaskToGoogle`
  (GS:118-120, CS:182-184) via `toISOString().slice(0,10)`.
- **DST**: geometry is wall-clock so slots are correct on 23/25-hour days; the now
  line jumps/skips one row at the transition (PV:1279). Acceptable.
- `weekOfMonth` (PV:125) is dead code.

---

## 3. Race conditions, specifically

| # | Race | Where | Effect |
|---|---|---|---|
| R1 | Fetch snapshot vs incremental pull vs `removeDeleted` | PV:291-300, LY:47-55 | Deletes a row the pull just added (2.3) |
| R2 | PV sync vs manual SyncButton sync | PV:256-317, LY:165-185 | Two full syncs with different windows interleave; each can delete what the other upserts |
| R3 | In-flight guard drops, never re-arms | PV:275-277, 310-313 | Range stays unsynced (2.14) |
| R4 | Disjoint `loadedRange` merge | PV:301-305 | Gaps marked as loaded (2.14) |
| R5 | Convex write then Google write, no rollback | PV:985-998 | Divergence on Google failure (2.4) |
| R6 | Two Enter presses in quick-add | PV:357-362, 468 | Duplicate task (2.12) |
| R7 | Two scroll events before recenter commits | PV:188-216 | Anchor moves 2x |
| R8 | Block unmount during resize | PV:1156-1157 | Stale `updateTask` on mouseup |
| R9 | `lastSyncedAt` stamped at PATCH, not fetch | CT:615 | Google edit in the fetch-upsert window is dropped (2.8) |
| R10 | Uncancelled async after unmount | PV:308, 311, 361 | Benign under React 19 (no-op setState), listed for completeness |

What is **not** a race (checked): the drag enter/leave counters (PV:860-861,
1010-1014) pair correctly with nested children; header/grid scroll mirroring
(PV:164-173) and the recenter effect write to different elements and do not fight;
localStorage writes are synchronous and idempotent under StrictMode; only one native
drag can be in flight at a time.

---

## 4. Recommended fix order

1. **Sync safety (2.1-2.3, R1-R4)**: paginate with `nextPageToken`; check `res.ok`
   and surface per-calendar failures; never call `removeDeleted` when any calendar
   failed or was truncated; derive the delete range from local `format(d,"yyyy-MM-dd")`
   not `toISOString()`; store `loadedRange` as a list of intervals; re-arm the sync
   after `finally`; serialize PV sync and the manual sync through one in-flight promise.
2. **Write-back correctness (2.4-2.7)**: send `scheduledStartTime`/`EndTime` (not
   `dueTime`) from drops; store the push result; sync month/sidebar drops; clamp
   duration to end-of-day instead of `% 24`.
3. **Grid rendering (2.9-2.11)**: cluster-based overlap widths; render due-time-only
   tasks (default 30 min) or have drops set scheduled times; correct "+N more" and add
   a popover; add an all-day lane.
4. **Interaction hygiene (2.12-2.13, R6-R8)**: in-flight guard on quick-add; resize
   upper bound; `onDragEnd` reset; throttle `dragover`; abort on unmount.
5. **A11y (2.16-2.18)**: wrap the time grid in `role="grid"`/`row`; keyboard move/
   resize for blocks; arrow-key cell navigation; scope global shortcuts.
6. **Hydration (2.15)**: render the tz label and initial dates client-only.

---

## 5. Status (2026-09-11)

All findings above were fixed in one pass. "Verified" means checked by DOM
measurement / Convex row inspection in the browser, or by a unit test on the
pure function; "code-only" means no Google account is connected in this dev
environment, so the Google write path was type-checked and unit-tested with a
stubbed fetch but not exercised against the live API.

| Finding | Fix | Verified |
|---|---|---|
| 2.1 mass delete on partial fetch | `getCalendarEventsDetailed` pages with `nextPageToken`, reports `failedCalendarIds`; `runCalendarSync` skips `removeDeleted` unless `complete` | unit test (stubbed fetch) |
| 2.2 UTC delete range | delete window is local `yyyy-MM-dd`, shrunk 1 day each side; Google window is local-midnight instants | unit test |
| 2.3 delete races the pull | `removeDeletedGoogleEvents` takes `fetchStartedAt`, skips rows synced/created at or after it (30s skew tolerance) | code-only (Convex deployed) |
| 2.4 old end time sent to Google | grid drop writes `dueTime + scheduledStartTime + scheduledEndTime`; `syncTaskUpdateToGoogle` never pairs a moved start with the stored end | Convex rows checked; Google code-only |
| 2.5 duplicate Google events | every planner path stores the push result; `pushInFlight` set blocks a second push for the same task | code-only |
| 2.6 month/sidebar drops not synced | both go through `syncChangesToGoogle` | code-only |
| 2.7 midnight wrap (`% 24`) | `clampedEndTime` in Convex, `endTimeFor` in client/server: end is clamped to 23:59 | browser: 60-min block dropped at 23:30 stored as 23:30-23:59, drawn inside the grid |
| 2.8 first sync overwrites local | linking a `googleEventId` stamps `lastSyncedAt`; `bulkUpsert` stamps `lastSyncedAt = fetchedAt` (fetch time, not write time) | code-only |
| 2.9 overlap collisions | cluster-based `layoutTimeBlocks` (lib/calendar-layout.ts) | unit (report case + 500 random layouts, zero collisions) and browser (P/Q/R/U rects do not intersect) |
| 2.10 due-time-only tasks invisible | `resolveTaskBlock`: bare due time renders with the 60-min default; drops always write a full block | browser |
| 2.11 "+N more" count | count = total minus chips actually shown; popover lists the day | browser (5 tasks -> 4 chips + "+1 more", popover shows 5) |
| 2.12 quick-add double submit | in-flight guard, optimistic clear/restore, Tab carries the title, pushes to Google like the timeline | browser (Enter x3 -> 1 row) |
| 2.13 resize past midnight | resize bounded by grid bottom, end clamped | browser (mouse drag +200px at 23:30 stays inside grid, end 23:59) |
| 2.14 dropped / mis-merged sync requests | requests chained (never dropped), re-check coverage when their turn comes; loaded ranges kept as merged intervals | unit test (serialization) |
| 2.15 hydration mismatch | planner is `dynamic(..., { ssr: false })`; state initialised from localStorage/`new Date()` lazily | browser (no hydration warnings in console) |
| 2.16 invalid ARIA tree | time grid is `grid > row > columnheader/gridcell` with `presentation` wrappers | browser (roles measured) |
| 2.17 keyboard | blocks are focusable buttons: Arrow = move 15 min, Shift+Arrow = resize, Left/Right = move a day (focus follows); month cells and day headers have roving tabindex with Arrow/Home/End/PageUp/PageDown | browser |
| 2.18 shortcut scope | `c`/`t` ignored with modifiers, in inputs/editors, dialogs and menus | browser (`t` inside the dialog does not navigate) |
| S5 momentum double shift | guard flag set when a shift is scheduled | browser (3 scroll events -> 1 shift) |
| S5 colWidth 0 | early return when `clientWidth === 0` | code |
| S5 header/grid drift | scrollbar width measured with ResizeObserver, header rows padded | browser (header/all-day/columns all 538..1450) |
| S5 column remounts | keys are `yyyy-MM-dd`, anchor normalised to `startOfDay` | code |
| S5 dragover storm | indicator only re-rendered when the snapped slot changes | code |
| S5 resize snap-back / leaked listeners | height held until Convex confirms; listeners removed on unmount | code |
| S5 frozen today | `useToday()` re-evaluates at midnight and on tab focus | code |
| S5 month anchor drift | month nav goes through `startOfMonth` | code |
| S5 picker week start | `weekStartsOn={1}` | browser (Mo..Su) |
| S5 view flash | view read from localStorage in the initial state (client-only) | code |
| S5 swallowed calendar-list error | surfaced in the calendars menu | code |
| S5 dateless Google rows | skipped on upsert, removed when unlisted | code |
| S5 all-day end date UTC | `addDaysToDateStr` (UTC arithmetic on the string) | unit test |
| extra: incremental pull ignored cancellations and never paged | `getCalendarEventsIncremental` pages; cancelled ids go to `removeGoogleEventsByIds` | code-only |
| extra: pushed events used the server timezone | `pushLocalTaskToGoogle` sends the user's zone; queue route sends the task's | code-only |
| feature: all-day lane | added (drop to unschedule, drag out to schedule) | browser |
| feature: click-to-create | empty slot click opens the editor pre-filled with date, start and +60 min | browser |

Still open (need schema/product decisions): multi-day spanning events, recurring
expansion on the grid, list/agenda view, business hours, hidden days, locale.
