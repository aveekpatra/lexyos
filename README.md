# Lexyos

Lexyos is a keyboard-first task, project and calendar app with an AI agent. Tasks live on a Kanban board grouped by time, projects have their own boards, and tasks sync two ways with Google Calendar. The same task tools are exposed to the in-app agent and to outside AI clients through an MCP server.

Live at [lexyos.com](https://lexyos.com).

## Features

- Timeline board grouped by time (day, week and month modes) with quick-add and drag to reschedule.
- Project boards with custom columns, a project context document and archiving.
- Tasks with status, priority, dates and times, duration, labels, subtasks and repeat rules (daily, weekly with per-day times, monthly, yearly, with end dates). Tasks can be completed or marked missed.
- Two-way Google Calendar sync with a retry queue.
- Cmd+K search, a timebox panel, and a Pomodoro focus timer.
- Agent panel backed by OpenAI (or OpenRouter), with optional voice input and output through Cartesia.
- MCP server at `/api/mcp`, authenticated with personal API keys or OAuth, exposing the same tools as the agent: `list_tasks`, `search_tasks`, `create_task`, `update_task`, `complete_task`, `mark_missed`, `plan_day`, `find_free_time`, `get_project`, and more.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Convex (database and server functions)
- Clerk (authentication; Google Calendar access uses the Clerk Google connection with the calendar scope)
- Vercel AI SDK with OpenAI and OpenRouter providers
- Tiptap (markdown editor), Tailwind CSS 4, Base UI, Motion
- `mcp-handler` and the MCP TypeScript SDK

## Getting started

Requirements: Node.js, pnpm, a Convex account and a Clerk application.

```bash
pnpm install
pnpm dev
```

`pnpm dev` first runs `convex dev --until-success`, then starts Next.js and Convex together. The first run links a Convex deployment and writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`.

There is no `.env.example`. Set these variables.

In `.env.local` (Next.js):

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `AGENT_SECRET` (shared secret between the Next.js server and Convex; also used by `lib/crypto.ts`)
- `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` as a fallback
- Optional: `OPENAI_BASE_URL`, `OPENROUTER_MODEL`, `AGENT_REASONING_EFFORT`, `AGENT_SERVICE_TIER`
- Optional, for voice: `NEXT_PUBLIC_CARTESIA_API_KEY`, `NEXT_PUBLIC_CARTESIA_VOICE_ID`

In the Convex deployment (`npx convex env set NAME value`):

- `CLERK_JWT_ISSUER_DOMAIN` (the Clerk issuer URL; see `convex/auth.config.ts`)
- `AGENT_SECRET` (same value as above)

For Google Calendar sync, enable the Google connection in Clerk and add the `https://www.googleapis.com/auth/calendar` scope.

Other scripts:

```bash
pnpm build
pnpm start
pnpm lint
```

## Project structure

```
app/            Routes: landing, sign-in, (app)/timeline, (app)/project, (app)/task, oauth consent
app/api/        ai/chat (agent), mcp (MCP server), oauth, tokens, google, sync
app/actions/    Server actions for Google Calendar
components/     Board, project board, task detail, sidebar, command bar, settings, timebox, focus timer
convex/         Schema and functions: tasks, projects, calendar sync queue, API tokens, OAuth, AI chats
lib/ai/         Agent model config, tool definitions shared by the agent and MCP server, voice hook
lib/            Recurrence, quick-add parsing, Google sync, OAuth server, stores
docs/vision.md  Product direction (written when the app was called UniFocus)
```
