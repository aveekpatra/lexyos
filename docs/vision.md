# UniFocus: what it is and how it should work

Written 2026-09-19. This is the product direction. Every feature and design decision should be checked against it.

## The one-sentence version

UniFocus is Linear for your life: a fast, keyboard-first task and calendar app where you and your AI assistant work on the same board, and the AI gets in through a proper MCP server rather than a chat box bolted onto the side.

## Why it exists

Todoist and Google Calendar are two systems pretending to be one. A task with a date is not the same thing as a block of time on the calendar, so things fall through the gap. Todoist's interface is busy and opinionated in the wrong places. Linear proves that a work tracker can be fast, quiet, and pleasant, and that a Kanban board plus a good command menu is enough structure for almost everything.

UniFocus takes that model and applies it to personal life: one place where tasks, time, and projects are the same objects viewed three different ways.

## First principles

1. One object. A task is the only thing you manage. A calendar event is a task with a start and end time. A project is a bucket of tasks. There is no separate "event" model that has to be kept in sync with tasks.

2. Time is a property, not a place. Dragging a card onto Tuesday sets its date. Dragging it onto 3pm sets its time. Removing the time turns it back into an all-day task. Google Calendar sees whatever the task currently says.

3. Never leave the board to do something small. Every property (status, priority, date, time, duration, project, labels) is editable from the card, from a right-click, from a keyboard shortcut with the card selected, and in bulk with several cards selected. The task page is for reading and writing the long description and subtasks, nothing else.

4. The keyboard is the primary input. Cmd+K opens a command menu that can do anything the UI can do. Single-letter shortcuts on a selected card cover the common edits. The mouse is for dragging and reading.

5. The AI is a peer, not a feature. Claude, ChatGPT, or anything else talks to UniFocus through one MCP server that exposes exactly the same operations the UI has. The built-in chat panel is that same MCP client running inside the app. Nothing the AI can do is hidden from the UI, and nothing the UI can do is hidden from the AI.

6. Lean by default. If a feature can be replaced by a filter, a shortcut, or a property, it should be. No mail. No notes app. No habit tracker. No gamification.

## What the product is

### Views

There are exactly three ways to look at tasks. All three show the same data and support the same actions.

Board (the default). A Kanban board grouped by time: Overdue, Today, Tomorrow, This week, Later, Someday. Cards move between columns by drag or shortcut. This is the home screen and where you spend most of your day. Sub-modes: Day (morning, afternoon, evening, night), Week (seven columns), Month (grid of days). The current Timeline view becomes this.

Calendar. A time grid, day and week. Tasks with times appear as blocks you can resize and drag. Tasks without times sit in an all-day strip at the top and can be dragged down into a slot. Google Calendar events you did not create in UniFocus are shown in the same grid with a muted style and are editable in place.

Projects. A project is not a filter chip on the board. It is its own place. The sidebar lists projects; clicking one opens that project's board, showing only its tasks, grouped by status (Todo, Planned, In progress, Review, Done). This is the Linear view, and it is where you go to work on one thing. The project page also holds the project's description and notes.

The home board (Inbox) is the opposite: it always shows every task from every project, grouped by time. The two never fight. Inbox answers "what is on my plate", a project answers "where is this thing at". A card in the Inbox shows a small project tag so you know where it came from, and you can jump to the project from the card. There is no third "filtered Inbox" mode pretending to be a project.

Cross-cutting: a persistent filter bar (project, priority, label, status, done shown or hidden) that works the same in all three views, and a saved-views dropdown so you can name a filter set and return to it.

### The task

Fields: title, description (markdown), status, priority (P1 to P4), due date, scheduled start and end time, estimated duration, project, labels, subtasks, repeat rule, Google Calendar link. That is the full list. No comments, no attachments, no assignees.

### Repeating tasks

A repeating task is one live card that rolls forward. When you complete it, UniFocus writes a done copy for history and moves the live card to its next occurrence. Google Calendar only ever holds the live occurrence, so there is one event, not a smear of them.

Rules:

- Daily, every N days.
- Weekly, every N weeks, on any set of days. Each day can carry its own time: Monday 8 to 9am, Tuesday 6pm, Saturday all day, in one rule. A day with no time keeps the task's own time. This is where all the flexibility lives.
- Monthly, on a day of the month or on the last day. Falls back to the last day in short months.
- Yearly, on the task's date.
- Any rule can end on a date.

Completing late does not create a backlog. The next occurrence is always after today. The same rule object is used by the board, the task page, and the AI tools, so "make this Monday morning and Thursday evening" is one call from Claude.

Completed tasks stay visible in the column for the rest of the day, greyed out, then move to a Done archive reachable from the filter bar.

### Editing without opening

- Hover a card: a small row of icons appears (complete, priority, date, more). Click any to change it in place.
- Right-click a card: full context menu with every property and delete.
- Select a card (click or arrow keys), then press a letter: C complete, P priority, D date, T time, M move to project, L label, Backspace delete, Enter open. Same letters Linear uses where they overlap.
- Shift-click or Shift-arrow to select several cards. Every action above then applies to all selected. A floating bar at the bottom shows the count and the available actions.
- Type in the quick-add row at the top of any column. Natural language dates and times are parsed: "Dentist tue 3pm 1h p1 #health" creates a P1 task in the Health project on Tuesday from 3 to 4pm. Enter creates and stays. Cmd+Enter creates and opens.
- Cmd+K from anywhere: search tasks and projects, run any action on the current selection, jump to a view, or ask the AI.

### Calendar sync

Google is connected from inside the app, not through the login provider. Clerk only says who you are. A Connect Google Calendar dialog appears when no account is linked or the saved connection stops working, and the sidebar sync button turns into a connect button until it is fixed. Tokens are stored encrypted and can be revoked from the same dialog.

Two-way with Google Calendar, one calendar per project or one shared calendar, your choice per project. UniFocus is the source of truth for anything it created. Google is the source of truth for events created elsewhere. Conflicts resolve to whichever side changed most recently. Sync runs every two minutes in the background and immediately after any local edit. A small indicator in the sidebar shows sync state; clicking it forces a sync and shows the last error if any.

### The AI

One MCP server, hosted with the app, authenticated with a personal token you generate in settings. It exposes:

- list, search, get, create, update, complete, delete for tasks
- list, get, create, update, archive for projects
- today's summary, free time between two dates, and a plan-my-day helper that proposes times for unscheduled tasks and returns the proposal without applying it
- bulk update by filter, so "move everything tagged errands to Saturday" is one call

It is registered as a Claude connector and packaged as a ChatGPT plugin manifest. The same server also backs the in-app chat panel, so what you can say to Claude on your phone is exactly what you can say in the app. The in-app panel stays optional and collapsed by default.

### Design

The visual language is taken from the Aturno app: Apple's Liquid Glass rules applied strictly.

For the calendar grid, borrow from cal.com. Their open-source booking UI has a clean day and week grid, a time picker, and an availability editor that already look the way this app should. Lift the layout and interaction patterns (hour rows, current-time line, drag to create, resize handles, the weekly availability editor for the repeat rule's per-day times) and restyle them with the tokens below. Do not import their component library wholesale; take the parts and match them to the glass rules.

- Two layers. Content (cards, lists, the calendar grid) is flat and scrolls. Controls that float over content (header, filter bar, popovers, command menu, the bulk action bar) are frosted glass with a white hairline rim and a soft neutral shadow. Glass never appears inside content.
- One signature edge on every surface: a one-pixel white inset ring plus two soft drop shadows. Cards, islands, inputs, and menus all share it.
- Concentric radii. Capsules are fully round. An inner element's radius is the outer radius minus the padding. Islands are 24px, menus 20px, cards 13px, pills fully round.
- Motion is spring-based with two recipes: a snappy one for chrome (segmented thumbs, menu highlights) and a softer one for panels and cards. Dropdown hover is one shared highlight capsule that springs between rows rather than each row lighting up.
- One accent colour, the blue already in the codebase. Everything else is neutral. Priority is shown by a small filled circle in four fixed tints, not by colouring the whole card.
- Typography: DM Sans for chrome and display, Inter for dense lists and the chat panel. Both already partly in place.
- Keyboard hints are small round grey pills on menu items and in the command menu footer.
- Dark mode is a first-class theme, not an afterthought.

## What it is not

- Not a mail client. The Gmail integration was removed and stays removed.
- Not a notes app. Descriptions and project notes are enough.
- Not a team tool. One user, one account, no sharing.
- Not an AI-first app. The AI is a client of the app, not its brain.

## Where we are today

Working: Clerk auth, Convex backend with tasks and projects, the Kanban board with day, week, month and overview modes, quick-add per column, drag to reschedule, right-click context menu, property popovers on cards, task and project detail pages, Cmd+K search, two-way Google Calendar sync with a retry queue, an in-app AI chat with 13 tools on GPT-5.6 through OpenRouter.

Done since this document was written: flexible repeat rules (daily, weekly with per-day times, monthly, yearly, with end dates), roll-forward on completion with a done snapshot, a repeat popover on the task page, presets in the right-click menu, a repeat chip on cards, and the same rule exposed to the AI tools.

Half done or missing: no calendar grid view (deleted in the redesign), no multi-select or bulk actions, no keyboard shortcuts on cards, no hover action row, no natural-language quick-add, no labels UI, no saved views, no project-grouped-by-status board, no MCP server at all, no personal API tokens, sync indicator absent, mail and planner remnants still referenced in the Convex schema.

## Checklist

Foundation
- [ ] Remove dead Convex tables from the schema (calendarEvents mirror, any mail leftovers) once Convex allows it; document why they remain otherwise
- [x] Add labels to the tasks schema with a project-independent label table (managed in Settings)
- [ ] Add a savedViews table (name, filter JSON, sort, view type)
- [x] Add an apiTokens table for MCP authentication

Board
- [ ] Multi-select with click, Shift-click, and Shift-arrow
- [ ] Floating bulk action bar (complete, priority, date, project, label, delete)
- [ ] Single-key shortcuts on selected cards (C, P, D, T, M, L, Backspace, Enter)
- [ ] Hover action row on cards
- [ ] Natural-language parsing in quick-add (date, time, duration, priority, project)
- [ ] Persistent filter bar shared across views
- [ ] Saved views
- [ ] Completed tasks fade in place for the day, then archive

Calendar
- [ ] Day and week time grid, patterned on cal.com's booking grid
- [ ] Drag to move, resize to change duration
- [ ] All-day strip with drag-down to schedule
- [ ] Google events not owned by UniFocus rendered muted and editable

Projects
- [ ] Project board grouped by status with drag between columns (project as a place, Inbox shows everything)
- [ ] Per-project calendar choice (own Google calendar or shared)
- [ ] Archive view

Sync
- [x] Google connected in-app with our own OAuth client (not Clerk), connect dialog, disconnect
- [ ] Sidebar sync indicator with last run, force sync, last error
- [ ] Immediate push after local edits (currently waits for the two-minute poll in some paths)
- [x] Flexible repeat rules with per-day weekly times, roll-forward on complete
- [ ] Repeat rule editor rebuilt on a cal.com style availability grid

AI and MCP
- [ ] MCP server with the tool set above, sharing implementation with the in-app tools
- [x] Personal token generation and revocation in settings (MCP endpoint itself still to build)
- [ ] Claude connector registration
- [ ] ChatGPT plugin manifest
- [ ] In-app chat panel rewired to call the MCP server
- [ ] Bulk-update-by-filter tool

Design
- [ ] Audit every surface against the two-layer rule (glass only on floating controls)
- [ ] Unify radii to the concentric ladder
- [ ] Shared spring highlight in dropdowns and context menus
- [ ] Priority circles in four fixed tints, no card colouring
- [ ] Round kbd pills on all menu items
- [ ] Dark mode pass on every view

Cleanup
- [ ] Commit or revert the current mid-refactor working tree so main is coherent
- [ ] Replace the template README with a pointer to this document
