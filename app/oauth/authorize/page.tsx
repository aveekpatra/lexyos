import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { IoPrism, IoCheckmarkCircle } from "react-icons/io5";
import { normaliseScope, redirectUriAllowed, resolveClient } from "@/lib/oauth/server";

/**
 * OAuth consent. Reached from Claude, ChatGPT, Cursor or any MCP client. The
 * user is already signed in (middleware sends them through sign-in first),
 * so this is a single Allow click.
 */
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SCOPE_TEXT: Record<string, string> = {
  "tasks:read": "Read your tasks, projects, and schedule",
  "tasks:write": "Create, update, complete, and delete tasks and projects",
  offline_access: "Stay connected without signing in again",
};

export default async function Authorize({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { userId } = await auth();
  if (!userId) {
    const h = await headers();
    const qs = new URLSearchParams(Object.entries(sp).map(([k, v]) => [k, one(v)])).toString();
    redirect(`/?redirect_url=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
    void h;
  }
  const clientId = one(sp.client_id), redirectUri = one(sp.redirect_uri);
  const problems: string[] = [];
  if (one(sp.response_type) !== "code") problems.push("response_type must be code");
  if (!one(sp.code_challenge) || one(sp.code_challenge_method) !== "S256") problems.push("PKCE (S256) is required");
  const client = clientId ? await resolveClient(clientId) : null;
  if (!client) problems.push("Unknown client");
  else if (!redirectUriAllowed(redirectUri, client.redirectUris, client)) problems.push("redirect_uri is not registered for this client");

  if (problems.length || !client) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-text-strong">Cannot continue</h1>
        <ul className="mt-3 list-disc pl-5 text-[13px] text-text-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </Shell>
    );
  }

  const scope = normaliseScope(one(sp.scope));
  const redirectHost = new URL(redirectUri).host;
  const fields = { client_id: clientId, redirect_uri: redirectUri, state: one(sp.state), scope, code_challenge: one(sp.code_challenge), code_challenge_method: "S256", resource: one(sp.resource) };

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><IoPrism size={20} /></span>
        <div>
          <h1 className="text-[17px] font-semibold text-text-strong">Connect {client.name} to Lexyos</h1>
          <p className="text-[12.5px] text-text-muted">It will return you to {redirectHost}</p>
        </div>
      </div>
      <ul className="mt-5 flex flex-col gap-2">
        {scope.split(" ").map((s) => (
          <li key={s} className="flex items-start gap-2 text-[13px] text-text-secondary">
            <IoCheckmarkCircle className="mt-0.5 size-4 shrink-0 text-emerald-600" />{SCOPE_TEXT[s] ?? s}
          </li>
        ))}
      </ul>
      <form method="post" action="/api/oauth/decision" className="mt-6 flex gap-2">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button name="decision" value="deny" className="h-10 flex-1 rounded-full bg-black/[0.05] text-[13px] font-medium text-text-strong hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]">Cancel</button>
        <button name="decision" value="approve" className="h-10 flex-1 rounded-full bg-brand text-[13px] font-medium text-white hover:bg-brand-strong">Allow</button>
      </form>
      <p className="mt-4 text-[11.5px] text-text-faint">You can disconnect {client.name} any time from Settings, MCP and API access.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-[420px] rounded-[24px] glass-surface p-6">{children}</div>
    </main>
  );
}
