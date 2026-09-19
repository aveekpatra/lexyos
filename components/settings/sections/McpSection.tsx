"use client";

import { useEffect, useState } from "react";
import { Section, Row, Tag } from "../primitives";
import { softPill, bluePill } from "@/lib/ui/chrome";
import { formatDistanceToNow } from "date-fns";
import { IoKey, IoCopy, IoCheckmark, IoEye, IoEyeOff, IoRefresh } from "react-icons/io5";

type KeyInfo = { key: string; createdAt: number; lastUsedAt: number | null };

/*
 * One personal API key per account. The server creates it on first visit and
 * hands it back sealed, so it can be shown again here. Regenerating revokes
 * the old one immediately.
 */
export function McpSection() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${origin}/api/mcp`;

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d: KeyInfo & { error?: string }) => (d.error ? setError(d.error) : setInfo(d)))
      .catch((e) => setError(String(e)));
  }, []);

  const copy = async (text: string, k: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(k);
    setTimeout(() => setCopied(null), 1500);
  };

  const regenerate = async () => {
    if (!window.confirm("Regenerate the key? Every client using the current one stops working.")) return;
    setBusy(true);
    try {
      const d = (await (await fetch("/api/tokens", { method: "POST" })).json()) as KeyInfo & { error?: string };
      if (d.error) setError(d.error); else { setInfo(d); setShown(true); }
    } finally { setBusy(false); }
  };

  const masked = info ? `${info.key.slice(0, 6)}${"\u2022".repeat(28)}` : "";
  const setup = JSON.stringify({ mcpServers: { mindbook: { url: mcpUrl, headers: { Authorization: `Bearer ${info && shown ? info.key : "YOUR_KEY"}` } } } }, null, 2);

  return (
    <>
      <Section title="Personal API key" description="One key for every client. Paste it as a bearer token in Claude, ChatGPT, or any MCP client.">
        <Row label="Key" icon={<IoKey className="size-4" />}
          hint={info ? `Created ${formatDistanceToNow(info.createdAt, { addSuffix: true })}${info.lastUsedAt ? ` \u00b7 used ${formatDistanceToNow(info.lastUsedAt, { addSuffix: true })}` : " \u00b7 never used"}` : error ?? "Loading"}>
          <button onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide key" : "Show key"} className={softPill} disabled={!info}>
            {shown ? <IoEyeOff className="size-3.5" /> : <IoEye className="size-3.5" />}{shown ? "Hide" : "Show"}
          </button>
          <button onClick={() => info && copy(info.key, "key")} className={softPill} disabled={!info}>
            {copied === "key" ? <IoCheckmark className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy
          </button>
        </Row>
        <div className="px-3.5 pb-3">
          <code className="block truncate rounded-full bg-black/[0.04] px-3.5 py-2 font-mono text-[12px] text-text-strong dark:bg-white/[0.06]">
            {info ? (shown ? info.key : masked) : "\u2026"}
          </code>
        </div>
        <Row label="Regenerate" hint="Revokes the current key. Clients need the new one.">
          <button onClick={regenerate} disabled={busy || !info} className={`${bluePill} disabled:opacity-50`}>
            <IoRefresh className="size-3.5" />{busy ? "Working" : "Regenerate"}
          </button>
        </Row>
      </Section>

      <Section title="Model Context Protocol" description="Same tools the in-app agent has: tasks, projects, planning, free time.">
        <Row label={<span className="inline-flex items-center gap-2">Server URL <Tag tone="green">Live</Tag></span>} hint={mcpUrl}>
          <button onClick={() => copy(mcpUrl, "url")} className={softPill}>{copied === "url" ? <IoCheckmark className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy</button>
        </Row>
        <div className="px-3.5 py-3">
          <div className="mb-1.5 text-[12px] text-text-muted">Client setup{shown ? "" : " (show the key to fill it in)"}</div>
          <pre className="overflow-x-auto rounded-[12px] bg-black/[0.04] p-3 text-[12px] leading-relaxed text-text-strong dark:bg-white/[0.06]">{setup}</pre>
          <button onClick={() => copy(setup, "setup")} className={`${softPill} mt-2`}>{copied === "setup" ? <IoCheckmark className="size-3.5" /> : <IoCopy className="size-3.5" />}Copy setup</button>
        </div>
      </Section>
    </>
  );
}
