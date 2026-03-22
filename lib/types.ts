import { Doc } from "@/convex/_generated/dataModel";
import { GoogleEvent } from "@/app/actions/calendar";

export type TimelineItem =
  | { type: "event"; data: GoogleEvent; startTime: Date; endTime: Date }
  | { type: "task"; data: Doc<"tasks">; startTime: Date; endTime: Date }
  | { type: "deadline"; data: Doc<"tasks">; time: Date };
