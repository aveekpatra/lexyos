"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import NotesView from "@/components/notes/NotesView";

export default function NotesPage() {
  const params = useParams<{ id?: string[] }>();
  const id = params.id?.[0] ?? null;
  return <NotesView noteId={id as Id<"notes"> | null} />;
}
