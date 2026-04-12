"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useVoiceChat, playCartesiaTTS } from "@/lib/ai/useVoiceChat";
import { motion, AnimatePresence } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  AppleIntelligenceIcon,
  Mic01Icon,
  TelephoneIcon,
  Cancel01Icon,
  MoreHorizontalIcon,
  ArrowExpand02Icon,
  ArrowShrink02Icon,
} from "@hugeicons/core-free-icons";


type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown; error?: boolean }>;
};

// Module-level cache (survives re-renders, hydrated from Convex on load)
let _persistedMessages: ChatMsg[] = [];
let _msgCounter = 0;
let _hydrated = false;

const SUGGESTION_CHIPS = [
  "What can you do?",
  "Timebox my day",
  "Show my tasks for today",
  "What's overdue?",
];

const FloatingPill = memo(function FloatingPill() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(_persistedMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Convex persistence
  const savedChat = useQuery(api.aiChats.get);
  const saveChat = useMutation(api.aiChats.save);
  const clearConvexChat = useMutation(api.aiChats.clear);

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
        const assistantMsg: ChatMsg = {
          id: `msg-${++_msgCounter}`,
          role: "assistant",
          text: errText,
        };
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
      };
      setMessages((prev) => [...prev, assistantMsg]);
      return responseText;
    } catch (err) {
      const errText = `Error: ${err instanceof Error ? err.message : "Network error"}`;
      const assistantMsg: ChatMsg = {
        id: `msg-${++_msgCounter}`,
        role: "assistant",
        text: errText,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      return errText;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-submit handler for call mode — sends message then speaks response via TTS
  const handleAutoSubmit = useCallback(async (text: string) => {
    const responseText = await sendMessage(text);
    if (responseText && !responseText.startsWith("Error:")) {
      try {
        await playCartesiaTTS(responseText);
      } catch (err) {
        console.warn("[TTS] Playback failed:", err);
      }
    }
  }, [sendMessage]);

  // Voice: fills the input box with transcript
  const fillInput = useCallback((text: string) => { setInput(text); }, []);
  const { listening, callMode, waitingForAI, toggleVoice, toggleCallMode } = useVoiceChat({
    onTranscript: fillInput,
    onAutoSubmit: handleAutoSubmit,
  });

  // Persist messages to module + Convex (debounced to avoid excessive writes)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    _persistedMessages = messages;
    if (!_hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChat({ messages }).catch(() => {});
    }, 500);
  }, [messages, saveChat]);

  // Ctrl+K focuses the input and opens panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      // Escape closes the panel
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showMenu]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const clearChat = useCallback(() => {
    setMessages([]);
    _persistedMessages = [];
    _msgCounter = 0;
    setInput("");
    clearConvexChat().catch(() => {});
  }, [clearConvexChat]);

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

  return (
    <>
      {/* ===== COLLAPSED STATE: Floating icon button ===== */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            type="button"
            onClick={() => setIsOpen(true)}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full border border-blue-300 bg-blue-50 shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl dark:border-blue-500/40 dark:bg-blue-950/80 dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
            title="Open AI assistant (Ctrl+K)"
          >
            <HugeiconsIcon
              icon={AppleIntelligenceIcon}
              size={22}
              className="text-foreground dark:text-white"
            />
            {/* Unread indicator dot when there are messages */}
            {hasMessages && (
              <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-blue-50 bg-brand dark:border-blue-950/80" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ===== EXPANDED STATE: Full chat panel ===== */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed bottom-5 right-5 z-50 flex w-[400px] flex-col overflow-hidden rounded-2xl border border-blue-300 bg-blue-50 shadow-[0_8px_32px_-4px_rgba(0,0,0,0.15),0_2px_8px_-2px_rgba(0,0,0,0.1)] transition-[height] duration-300 ease-in-out dark:border-blue-500/40 dark:bg-blue-950/80 dark:shadow-[0_8px_32px_-4px_rgba(0,0,0,0.5),0_2px_8px_-2px_rgba(0,0,0,0.3)]"
            style={{ height: isMaximized ? "calc(100vh - 40px)" : "580px", maxHeight: "calc(100vh - 40px)" }}
          >
            {/* ── Header ── */}
            <div className="flex shrink-0 items-center gap-3 border-b border-blue-100 px-4 py-3 dark:border-blue-500/30">
              <HugeiconsIcon
                icon={AppleIntelligenceIcon}
                size={18}
                className={`shrink-0 text-foreground dark:text-white ${isLoading ? "animate-spin" : ""}`}
              />
              <span className="flex-1 text-sm font-semibold text-foreground dark:text-white">
                UniFocus AI
              </span>

              {/* Menu button */}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setShowMenu((v) => !v)}
                  className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-blue-200/40 hover:text-foreground dark:text-white/60 dark:hover:bg-blue-500/20 dark:hover:text-white"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                </button>
                {/* Dropdown menu */}
                <AnimatePresence>
                  {showMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full right-0 z-10 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-line bg-surface-0 py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() => { clearChat(); setShowMenu(false); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-1"
                      >
                        New chat
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Expand/shrink toggle */}
              <button
                type="button"
                onClick={() => setIsMaximized((v) => !v)}
                title={isMaximized ? "Shrink panel" : "Expand panel"}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-blue-200/40 hover:text-foreground dark:text-white/60 dark:hover:bg-blue-500/20 dark:hover:text-white"
              >
                <HugeiconsIcon icon={isMaximized ? ArrowShrink02Icon : ArrowExpand02Icon} size={15} />
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-blue-200/40 hover:text-foreground dark:text-white/60 dark:hover:bg-blue-500/20 dark:hover:text-white"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </button>
            </div>

            {/* ── Messages area ── */}
            <div className="flex-1 overflow-y-auto">
              {hasMessages ? (
                <div className="flex flex-col gap-1 px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex items-start gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
                      {m.role === "assistant" && (
                        <div className="flex h-[21px] items-center">
                          <HugeiconsIcon icon={AppleIntelligenceIcon} size={14} className="shrink-0 text-brand" />
                        </div>
                      )}
                      <div className={`rounded-xl text-sm leading-[21px] ${
                        m.role === "user"
                          ? "max-w-[80%] rounded-br-md bg-brand/15 px-3.5 py-2 text-text-strong"
                          : "flex-1 text-text-strong"
                      }`}>
                        {/* Tool calls */}
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <div className="mb-2 flex flex-col gap-1">
                            {m.toolCalls.map((tc, i) => (
                              <div key={i} className="rounded-lg border border-line-strong bg-surface-0 px-3 py-2 text-xs">
                                <div className="flex items-center gap-2 text-brand">
                                  <HugeiconsIcon icon={FlashIcon} size={12} />
                                  <span className="font-medium">{tc.toolName.replace(/_/g, " ")}</span>
                                  <span className={`ml-auto ${tc.error ? "text-red-400" : "text-emerald-400"}`}>
                                    {tc.error ? "failed" : "done"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Text */}
                        <MiniMarkdown text={m.text} />
                      </div>
                    </div>
                  ))}

                  {isLoading && <LoadingDots />}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                /* Empty state with suggestion chips */
                <div className="flex flex-col items-center justify-center px-6 py-10">
                  <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-brand/10">
                    <HugeiconsIcon icon={AppleIntelligenceIcon} size={20} className="text-brand" />
                  </div>
                  <p className="mb-1 text-sm font-medium text-text-strong">How can I help?</p>
                  <p className="mb-5 text-center text-xs text-text-muted">
                    Manage tasks, check your schedule, draft emails, and more.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleChipClick(chip)}
                        className="rounded-full border border-line bg-surface-0 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-text-strong"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Voice / call mode indicator ── */}
            <AnimatePresence>
              {(listening || callMode) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="shrink-0 overflow-hidden"
                >
                  <div className="flex items-center gap-3 border-t border-blue-100 px-4 py-2 dark:border-blue-500/30">
                    {/* Animated bars when actively listening */}
                    {listening && !waitingForAI && (
                      <div className="flex items-center gap-[3px]">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <motion.div
                            key={i}
                            className="w-[3px] rounded-full bg-brand"
                            animate={{ height: [4, 12 + Math.random() * 8, 4] }}
                            transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.08 }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Pulsing dot when waiting for AI in call mode */}
                    {callMode && waitingForAI && (
                      <motion.div
                        className="size-2.5 rounded-full bg-brand"
                        animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}

                    <p className="flex-1 truncate text-sm text-text-secondary">
                      {callMode
                        ? waitingForAI
                          ? "Thinking..."
                          : "Listening — I'll act when you pause..."
                        : "Listening — speak now..."
                      }
                    </p>

                    <button
                      type="button"
                      onClick={callMode ? toggleCallMode : toggleVoice}
                      className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-strong"
                    >
                      {callMode ? "End call" : "Stop"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Input row ── */}
            <div className="flex shrink-0 items-center gap-2.5 border-t border-blue-100 px-4 py-2.5 dark:border-blue-500/30">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) { e.preventDefault(); handleSubmit(); }
                }}
                placeholder={callMode ? "Speak naturally..." : "Ask anything..."}
                className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-faint dark:text-white dark:placeholder:text-blue-200/50"
                disabled={callMode && listening}
              />

              {/* Mic button */}
              <button
                type="button"
                onClick={toggleVoice}
                className={`relative flex size-7 items-center justify-center rounded-full transition-colors duration-150 ${
                  listening && !callMode
                    ? "bg-blue-200/50 text-foreground dark:bg-blue-500/30 dark:text-white"
                    : "text-text-muted hover:bg-blue-200/40 hover:text-foreground dark:text-white/70 dark:hover:bg-blue-500/20 dark:hover:text-white"
                }`}
              >
                {listening && !callMode && (
                  <motion.div
                    className="absolute inset-0 rounded-full border border-blue-300/50"
                    animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <HugeiconsIcon icon={Mic01Icon} size={14} />
              </button>

              {/* Call mode button */}
              <button
                type="button"
                onClick={toggleCallMode}
                title={callMode ? "End call mode" : "Start call mode"}
                className={`relative flex size-7 items-center justify-center rounded-full transition-colors duration-150 ${
                  callMode
                    ? "bg-blue-200/50 text-foreground dark:bg-blue-500/30 dark:text-white"
                    : "text-text-muted hover:bg-blue-200/40 hover:text-foreground dark:text-white/70 dark:hover:bg-blue-500/20 dark:hover:text-white"
                }`}
              >
                {callMode && (
                  <motion.div
                    className="absolute inset-0 rounded-full border border-blue-300/50"
                    animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <HugeiconsIcon icon={TelephoneIcon} size={13} />
              </button>
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
        <HugeiconsIcon icon={AppleIntelligenceIcon} size={14} className="shrink-0 text-brand" />
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
  // Match **bold**, *italic*, `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-surface-1 px-1 py-0.5 text-xs">{match[4]}</code>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
