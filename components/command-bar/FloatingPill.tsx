"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  CalendarAdd01Icon,
  Calendar01Icon,
  CheckListIcon,
  AiMagicIcon,
  Mic01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

const SUGGESTIONS = [
  { label: "Plan my day", icon: FlashIcon },
  { label: "Create a meeting tomorrow at 3pm", icon: CalendarAdd01Icon },
  { label: "What's on my calendar today?", icon: Calendar01Icon },
  { label: "Add task: Review pull requests", icon: CheckListIcon },
];

const LAYOUT_TRANSITION = { duration: 0.35, ease: [0.32, 0.72, 0, 1] as const };

const FloatingPill = memo(function FloatingPill() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new TextStreamChatTransport({ api: "/api/ai/chat" }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  // ⌘K to toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setExpanded(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-focus input when expanded
  useEffect(() => {
    if (expanded) { const t = setTimeout(() => inputRef.current?.focus(), 100); return () => clearTimeout(t); }
  }, [expanded]);

  // Click outside to close
  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) collapse();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 80);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onClick); };
  }, [expanded]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const collapse = useCallback(() => {
    setExpanded(false);
    setMessages([]);
    setInput("");
    setListening(false);
  }, [setMessages]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
  }, [input, isLoading, sendMessage]);

  const submitSuggestion = useCallback((text: string) => {
    sendMessage({ text });
  }, [sendMessage]);

  const handleMic = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) return;
    if (listening) { setListening(false); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>)
        .map((r) => r[0].transcript).join("");
      setInput(transcript);
    };
    recognition.onend = () => {
      setListening(false);
      // Auto-submit after speech — read the latest input value
      setTimeout(() => {
        const currentInput = inputRef.current?.value;
        if (currentInput?.trim()) {
          sendMessage({ text: currentInput.trim() });
          setInput("");
        }
      }, 100);
    };
    recognition.onerror = () => setListening(false);
    recognition.start();
  }, [listening, sendMessage]);

  // Get visible messages (only user + assistant with text parts)
  const visibleMessages = messages.filter((m) =>
    (m.role === "user" || m.role === "assistant") &&
    m.parts?.some((p) => p.type === "text" && p.text)
  );
  const hasMessages = visibleMessages.length > 0;

  // Extract text from message parts
  const getMessageText = (m: typeof messages[0]) =>
    m.parts?.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("") || "";

  const pillStyle = {
    borderRadius: 9999,
    background: "linear-gradient(180deg, rgba(40,40,55,0.85) 0%, rgba(15,15,20,0.9) 100%)",
    boxShadow: [
      "0 1px 0 0 rgba(255,255,255,0.08) inset",
      "0 -1px 0 0 rgba(0,0,0,0.3) inset",
      "0 4px 12px rgba(0,0,0,0.4)",
      "0 12px 40px rgba(0,0,0,0.3)",
    ].join(", "),
  };

  const panelStyle = {
    borderRadius: 16,
    background: "linear-gradient(180deg, rgba(35,35,48,0.92) 0%, rgba(12,12,16,0.95) 100%)",
    boxShadow: [
      "0 1px 0 0 rgba(255,255,255,0.07) inset",
      "0 -1px 0 0 rgba(0,0,0,0.3) inset",
      "0 8px 40px rgba(0,0,0,0.6)",
      "0 0 30px rgba(167,139,250,0.08)",
    ].join(", "),
  };

  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2" ref={containerRef}>
      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          {!expanded ? (
            <motion.button
              key="pill"
              layoutId="ai-command-container"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-3 rounded-full border border-[#3a3a4a]/60 px-5 py-2.5 backdrop-blur-xl"
              transition={LAYOUT_TRANSITION}
              style={pillStyle}
            >
              <motion.div layout="position" className="flex items-center">
                <HugeiconsIcon icon={AiMagicIcon} size={16} className="text-[#a78bfa]" />
              </motion.div>
              <motion.span layout="position" className="flex items-center text-sm leading-none text-[#71717a]">
                Ask AI anything...
              </motion.span>
              <motion.div layout="position" className="flex items-center">
                <Kbd>⌘K</Kbd>
              </motion.div>
            </motion.button>
          ) : (
            <motion.div
              key="panel"
              layoutId="ai-command-container"
              className="w-[560px] overflow-hidden rounded-2xl border border-[#3a3a4a]/60 backdrop-blur-2xl"
              transition={LAYOUT_TRANSITION}
              style={panelStyle}
            >
              {/* Messages area */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.2 }}
              >
                <div className="max-h-[320px] overflow-y-auto">
                  {/* Suggestions */}
                  {!hasMessages && !isLoading && (
                    <div className="px-4 py-3">
                      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#52525b]">
                        <HugeiconsIcon icon={AiMagicIcon} size={12} className="text-[#a78bfa]" />
                        Suggestions
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s.label}
                            onClick={() => submitSuggestion(s.label)}
                            className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
                          >
                            <HugeiconsIcon icon={s.icon} size={15} className="shrink-0 text-[#71717a]" />
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Chat messages */}
                  {hasMessages && (
                    <div className="flex flex-col gap-1 px-4 py-3">
                      {visibleMessages.map((m) => (
                        <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                          {m.role === "assistant" && (
                            <HugeiconsIcon icon={AiMagicIcon} size={14} className="mt-1 shrink-0 text-[#a78bfa]" />
                          )}
                          <div className={`rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                            m.role === "user"
                              ? "max-w-[80%] bg-[#a78bfa]/15 text-[#d4d4d8]"
                              : "flex-1 text-[#d4d4d8]"
                          }`}>
                            {getMessageText(m)}
                          </div>
                        </div>
                      ))}

                      {isLoading && <LoadingDots />}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Input row */}
              <div className="flex items-center gap-3 border-t border-[#1f1f28] px-4 py-3">
                <motion.div layout="position" className="flex items-center">
                  <HugeiconsIcon
                    icon={AiMagicIcon}
                    size={18}
                    className={`shrink-0 text-[#a78bfa] ${isLoading ? "animate-spin" : ""}`}
                  />
                </motion.div>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && input.trim()) { e.preventDefault(); handleSubmit(); }
                    if (e.key === "Escape") collapse();
                  }}
                  placeholder={listening ? "Listening..." : "Ask AI to manage your tasks, calendar, day..."}
                  className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#52525b]"
                />
                <button
                  type="button"
                  onClick={handleMic}
                  className={`relative flex size-8 items-center justify-center rounded-full transition-colors duration-150 ${
                    listening ? "bg-[#a78bfa]/20 text-[#a78bfa]" : "text-[#52525b] hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
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
                <button
                  type="button"
                  onClick={collapse}
                  className="flex size-7 items-center justify-center rounded-lg text-[#52525b] transition-colors duration-150 hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
});

export default FloatingPill;

function LoadingDots() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <HugeiconsIcon icon={AiMagicIcon} size={14} className="shrink-0 text-[#a78bfa]" />
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
