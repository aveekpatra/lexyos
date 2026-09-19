"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section, Row } from "../primitives";
import { softPill } from "@/lib/ui/chrome";
import pkg from "@/package.json";
import { IoPersonCircle, IoDownload, IoRefresh } from "react-icons/io5";

export function AccountSection() {
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, {});
  const [cleared, setCleared] = useState(false);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), projects, tasks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lexyos-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const resetLocal = () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith("unifocus:")).forEach((k) => localStorage.removeItem(k)); } catch {}
    setCleared(true);
  };

  return (
    <>
      <Section title="Profile" description="Name, photo, email, and sign-in methods are managed in one place.">
        <Row label={user?.fullName || user?.firstName || "You"} hint={user?.primaryEmailAddress?.emailAddress} icon={<IoPersonCircle className="size-4" />}>
          <button onClick={() => openUserProfile()} className={softPill}>Manage profile</button>
        </Row>
      </Section>

      <Section title="Your data" description="Everything you own, as a file, whenever you want it.">
        <Row label="Export everything" hint={`${projects?.length ?? 0} projects, ${tasks?.length ?? 0} tasks as JSON`} icon={<IoDownload className="size-4" />}>
          <button onClick={exportJson} disabled={!tasks || !projects} className={`${softPill} disabled:opacity-50`}>Download</button>
        </Row>
        <Row label="Reset local data" hint="Clears view state, widths, and other per-device preferences. Your tasks are untouched." icon={<IoRefresh className="size-4" />}>
          <button onClick={resetLocal} className={softPill}>{cleared ? "Cleared" : "Reset"}</button>
        </Row>
      </Section>

      <Section title="About">
        <Row label="Lexyos" hint={`Version ${pkg.version}`} />
      </Section>
    </>
  );
}
