import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Google Calendar changes reach Convex with no app open (convex/calendarPull.ts).
crons.interval("pull google calendars", { minutes: 5 }, internal.calendarPull.pullAll, {});

export default crons;
