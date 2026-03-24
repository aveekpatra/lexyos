"use client";

import { useState, useRef, useEffect, useCallback, memo, useMemo } from "react";
import { useVoiceChat } from "@/lib/ai/useVoiceChat";
import { motion, AnimatePresence } from "motion/react";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  CalendarAdd01Icon,
  Calendar01Icon,
  CheckListIcon,
  AppleIntelligenceIcon,
  Mic01Icon,
} from "@hugeicons/core-free-icons";

const SUGGESTIONS = [
  { label: "Plan my day", icon: FlashIcon },
  { label: "Create a meeting tomorrow at 3pm", icon: CalendarAdd01Icon },
  { label: "What's on my calendar today?", icon: Calendar01Icon },
  { label: "Add task: Review pull requests", icon: CheckListIcon },
];


type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown }>;
};

// Module-level persistence
let _persistedMessages: ChatMsg[] = [];
let _msgCounter = 0;

const FloatingPill = memo(function FloatingPill() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(_persistedMessages);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Voice: fills the input box with transcript
  const fillInput = useCallback((text: string) => { setInput(text); }, []);
  const { listening, toggleVoice } = useVoiceChat(fillInput);

  // Persist messages
  useEffect(() => { _persistedMessages = messages; }, [messages]);

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
    setInput("");
  }, []);

  const sendMessage = useCallback(async (text: string) => {
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
        const assistantMsg: ChatMsg = {
          id: `msg-${++_msgCounter}`,
          role: "assistant",
          text: `Error: ${err.error || res.statusText}`,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        return;
      }

      const data = await res.json();
      const assistantMsg: ChatMsg = {
        id: `msg-${++_msgCounter}`,
        role: "assistant",
        text: data.text || "Done.",
        toolCalls: data.toolCalls,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMsg = {
        id: `msg-${++_msgCounter}`,
        role: "assistant",
        text: `Error: ${err instanceof Error ? err.message : "Network error"}`,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput("");
    sendMessage(text);
  }, [input, isLoading, sendMessage]);

  const submitSuggestion = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  const hasMessages = messages.length > 0;
  const [chatFolded, setChatFolded] = useState(false);


  const panelStyle = {
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(35,35,50,0.75) 0%, rgba(18,18,24,0.85) 100%)",
    boxShadow: [
      "0 1px 0 0 rgba(255,255,255,0.1) inset",
      "0 -1px 0 0 rgba(0,0,0,0.4) inset",
      "0 8px 40px rgba(0,0,0,0.5)",
      "0 0 30px rgba(167,139,250,0.06)",
      "0 0 0 1px rgba(255,255,255,0.06)",
    ].join(", "),
  };

  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[560px] -translate-x-1/2" ref={containerRef}>
      <div
        className="overflow-hidden rounded-3xl border border-white/[0.08] backdrop-blur-xl backdrop-saturate-150"
        style={panelStyle}
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
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[#71717a] transition-colors hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
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
                  className="rounded-md px-2 py-0.5 text-[11px] text-[#52525b] transition-colors hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
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
                          <HugeiconsIcon icon={AppleIntelligenceIcon} size={14} className="shrink-0 text-[#a78bfa]" />
                        </div>
                      )}
                      <div className={`rounded-xl text-sm leading-[21px] ${
                        m.role === "user"
                          ? "max-w-[80%] rounded-br-md bg-[#a78bfa]/15 px-3.5 py-2 text-[#d4d4d8]"
                          : "flex-1 text-[#d4d4d8]"
                      }`}>
                        {/* Tool calls */}
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <div className="mb-2 flex flex-col gap-1">
                            {m.toolCalls.map((tc, i) => (
                              <div key={i} className="rounded-lg border border-[#2a2a36] bg-[#12121a] px-3 py-2 text-xs">
                                <div className="flex items-center gap-2 text-[#a78bfa]">
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

        {/* Voice listening indicator — just shows animated bars when mic is active */}
        <AnimatePresence>
          {listening && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className={`flex items-center gap-3 px-4 py-2 ${hasMessages ? "border-t border-[#1f1f28]" : ""}`}>
                <div className="flex items-center gap-[3px]">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="w-[3px] rounded-full bg-[#a78bfa]"
                      animate={{ height: [4, 12 + Math.random() * 8, 4] }}
                      transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.08 }}
                    />
                  ))}
                </div>
                <p className="flex-1 truncate text-sm text-[#a1a1aa]">
                  Listening — speak now...
                </p>
                <button
                  type="button"
                  onClick={toggleVoice}
                  className="rounded-lg bg-[#a78bfa] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[#8b6fd4]"
                >
                  Stop
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row — always visible */}
        <div className={`flex items-center gap-3 px-4 py-3 ${hasMessages || listening ? "border-t border-[#1f1f28]" : ""}`}>
          <HugeiconsIcon
            icon={AppleIntelligenceIcon}
            size={18}
            className={`shrink-0 text-[#a78bfa] ${isLoading ? "animate-spin" : ""}`}
          />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) { e.preventDefault(); handleSubmit(); }
            }}
            placeholder="Ask AI to manage your tasks, calendar, day..."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#52525b]"
          />
          <button
            type="button"
            onClick={toggleVoice}
            className={`relative flex size-8 items-center justify-center rounded-full transition-colors duration-150 ${
              listening
                ? "bg-[#a78bfa]/20 text-[#a78bfa]"
                : "text-[#52525b] hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
            }`}
          >
            {listening && (
              <motion.div
                className="absolute inset-0 rounded-full border border-[#a78bfa]/40"
                animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <HugeiconsIcon icon={Mic01Icon} size={16} />
          </button>
          <Kbd>⌘K</Kbd>
        </div>
      </div>
    </div>
  );
});

export default FloatingPill;

function LoadingDots() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <HugeiconsIcon icon={AppleIntelligenceIcon} size={14} className="shrink-0 text-[#a78bfa]" />
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="size-1.5 rounded-full bg-[#a78bfa]"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}
