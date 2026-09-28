"use client";

import { ReactNode, Suspense, useState, useCallback, useEffect } from "react";
import { ThemeSyncer } from "@/components/ThemeSyncer";
import { HelpDialog, useHelpShortcut } from "@/components/HelpDialog";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { UnifiedSearch } from "@/components/command-bar/UnifiedSearch";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { SettingsSyncer } from "@/components/settings/SettingsSyncer";
import { FocusTimer } from "@/components/focus/FocusTimer";
import { useSettings, matchesShortcut } from "@/lib/settings";
import { useMarkMissed } from "@/components/tasks/outcome";
import { targetTask } from "@/lib/task-target";
import FloatingPill from "@/components/command-bar/FloatingPill";
import { ConnectGoogleDialog, useGoogleConnection } from "@/components/google/ConnectGoogleDialog";

export default function AppLayout({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentSeed, setAgentSeed] = useState<string | undefined>(undefined);
  const [googleOpen, setGoogleOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const google = useGoogleConnection();
  const googleReady = google?.connected === true && !google.needsReconnect;

  const { settings } = useSettings();
  useHelpShortcut(useCallback(() => setHelpOpen(true), []), settings.shortcuts.help);

  // Mark missed: the card under the pointer, or the open task.
  const markMissed = useMarkMissed();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (!matchesShortcut(e, settings.shortcuts.markMissed)) return;
      const task = targetTask();
      if (!task || task.status === "done") return;
      e.preventDefault();
      void markMissed(task);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.shortcuts.markMissed, markMissed]);

  // Ctrl/Cmd+/ opens the unified search, the single entry point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, settings.shortcuts.palette)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.shortcuts.palette]);

  // Sync: pull calendar changes + process pending sync queue on start and every 2 minutes.
  // Only while a Google account is connected; otherwise the routes would just 409.
  useEffect(() => {
    if (!googleReady) return;
    const runSync = () => {
      fetch("/api/sync/pull-calendar", { method: "POST" }).catch(() => {});
      fetch("/api/sync/process-queue", { method: "POST" }).catch(() => {});
    };
    runSync();
    const interval = setInterval(runSync, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [googleReady]);

  // Hand a query from unified search over to the agent panel.
  const handleAskAI = useCallback((query: string) => {
    setAgentSeed(query);
    setAgentOpen(true);
  }, []);

  return (
    <div className="flex h-svh overflow-hidden bg-surface-0">
      <Sidebar
        onOpenSearch={() => setSearchOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenGoogle={() => setGoogleOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Flat shell (Aturno): grey rail on the left, white content, no islands. */}
      <main className="app-canvas flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Sync theme preference to Convex */}
      <ThemeSyncer />
      <SettingsSyncer />
      <FocusTimer />

      {/* Google Calendar connection prompt (auto-opens when missing) */}
      <Suspense fallback={null}>
        <ConnectGoogleDialog open={googleOpen} onOpenChange={setGoogleOpen} />
      </Suspense>
      {/* Unified search — projects + tasks + AI hand-off */}
      <UnifiedSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onAskAI={handleAskAI}
        onNewProject={() => setNewProjectOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenGoogle={() => setGoogleOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <CreateProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onOpenGoogle={() => setGoogleOpen(true)} />
      {/* Agent panel — always mounted so chat state survives navigation */}
      <FloatingPill
        open={agentOpen}
        onOpenChange={setAgentOpen}
        seed={agentSeed}
        onSeedConsumed={() => setAgentSeed(undefined)}
      />
      {/* Help dialog */}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
