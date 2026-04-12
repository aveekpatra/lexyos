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
} from "@hugeicons/core-free-icons";


type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown }>;
};

// Module-level cache (survives re-renders, hydrated from Convex on load)
let _persistedMessages: ChatMsg[] = [];
let _msgCounter = 0;
let _hydrated = false;

const FloatingPill = memo(function FloatingPill() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(_persistedMessages);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // ⌘K focuses the input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const hasMessages = messages.length > 0;
  const [chatFolded, setChatFolded] = useState(false);


  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[480px] -translate-x-1/2" ref={containerRef}>
      <div
        className={`overflow-hidden rounded-[20px] border border-blue-300 bg-blue-50 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.12),0_1px_4px_-1px_rgba(0,0,0,0.08)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 dark:border-blue-500/40 dark:bg-blue-950/60 dark:shadow-[0_4px_24px_-2px_rgba(0,0,0,0.4),0_1px_4px_-1px_rgba(0,0,0,0.3)] ${callMode ? "ring-2 ring-blue-300/40" : ""}`}
      >
        {/* Messages area — slides up when messages exist */}
        <AnimatePresence>
          {hasMessages && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              {/* Controls bar */}
              <div className="flex items-center justify-between px-4 pt-2.5 pb-0">
                <button
                  type="button"
                  onClick={() => setChatFolded((f) => !f)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-line hover:text-text-secondary"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    className={`transition-transform ${chatFolded ? "" : "rotate-180"}`}>
                    <path d="M2 6.5L5 3.5L8 6.5" />
                  </svg>
                  {chatFolded ? "Show chat" : "Hide chat"}
                </button>
                <button
                  type="button"
                  onClick={() => { clearChat(); setChatFolded(false); }}
                  className="rounded-md px-2 py-0.5 text-[11px] text-text-faint transition-colors hover:bg-line hover:text-text-secondary"
                >
                  New chat
                </button>
              </div>

              {/* Chat messages — foldable */}
              <AnimatePresence>
                {!chatFolded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
              <div className="max-h-[320px] overflow-y-auto">
                <div className="flex flex-col gap-1 px-4 py-2">
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
                                  <span className="ml-auto text-emerald-400">done</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Text */}
                        {m.text}
                      </div>
                    </div>
                  ))}

                  {isLoading && <LoadingDots />}
                  <div ref={messagesEndRef} />
                </div>
              </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Voice / call mode indicator */}
        <AnimatePresence>
          {(listening || callMode) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className={`flex items-center gap-3 px-4 py-2 ${hasMessages ? "border-t border-line" : ""}`}>
                {/* Animated bars when actively listening */}
                {listening && !waitingForAI && (
                  <div className="flex items-center gap-[3px]">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.div
                        key={i}
                        className={`w-[3px] rounded-full ${callMode ? "bg-brand" : "bg-brand"}`}
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

        {/* Input row — always visible */}
        <div className={`flex items-center gap-2.5 px-4 py-2.5 ${hasMessages || listening || callMode ? "border-t border-blue-100 dark:border-blue-500/30" : ""}`}>
          <HugeiconsIcon
            icon={AppleIntelligenceIcon}
            size={16}
            className={`shrink-0 text-foreground dark:text-white ${isLoading ? "animate-spin" : ""}`}
          />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) { e.preventDefault(); handleSubmit(); }
            }}
            placeholder={callMode ? "Speak naturally..." : "Ask AI anything..."}
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
      </div>
    </div>
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
