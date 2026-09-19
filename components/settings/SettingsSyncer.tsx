"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSettings } from "@/lib/settings";
import { localDateStr, timeToMinutes } from "@/lib/time-utils";

/** Background effects driven by settings: daily rollover, due reminders. */
export function SettingsSyncer() {
  const { settings, update, loaded } = useSettings();
  const rollover = useMutation(api.tasks.rolloverOverdue);
  const tasks = useQuery(api.tasks.list, settings.dueDates.reminderNotifications ? {} : "skip");
  const ran = useRef(false);

  // Reminder notifications: 10 minutes before a timed task due today.
  useEffect(() => {
    if (!settings.dueDates.reminderNotifications || !tasks) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const check = () => {
      const now = new Date();
      const today = localDateStr(now);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      for (const t of tasks) {
        if (t.status === "done" || (t.dueDate || t.scheduledDate) !== today) continue;
        const start = timeToMinutes(t.dueTime || t.scheduledStartTime);
        if (start === null) continue;
        const key = `unifocus:reminded:${t._id}:${today}`;
        if (start - nowMin > 10 || start - nowMin < -1) continue;
        try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, "1"); } catch {}
        new Notification(t.title, { body: start - nowMin <= 0 ? "Starting now" : `In ${start - nowMin} min` });
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [settings.dueDates.reminderNotifications, tasks]);

  useEffect(() => {
    if (!loaded || ran.current || !settings.general.rolloverEnabled) return;
    const today = localDateStr(new Date());
    if (settings.general.lastRollover === today) return;
    ran.current = true;
    rollover({ today, includeRecurring: settings.general.rolloverRecurring }).then(() => update("general", { lastRollover: today })).catch(() => {});
  }, [loaded, settings.general.rolloverEnabled, settings.general.rolloverRecurring, settings.general.lastRollover, rollover, update]);

  return null;
}
