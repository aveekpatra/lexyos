"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section, Row, Tag } from "../primitives";
import { softPill, bluePill } from "@/lib/ui/chrome";
import { formatDistanceToNow } from "date-fns";
import { IoKey, IoCopy, IoCheckmarkCircle, IoEye, IoEyeOff, IoRefresh, IoOpenOutline, IoLinkOutline, IoTrashOutline, IoTerminal } from "react-icons/io5";

type KeyInfo = { key: string; createdAt: number; lastUsedAt: number | null };

/*
 * Connect an assistant. Every card is the same two steps: the server URL
 * goes on the clipboard, the assistant's connector page opens. The assistant
 * detects OAuth from the URL, the user presses Connect there, signs in here
 * once, and is sent back. No keys change hands. Cursor and VS Code have real
 * install links, so those are one click.
 */
export function McpSection() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${origin}/api/mcp`;
  const grants = useQuery(api.oauth.grants, {});
  const revoke = useMutation(api.oauth.revoke);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, k: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(k);
    setTimeout(() => setCopied(null), 1500);
  };
  /** Copy the URL, then open the assistant's connector page in a new tab. */
  const connectVia = async (k: string, href: string) => {
    await copy(mcpUrl, k);
    window.open(href, "_blank", "noopener");
  };

  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=lexyos&config=${typeof window !== "undefined" ? btoa(JSON.stringify({ url: mcpUrl })) : ""}`;
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "lexyos", type: "http", url: mcpUrl }))}`;
  const claudeCodeCmd = `claude mcp add --transport http lexyos ${mcpUrl}`;

  return (
    <>
      <Section title="Connect an assistant" description="Each one signs in with your Lexyos account. Nothing to paste except the server URL, and that goes on your clipboard for you.">
        <Row label="Claude" hint={<>Opens Claude connectors. Press <b>Add custom connector</b>, paste the URL, then <b>Connect</b>.</>} icon={<Glyph>C</Glyph>}>
          <button onClick={() => connectVia("claude", "https://claude.ai/settings/connectors")} className={bluePill}>
            {copied === "claude" ? <IoCheckmarkCircle className="size-3.5" /> : <IoOpenOutline className="size-3.5" />}{copied === "claude" ? "URL copied" : "Connect Claude"}
          </button>
        </Row>
        <Row label="ChatGPT" hint={<>Opens ChatGPT plugins. Press <b>+</b>, paste the URL, choose <b>OAuth</b>. Needs Developer mode on.</>} icon={<Glyph>G</Glyph>}>
          <button onClick={() => connectVia("chatgpt", "https://chatgpt.com/plugins")} className={bluePill}>
            {copied === "chatgpt" ? <IoCheckmarkCircle className="size-3.5" /> : <IoOpenOutline className="size-3.5" />}{copied === "chatgpt" ? "URL copied" : "Connect ChatGPT"}
          </button>
        </Row>
        <Row label="Cursor" hint="One click. Cursor asks to install, then signs you in." icon={<Glyph>Cu</Glyph>}>
          <a href={cursorLink} className={softPill}><IoLinkOutline className="size-3.5" />Add to Cursor</a>
        </Row>
        <Row label="VS Code" hint="One click. Copilot asks to install, then signs you in." icon={<Glyph>VS</Glyph>}>
          <a href={vscodeLink} className={softPill}><IoLinkOutline className="size-3.5" />Add to VS Code</a>
        </Row>
        <Row label="Claude Code" hint={<code className="font-mono text-[11px]">{claudeCodeCmd}</code>} icon={<IoTerminal className="size-4" />}>
          <button onClick={() => copy(claudeCodeCmd, "cc")} className={softPill}>{copied === "cc" ? <IoCheckmarkCircle className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy</button>
        </Row>
        <Row label={<span className="inline-flex items-center gap-2">Server URL <Tag tone="green">OAuth</Tag></span>} hint={mcpUrl}>
          <button onClick={() => copy(mcpUrl, "url")} className={softPill}>{copied === "url" ? <IoCheckmarkCircle className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy</button>
        </Row>
      </Section>

      <Section title="Connected" description="Assistants that have signed in to this account. Revoking signs them out at once.">
        {grants === undefined && <Row label="Loading" />}
        {grants?.length === 0 && <Row label="Nothing connected yet" hint="Connect an assistant above and it appears here." />}
        {grants?.map((g) => (
          <Row key={g.clientId} label={g.clientName} icon={<IoLinkOutline className="size-4" />}
            hint={`${g.scope.includes("tasks:write") ? "Read and write" : "Read only"} · connected ${formatDistanceToNow(g.createdAt, { addSuffix: true })}${g.lastUsedAt ? ` · used ${formatDistanceToNow(g.lastUsedAt, { addSuffix: true })}` : ""}`}>
            <button onClick={() => revoke({ clientId: g.clientId })} className={`${softPill} text-rose-600`}><IoTrashOutline className="size-3.5" />Revoke</button>
          </Row>
        ))}
      </Section>

      <ApiKey mcpUrl={mcpUrl} copy={copy} copied={copied} />
    </>
  );
}

function Glyph({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-bold tracking-tight">{children}</span>;
}

/** Fallback for clients that cannot do OAuth: one personal key, shown on demand. */
function ApiKey({ mcpUrl, copy, copied }: { mcpUrl: string; copy: (t: string, k: string) => Promise<void>; copied: string | null }) {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d: KeyInfo & { error?: string }) => (d.error ? setError(d.error) : setInfo(d)))
      .catch((e) => setError(String(e)));
  }, []);

  const regenerate = async () => {
    if (!window.confirm("Regenerate the key? Every client using the current one stops working.")) return;
    setBusy(true);
    try {
      const d = (await (await fetch("/api/tokens", { method: "POST" })).json()) as KeyInfo & { error?: string };
      if (d.error) setError(d.error); else { setInfo(d); setShown(true); }
    } finally { setBusy(false); }
  };

  const masked = info ? `${info.key.slice(0, 6)}${"•".repeat(28)}` : "";
  const setup = JSON.stringify({ mcpServers: { lexyos: { url: mcpUrl, headers: { Authorization: `Bearer ${info && shown ? info.key : "YOUR_KEY"}` } } } }, null, 2);

  return (
    <Section title="API key (fallback)" description="For scripts and clients without OAuth. Sent as a bearer token.">
      <div>
        <Row label="Key" icon={<IoKey className="size-4" />}
          hint={info ? `Created ${formatDistanceToNow(info.createdAt, { addSuffix: true })}${info.lastUsedAt ? ` · used ${formatDistanceToNow(info.lastUsedAt, { addSuffix: true })}` : " · never used"}` : error ?? "Loading"}>
          <button onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide key" : "Show key"} className={softPill} disabled={!info}>
            {shown ? <IoEyeOff className="size-3.5" /> : <IoEye className="size-3.5" />}{shown ? "Hide" : "Show"}
          </button>
          <button onClick={() => info && copy(info.key, "key")} className={softPill} disabled={!info}>
            {copied === "key" ? <IoCheckmarkCircle className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy
          </button>
        </Row>
        <div className="px-3.5 pb-3">
          <code className="block truncate rounded-full bg-black/[0.04] px-3.5 py-2 font-mono text-[12px] text-text-strong dark:bg-white/[0.06]">
            {info ? (shown ? info.key : masked) : "…"}
          </code>
        </div>
      </div>
      <Row label="Regenerate" hint="Revokes the current key. Clients need the new one.">
        <button onClick={regenerate} disabled={busy || !info} className={`${bluePill} disabled:opacity-50`}>
          <IoRefresh className="size-3.5" />{busy ? "Working" : "Regenerate"}
        </button>
      </Row>
      <div className="px-3.5 py-3">
        <div className="mb-1.5 text-[12px] text-text-muted">Manual setup{shown ? "" : " (show the key to fill it in)"}</div>
        <pre className="overflow-x-auto rounded-[12px] bg-black/[0.04] p-3 text-[12px] leading-relaxed text-text-strong dark:bg-white/[0.06]">{setup}</pre>
        <button onClick={() => copy(setup, "setup")} className={`${softPill} mt-2`}>{copied === "setup" ? <IoCheckmarkCircle className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy setup</button>
      </div>
    </Section>
  );
}
