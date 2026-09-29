# Memory: Lexyos (web, backend, Mac)

Last updated: 2026-09-29

Two repos:
- `lexyos` (this one): Next.js 16 web + Convex backend. Pushes to `main` deploy the website on Vercel (www.lexyos.com). Convex prod: `CONVEX_DEPLOYMENT=prod:disciplined-mallard-514`.
- `lexyos-mac`: native macOS client at `/Users/aveek/Downloads/Projects/lexyos-mac`, private repo `aveekpatra/lexyos-mac`, installed as /Applications/Lexyos.app, now 0.3.3 build 11.

## What exists

**Backend (Convex)**
- Tasks with history (`taskEvents`, `tasks:history`), task-to-task links (`taskLinks`, `tasks:link|unlink|links|byNumber`).
- Knowledge graph `graphEdges` (`convex/lib/graph.ts`): mentions (`#142`, `[label](#142)`, `[[Title]]`, `[[Title|alias]]`, `[[Title#Heading]]`) parsed on save; `via: "link"` edges from `graph:connect|disconnect`; `graph:related` merges edges and taskLinks.
- Notebooks and notes: `notebooks`, `notes`, `noteEvents` (story), `noteRevisions` (one per 10-minute session). `notes:titles` feeds link pickers. Notes mutations take `client: "mac"` for the actor (web by default).
- #570 fix: `[[links]]` resolve when their target note is created or renamed (`relinkTitles` in `convex/notes.ts`), and every note save re-reads its links.
- Rule: every task has a project or a date; only project tasks may be undated. Clearing a date removes its times.
- Server Google sync: push worker `convex/googleSync.ts` (opt-in via `syncTimeZone`, used by the Mac), 5-minute pull cron `convex/calendarPull.ts`.
- Agent/MCP tools in `lib/ai/tools.ts` (in-app agent and `/api/mcp`): knowledge tools plus `link_tasks`, `unlink_tasks`, `connect`. The prompt says relating is not nesting: `parentTaskId` only splits work into parts (the agent once made subtasks when asked to link).

**Web**
- Notes at `/notes/[[...id]]` (`components/notes/NotesView.tsx`): notebooks column with search (results replace it and hide the notes list), resizable notes list, note page with title, editor, Connections, collapsible History; notebook create/edit/delete, move note, delete note. Sidebar has a Notes entry; unified search finds notes.
- Link-aware Tiptap editor (`components/editor/MarkdownEditor.tsx`, `refs.ts`, `links.tsx`, `LinkMenu.tsx`, `lib/link-targets.ts`): `#` + number, `@`, `[[`, Cmd-K on a selection; links render as chips. Tables, ==highlights==, callouts and headings 1-6 round-trip; the editor saves only after a real edit, so reading never rewrites Mac Markdown.
- Task page: Connections (link a task or a note, remove "link" connections) and Activity with slip summary (`components/task-detail/TaskStory.tsx`).
- The web still has its own Overdue page and browser-side Google sync.

**Mac (SwiftUI, macOS 26.2+, Speek's shell)**
- Rail: Tasks, Today, Notes, Settings. Inbox board with an Overdue column before Today; project boards; detail pane (Markdown notes, subtasks, Connections, Activity); optimistic drag and drop with rollback.
- Timeline (`Board/TimelinePane.swift`): day hour grid on Tasks and Today, title-bar toggle next to Agent (Cmd-T). Drop a card to schedule (dashed preview), drag to move, pull the bottom edge to resize, "Remove time" in the context menu; follows the board's day; calendar events read-only; open tasks only.
- Linking as you type (`Design/LinkEditor.swift`, NSTextView): same triggers as the web; rendered `#142` reads "#142 Title".
- Title bar: Back/Forward (Cmd-[ / Cmd-]), sidebar toggle (Ctrl-Cmd-S) on Tasks and Notes only, Timeline, Agent (Cmd-J).
- Notes: notebooks + search, notes list, Notion-style page with Connections and History.
- Focus droplet, menu bar window, quick add, URL commands `com.aveekpatra.lexyos://focus/...` and `://agent/ask?q=`.
- `scripts/install.sh`: Release build (nice, -jobs 4), local signing identity, install to /Applications. Bump `CURRENT_PROJECT_VERSION` in project.yml on each install.

## Decisions

- Mac talks only to Convex (plus the website for the agent). Business rules and Google live in the backend.
- Knowledge graph is invisible (no graph view); it serves backlinks and the agent.
- Overdue excludes Google Calendar events. Mac never calls `tasks:rolloverOverdue`.
- Focus droplet design is user-approved. No custom icon animations in the sidebar. No target/scope icon.
- User consents to direct Convex prod deploys, pushes and testing.

## Lessons

- Never claim something shows on screen without the user confirming it.
- Keep builds rare and niced; the user hates laptop heat and keychain prompts.
- Convex: new modules need entries in `convex/_generated/api.d.ts` before `tsc`; helpers go in `convex/lib/`.
- Testing as the user from the CLI: `agent: {secret, userId}` with AGENT_SECRET from `npx convex env get`, never printed; delete throwaway data after.
- zsh: never name a shell variable `path`.
- `ps %cpu` is a lifetime average; use `top` for current CPU.

## Not yet seen by the user

- Web: Notes pages, editor chips and pickers, Connections, Activity.
- Mac: Timeline pane, inline link pickers, Back/Forward, sidebar toggle.
- Mac-driven Google Calendar updates for moves and completions (not confirmed in production).

## Next session starts with

Ask how the Mac Timeline and the web Notes feel; fix what they flag.

## Open questions

- Remove the web Overdue page too (the Mac shows an Overdue column instead)?
- Should the web stop browser-side Google sync and pass `syncTimeZone` like the Mac?
- Web pull route asks Google for times in the server zone (likely UTC); may shift times. Fix like `calendarPull.ts`.
- `[[wiki]]` links resolve by title; consider link-by-id with title display.
- Subtasks the agent once created in place of links may need turning back into links (user to name them).
- Two leftover sample tasks (#377, #135) may need deleting.
