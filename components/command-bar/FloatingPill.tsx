"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useVoiceChat } from "@/lib/ai/useVoiceChat";
import { motion, AnimatePresence } from "motion/react";
import type { IconType } from "react-icons";
import {
  IoAlertCircle,
  IoArrowUp,
  IoCalendar,
  IoClose,
  IoContract,
  IoExpand,
  IoFlash,
  IoHelpCircle,
  IoMic,
  IoRemove,
  IoSparkles,
  IoTime,
} from "react-icons/io5";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown; error?: boolean }>;
  reasoning?: string;
};

// Module-level cache (survives re-renders, hydrated from Convex on load)
let _persistedMessages: ChatMsg[] = [];
let _msgCounter = 0;
let _hydrated = false;

const SUGGESTION_CHIPS: { label: string; Icon: IconType }[] = [
  { label: "What can you do?", Icon: IoHelpCircle },
  { label: "Timebox my day", Icon: IoTime },
  { label: "Show today's tasks", Icon: IoCalendar },
  { label: "What's overdue?", Icon: IoAlertCircle },
];

const FloatingPill = memo(function FloatingPill({
  open,
  onOpenChange,
  seed,
  onSeedConsumed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** A query handed over from unified search — sent as a message when it changes. */
  seed?: string;
  onSeedConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(_persistedMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Convex persistence
  const savedChat = useQuery(api.aiChats.get);
  const saveChat = useMutation(api.aiChats.save);

  // Hydrate from Convex once on load
  useEffect(() => {
    if (!_hydrated && savedChat?.messages && savedChat.messages.length > 0) {
      _hydrated = true;
      _persistedMessages = savedChat.messages as ChatMsg[];
      _msgCounter = _persistedMessages.length;
      setMessages(_persistedMessages);
    } else if (savedChat !== undefined) {
      _hydrated = true;
    }
  }, [savedChat]);

  // Send message (shared between manual and auto-submit). Returns assistant text.
  const sendMessage = useCallback(async (text: string): Promise<string> => {
    const userMsg: ChatMsg = { id: `msg-${++_msgCounter}`, role: "user", text };
    const updatedMessages = [..._persistedMessages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            parts: [{ type: "text", text: m.text }],
            toolCalls: m.toolCalls,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        const errText = `Error: ${err.error || res.statusText}`;
        const assistantMsg: ChatMsg = { id: `msg-${++_msgCounter}`, role: "assistant", text: errText };
        setMessages((prev) => [...prev, assistantMsg]);
        return errText;
      }

      const data = await res.json();
      const responseText = data.text || "Done.";
      const assistantMsg: ChatMsg = {
        id: `msg-${++_msgCounter}`,
        role: "assistant",
        text: responseText,
        toolCalls: data.toolCalls,
        reasoning: typeof data.reasoning === "string" ? data.reasoning : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      return responseText;
    } catch (err) {
      const errText = `Error: ${err instanceof Error ? err.message : "Network error"}`;
      const assistantMsg: ChatMsg = { id: `msg-${++_msgCounter}`, role: "assistant", text: errText };
      setMessages((prev) => [...prev, assistantMsg]);
      return errText;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fillInput = useCallback((text: string) => { setInput(text); }, []);
  const { listening, toggleVoice } = useVoiceChat({ onTranscript: fillInput });

  // Persist messages to module + Convex (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    _persistedMessages = messages;
    if (!_hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChat({ messages }).catch(() => {});
    }, 500);
  }, [messages, saveChat]);

  // Escape closes. Ctrl/Cmd+/ is owned by unified search, not by this panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  // Unified search hand-off: send the seeded query as soon as it arrives.
  // Reset on clear so the same query can be handed over again later.
  const seedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!seed) {
      seedRef.current = undefined;
      return;
    }
    if (seed === seedRef.current) return;
    seedRef.current = seed;
    sendMessage(seed);
    onSeedConsumed?.();
  }, [seed, sendMessage, onSeedConsumed]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput("");
    sendMessage(text);
  }, [input, isLoading, sendMessage]);

  const handleChipClick = useCallback((chip: string) => {
    if (isLoading) return;
    sendMessage(chip);
  }, [isLoading, sendMessage]);

  const hasMessages = messages.length > 0;

  // Linear-exact ghost icon buttons: 28px (header) / 24px (footer) circles
  const headerBtn =
    "flex size-7 shrink-0 items-center justify-center rounded-full text-[#62646a] transition-colors hover:bg-black/[0.05] hover:text-[#17181b] dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white";
  const footerBtn =
    "relative flex size-6 shrink-0 items-center justify-center rounded-full text-[#62646a] transition-colors hover:bg-black/[0.06] hover:text-[#17181b] dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white";

  return (
    <>
      {/* ===== COLLAPSED: floating trigger ===== */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            onClick={() => onOpenChange(true)}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full border-[0.5px] border-black/[0.08] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.06),0_3px_9px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.06)] transition-transform duration-200 hover:scale-105 dark:border-white/10 dark:bg-[#1c1c1f]"
            title="Open Agent"
          >
            <IoSparkles size={20} className="text-text-strong" />
            {hasMessages && (
              <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-brand dark:border-[#1c1c1f]" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ===== EXPANDED: chat panel (Linear agents-panel spec) ===== */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed bottom-5 right-5 z-50 flex w-[400px] flex-col overflow-hidden rounded-t-[12px] rounded-b-[16px] border-[0.5px] border-[#e0e0e3] bg-white font-[family-name:var(--font-inter)] shadow-[0_6px_18px_rgba(0,0,0,0.02),0_3px_9px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.04)] transition-[height] duration-300 ease-in-out dark:border-white/10 dark:bg-[#191a1d]"
            style={{ height: isMaximized ? "calc(100vh - 40px)" : "600px", maxHeight: "calc(100vh - 40px)" }}
          >
            {/* ── Header — compact, pl 10 / pr 6 ── */}
            <div className="flex h-[38px] shrink-0 items-center gap-0.5 pl-[10px] pr-[6px]">
              {isLoading && (
                <IoSparkles size={14} className="shrink-0 animate-pulse text-brand" />
              )}
              <span className="flex-1 text-[13px] font-medium text-[#17181b] dark:text-white">
                Agent
              </span>
              <button type="button" onClick={() => onOpenChange(false)} title="Minimize" className={headerBtn}>
                <IoRemove size={16} />
              </button>
              <button
                type="button"
                onClick={() => setIsMaximized((v) => !v)}
                title={isMaximized ? "Collapse" : "Expand"}
                className={headerBtn}
              >
                {isMaximized ? <IoContract size={14} /> : <IoExpand size={14} />}
              </button>
              <button type="button" onClick={() => onOpenChange(false)} title="Close" className={headerBtn}>
                <IoClose size={17} />
              </button>
            </div>

            {/* ── Content card — inset 5px, rounded top 8px, grey→white gradient ── */}
            <div className="mx-[5px] flex-1 overflow-y-auto rounded-t-[8px] bg-gradient-to-b from-[#f2f2f4] to-white dark:from-white/[0.06] dark:to-transparent">
              {hasMessages ? (
                <div className="flex flex-col gap-1 px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex items-start gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
                      {m.role === "assistant" && (
                        <div className="flex h-[21px] items-center">
                          <IoSparkles size={13} className="shrink-0 text-brand" />
                        </div>
                      )}
                      <div className={`rounded-xl text-[13px] leading-[21px] ${
                        m.role === "user"
                          ? "max-w-[80%] rounded-br-md bg-black/[0.05] px-3 py-1.5 text-text-strong dark:bg-white/[0.08]"
                          : "flex-1 text-text-strong"
                      }`}>
                        {m.reasoning && (
                          <details className="mb-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-text-muted dark:bg-white/[0.05]">
                            <summary className="cursor-pointer select-none font-medium text-text-secondary">Thinking</summary>
                            <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{m.reasoning}</p>
                          </details>
                        )}
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <div className="mb-2 flex flex-col gap-1">
                            {m.toolCalls.map((tc, i) => (
                              <div key={i} className="rounded-lg border-[0.5px] border-black/[0.08] bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                                <div className="flex items-center gap-2 text-brand">
                                  <IoFlash size={12} />
                                  <span className="font-medium">{tc.toolName.replace(/_/g, " ")}</span>
                                  <span className={`ml-auto ${tc.error ? "text-red-400" : "text-emerald-500"}`}>
                                    {tc.error ? "failed" : "done"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <MiniMarkdown text={m.text} />
                      </div>
                    </div>
                  ))}
                  {isLoading && <LoadingDots />}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                /* Empty state — Linear: bottom-anchored, body pad 24/16/32 */
                <div className="flex h-full flex-col items-center justify-end px-4 pb-8 pt-6">
                  <IoSparkles size={17} className="mb-2 text-[#62646a] dark:text-white/50" />
                  <p className="mb-1 text-[13px] font-semibold text-[#17181b] dark:text-white">How can I help?</p>
                  <p className="mb-5 text-center text-[13px] text-[#62646a] dark:text-white/60">
                    Ask anything or tell Mindbook what you need
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTION_CHIPS.map(({ label, Icon }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleChipClick(label)}
                        className="inline-flex h-[29px] items-center gap-1.5 rounded-full border-[0.5px] border-black/[0.088] bg-white px-[10px] py-[6px] text-[13px] font-medium text-[#17181b] shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafb] dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.1]"
                      >
                        <Icon size={14} className="shrink-0 text-[#62646a] dark:text-white/55" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Input — inset 5px wrapper (p-1), 7px-radius white box (Linear) ── */}
            <div className="mx-[5px] mb-1 shrink-0 rounded-[8px] p-1">
              <div className="rounded-[7px] border-[0.5px] border-[#e5e5e8] bg-white px-1 py-1.5 shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-white/[0.05]">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask anything or add a task"
                  className="w-full bg-transparent px-2 py-1 text-[13px] text-[#17181b] outline-none placeholder:text-[#8a8c92] dark:text-white dark:placeholder:text-white/40"
                />
                <div className="mt-2 flex items-center justify-between px-1">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={toggleVoice}
                      title="Voice input"
                      className={listening ? footerBtn + " bg-brand/12 !text-brand" : footerBtn}
                    >
                      {listening && (
                        <motion.div
                          className="absolute inset-0 rounded-full border border-brand/40"
                          animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                        />
                      )}
                      <IoMic size={15} />
                    </button>
                  </div>

                  {/* Circular send — brand blue disc with up-arrow */}
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!input.trim() || isLoading}
                    title="Send"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-brand-strong disabled:opacity-40"
                  >
                    <IoArrowUp size={13} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});

export default FloatingPill;

function LoadingDots() {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-[21px] items-center">
        <IoSparkles size={13} className="shrink-0 text-brand" />
      </div>
      <div className="flex h-[21px] items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="size-1.5 rounded-full bg-brand"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

/** Lightweight inline markdown: **bold**, *italic*, `code`, and bullet lists */
function MiniMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <span>
      {lines.map((line, li) => {
        const isBullet = /^[-•]\s+/.test(line);
        const content = isBullet ? line.replace(/^[-•]\s+/, "") : line;
        const rendered = renderInline(content);
        return (
          <span key={li}>
            {li > 0 && <br />}
            {isBullet && <span className="mr-1 text-text-faint">•</span>}
            {rendered}
          </span>
        );
      })}
    </span>
  );
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-black/[0.06] px-1 py-0.5 text-xs dark:bg-white/[0.1]">{match[4]}</code>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
