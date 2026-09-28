"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section, Row, Tag } from "../primitives";
import { format, subDays, startOfDay, isSameDay } from "date-fns";
import { durationMinutes } from "@/lib/time-utils";

/* Real numbers from your tasks. Charts and time tracking come next. */
export function AnalyticsSection() {
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, {});

  const stats = useMemo(() => {
    const all = (tasks ?? []).filter((t) => !t.parentTaskId);
    const days = Array.from({ length: 14 }, (_, i) => startOfDay(subDays(new Date(), 13 - i)));
    const perDay = days.map((d) => all.filter((t) => t.completedAt && t.outcome !== "missed" && isSameDay(new Date(t.completedAt), d)).length);
    const week = perDay.slice(7).reduce((a, b) => a + b, 0);
    const prev = perDay.slice(0, 7).reduce((a, b) => a + b, 0);
    const open = all.filter((t) => t.status !== "done").length;
    const scheduledMin = all.filter((t) => t.status !== "done").reduce((sum, t) => sum + (durationMinutes(t.scheduledStartTime, t.scheduledEndTime) ?? 0), 0);
    const byProject = (projects ?? []).map((p) => ({ p, n: all.filter((t) => t.projectId === p._id && t.status !== "done").length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
    return { days, perDay, week, prev, open, scheduledMin, byProject, max: Math.max(1, ...perDay) };
  }, [tasks, projects]);

  return (
    <>
      <Section title="Last 14 days" description="Tasks completed per day.">
        <div className="px-3.5 py-3">
          <div className="flex h-24 items-end gap-1">
            {stats.perDay.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${format(stats.days[i], "EEE d")}: ${n}`}>
                <div className="w-full rounded-full bg-brand/80" style={{ height: `${Math.max(4, (n / stats.max) * 80)}px`, opacity: n ? 1 : 0.15 }} />
                <span className="text-[9px] text-text-faint">{format(stats.days[i], "EEEEE")}</span>
              </div>
            ))}
          </div>
        </div>
        <Row label="Completed this week" hint={`${stats.prev} the week before`}><span className="text-[15px] font-semibold tabular-nums text-text-strong">{stats.week}</span></Row>
        <Row label="Open tasks"><span className="text-[15px] font-semibold tabular-nums text-text-strong">{stats.open}</span></Row>
        <Row label="Time already scheduled" hint="Sum of open blocks with a start and end"><span className="text-[15px] font-semibold tabular-nums text-text-strong">{Math.round(stats.scheduledMin / 60 * 10) / 10} h</span></Row>
      </Section>
      <Section title="Open tasks by project">
        {stats.byProject.length === 0 && <Row label="Nothing open in a project" />}
        {stats.byProject.map(({ p, n }) => (
          <Row key={p._id} label={p.name} icon={<span className="size-3 rounded-full" style={{ backgroundColor: p.color }} />}><span className="tabular-nums text-text-secondary">{n}</span></Row>
        ))}
      </Section>
      <Section title="Next">
        <Row label={<span className="inline-flex items-center gap-2">Time tracking and focus stats <Tag>Coming</Tag></span>} hint="Planned versus actual time, per project and per week." />
      </Section>
    </>
  );
}
