"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import ProjectBoard from "@/components/project-board/ProjectBoard";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  return <ProjectBoard projectId={params.id as Id<"projects">} />;
}
