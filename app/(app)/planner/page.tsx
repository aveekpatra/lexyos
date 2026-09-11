"use client";

import dynamic from "next/dynamic";

// The planner renders "today", the user's timezone and localStorage-persisted
// view state. Rendering it on the server (UTC, no storage) produced markup
// that differed from the client near midnight and for every non-UTC user, so
// it is client-only, like every calendar library recommends in Next.
const PlannerView = dynamic(() => import("@/components/planner/PlannerView"), {
  ssr: false,
  loading: () => <div className="flex flex-1 p-3" aria-busy="true" />,
});

export default function PlannerPage() {
  return <PlannerView />;
}
