"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { processAICommand, AIAction } from "@/app/actions/ai";
import { addRecentCommand } from "./RecentCommands";
import {
  CommandDialog,
  CommandDialogPopup,
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandSeparator,
  CommandFooter,
  CommandPanel,
  CommandEmpty,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  CalendarAdd01Icon,
  CheckListIcon,
  Clock01Icon,
  CheckmarkSquare01Icon,
  Calendar01Icon,
  RefreshIcon,
  ListViewIcon,
  Layers01Icon,
  GridViewIcon,
  Loading03Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowTurnDownIcon,
  AiMagicIcon,
} from "@hugeicons/core-free-icons";

interface CommandBarProps {
  onClose: () => void;
}

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

export default function CommandBar({ onClose }: CommandBarProps) {
  const { getToken } = useAuth();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [actions, setActions] = useState<AIAction[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("unifocus-recent-commands") || "[]"
      );
      setRecentCommands(stored);
    } catch {
      // ignore
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || loading) return;
    const command = input.trim();
    setLoading(true);
    setResponse(null);
    setActions([]);

    try {
      const token = await getToken({ template: "convex" });
      if (!token) {
        setResponse("Authentication error. Please sign in again.");
        return;
      }
      addRecentCommand(command);
      const result = await processAICommand(command, token);
      setResponse(result.message);
      setActions(result.actions);
    } catch {
      setResponse(
        "Something went wrong. Please check your AI provider settings."
      );
    } finally {
      setLoading(false);
    }
  }, [input, loading, getToken]);

  const allItems = [
    ...SUGGESTIONS.map((s) => s.label),
    ...recentCommands.filter(
      (c) => !SUGGESTIONS.some((s) => s.label === c)
    ),
  ];

  return (
    <CommandDialog open onOpenChange={(open) => !open && onClose()}>
      <CommandDialogPopup className="command-glow">
        <Command items={allItems}>
          <CommandInput
            placeholder="Ask AI to create events, tasks, plan your day..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          <CommandPanel>
            {loading && (
              <div className="flex items-center gap-3 px-5 py-4">
                <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin text-brand" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            )}

            {response && !loading && (
              <div className="flex items-start gap-3 px-5 py-4">
                <HugeiconsIcon icon={AiMagicIcon} size={16} className="mt-0.5 shrink-0 text-brand" />
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{response}</p>
              </div>
            )}

            {actions.length > 0 && !loading && (
              <div className="px-3 pb-3">
                {actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm">
                    <HugeiconsIcon
                      icon={ACTION_ICONS[action.type] || CheckmarkSquare01Icon}
                      size={16}
                      className="shrink-0 opacity-60"
                    />
                    <span>{action.summary}</span>
                  </div>
                ))}
              </div>
            )}

            {!response && !loading && (
              <CommandList>
                <CommandEmpty>
                  <span className="text-sm text-muted-foreground">Type a command or question...</span>
                </CommandEmpty>

                {recentCommands.length > 0 && (
                  <CommandGroup>
                    <CommandGroupLabel>Recent</CommandGroupLabel>
                    {recentCommands.map((cmd) => (
                      <CommandItem key={cmd} onSelect={() => setInput(cmd)} className="gap-3">
                        <HugeiconsIcon icon={Clock01Icon} size={16} className="shrink-0 opacity-60" />
                        <span>{cmd}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                <CommandSeparator />

                <CommandGroup>
                  <CommandGroupLabel>Suggestions</CommandGroupLabel>
                  {SUGGESTIONS.map((s) => (
                    <CommandItem key={s.label} onSelect={() => setInput(s.label)} className="gap-3">
                      <HugeiconsIcon icon={s.icon} size={16} className="shrink-0 opacity-60" />
                      <span>{s.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            )}
          </CommandPanel>

          <CommandFooter>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Kbd><HugeiconsIcon icon={ArrowUp01Icon} size={10} /></Kbd>
                <Kbd><HugeiconsIcon icon={ArrowDown01Icon} size={10} /></Kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd><HugeiconsIcon icon={ArrowTurnDownIcon} size={10} /></Kbd>
                Open
              </span>
            </div>
            <span className="flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              Close
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
