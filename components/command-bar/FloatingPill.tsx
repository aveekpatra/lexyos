"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { useAuth } from "@clerk/nextjs";
import { processAICommand, AIAction } from "@/app/actions/ai";
import { addRecentCommand } from "./RecentCommands";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  CalendarAdd01Icon,
  Calendar01Icon,
  CheckListIcon,
  CheckmarkSquare01Icon,
  RefreshIcon,
  ListViewIcon,
  Clock01Icon,
  Layers01Icon,
  GridViewIcon,
  AiMagicIcon,
  Mic01Icon,
  ArrowTurnDownIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

const SUGGESTIONS = [
  { label: "Plan my day", icon: FlashIcon },
  { label: "Create a meeting tomorrow at 3pm", icon: CalendarAdd01Icon },
  { label: "What's on my calendar today?", icon: Calendar01Icon },
  { label: "Add task: Review pull requests", icon: CheckListIcon },
];

const ACTION_ICONS: Record<string, typeof FlashIcon> = {
  create_task: CheckmarkSquare01Icon,
  create_event: Calendar01Icon,
  update_task: RefreshIcon,
  list_tasks: ListViewIcon,
  find_slots: Clock01Icon,
  breakdown: Layers01Icon,
  plan_day: GridViewIcon,
};

/*
 * Smooth expand/collapse using layoutId shared element transitions.
 * Motion morphs between the pill and panel using GPU-accelerated transforms.
 * No width/height/border-radius is animated directly — all handled by FLIP.
 */

const LAYOUT_TRANSITION = { duration: 0.35, ease: [0.32, 0.72, 0, 1] as const };

const FloatingPill = memo(function FloatingPill() {
  const { getToken } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [actions, setActions] = useState<AIAction[]>([]);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setExpanded(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (expanded) { const t = setTimeout(() => inputRef.current?.focus(), 100); return () => clearTimeout(t); }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) collapse();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 80);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onClick); };
  }, [expanded]);

  const collapse = useCallback(() => {
    setExpanded(false);
    setResponse(null);
    setActions([]);
    setInput("");
    setListening(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || loading) return;
    const command = input.trim();
    setLoading(true);
    setResponse(null);
    setActions([]);
    try {
      const token = await getToken({ template: "convex" });
      if (!token) { setResponse("Authentication error."); return; }
      addRecentCommand(command);
      const result = await processAICommand(command, token);
      setResponse(result.message);
      setActions(result.actions);
    } catch {
      setResponse("Something went wrong. Check AI provider settings.");
    } finally {
      setLoading(false);
    }
  }, [input, loading, getToken]);

  const handleMic = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setResponse("Speech recognition not supported."); return;
    }
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
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
  }, [listening]);

  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2" ref={containerRef}>
      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          {!expanded ? (
            /* ─── Pill — shared layoutId morphs to panel ─── */
            <motion.button
              key="pill"
              layoutId="ai-command-container"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-3 rounded-full border border-[#2a2a36]/80 bg-[#0f0f14]/70 px-5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
              transition={LAYOUT_TRANSITION}
              style={{ borderRadius: 9999 }}
            >
              <motion.div layout="position">
                <HugeiconsIcon icon={AiMagicIcon} size={16} className="text-[#a78bfa]" />
              </motion.div>
              <motion.span layout="position" className="text-sm text-[#71717a]">
                Ask AI anything...
              </motion.span>
              <motion.div layout="position">
                <Kbd>⌘K</Kbd>
              </motion.div>
            </motion.button>
          ) : (
            /* ─── Panel — shared layoutId morphs from pill ─── */
            <motion.div
              key="panel"
              layoutId="ai-command-container"
              className="w-[560px] overflow-hidden rounded-2xl border border-[#2a2a36]/80 bg-[#0f0f14]/90 shadow-[0_8px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(167,139,250,0.08)] backdrop-blur-2xl"
              transition={LAYOUT_TRANSITION}
              style={{ borderRadius: 16 }}
            >
              {/* Input row */}
              <div className="flex items-center gap-3 border-b border-[#1f1f28] px-4 py-3">
                <motion.div layout="position">
                  <HugeiconsIcon
                    icon={AiMagicIcon}
                    size={18}
                    className={`shrink-0 text-[#a78bfa] ${loading ? "animate-spin" : ""}`}
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
                  onClick={collapse}
                  className="flex size-7 items-center justify-center rounded-lg text-[#52525b] transition-colors duration-150 hover:bg-[#1f1f28] hover:text-[#a1a1aa]"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} />
                </button>
              </div>

              {/* Content — fades in after morph */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.2 }}
              >
                <div className="max-h-[320px] overflow-y-auto">
                  {loading && <LoadingDots />}

                  {response && !loading && (
                    <div className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <HugeiconsIcon icon={AiMagicIcon} size={16} className="mt-0.5 shrink-0 text-[#a78bfa]" />
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#d4d4d8]">{response}</p>
                      </div>
                    </div>
                  )}

                  {actions.length > 0 && !loading && (
                    <div className="px-3 pb-3">
                      {actions.map((action, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#a1a1aa]"
                        >
                          <HugeiconsIcon
                            icon={ACTION_ICONS[action.type] || CheckmarkSquare01Icon}
                            size={15}
                            className="shrink-0 text-[#71717a]"
                          />
                          <span>{action.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!response && !loading && <SuggestionsList onSelect={setInput} />}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-[#1f1f28] px-4 py-2">
                  <div className="flex items-center gap-3 text-[11px] text-[#52525b]">
                    <span className="flex items-center gap-1">
                      <Kbd><HugeiconsIcon icon={ArrowTurnDownIcon} size={9} /></Kbd>
                      Send
                    </span>
                    <span className="flex items-center gap-1">
                      <Kbd>Esc</Kbd>
                      Close
                    </span>
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] text-[#3f3f4a]">
                    <HugeiconsIcon icon={AiMagicIcon} size={11} className="text-[#a78bfa]/40" />
                    AI-powered
                  </span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
});

export default FloatingPill;

const LoadingDots = memo(function LoadingDots() {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex gap-1">
        {[0, 0.15, 0.3].map((delay) => (
          <motion.div
            key={delay}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay }}
            className="size-1.5 rounded-full bg-[#a78bfa]"
          />
        ))}
      </div>
      <span className="text-sm text-[#71717a]">Thinking...</span>
    </div>
  );
});

const SuggestionsList = memo(function SuggestionsList({ onSelect }: { onSelect: (label: string) => void }) {
  return (
    <div className="p-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect(s.label)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[#a1a1aa] transition-colors duration-150 hover:bg-[#1a1a22] hover:text-white"
        >
          <HugeiconsIcon icon={s.icon} size={15} className="shrink-0 text-[#52525b]" />
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
});
