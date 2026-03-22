"use client";

import { ReactNode, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
  Calendar01Icon,
  FolderLibraryIcon,
  Settings01Icon,
  Clock01Icon,
  HelpCircleIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { icon: InboxIcon, label: "Inbox", href: "/timeline" },
  { icon: Calendar01Icon, label: "Planner", href: "/planner" },
  { icon: FolderLibraryIcon, label: "Projects", href: "/projects" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandBarOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-svh overflow-hidden">
      {/* Icon rail */}
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-[#1f1f25] bg-[#0c0c0f] py-3">
        <div className="mb-4">
          <UserButton
            appearance={{
              elements: { avatarBox: { width: 28, height: 28 } },
            }}
          />
        </div>

        <nav className="flex flex-col items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <RailButton
              key={item.label}
              icon={item.icon}
              label={item.label}
              isActive={pathname === item.href}
              onClick={() => router.push(item.href)}
            />
          ))}
          <RailButton
            icon={Search01Icon}
            label="Search"
            onClick={() => setCommandBarOpen(true)}
          />
        </nav>

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-1">
          <RailButton icon={Settings01Icon} label="Settings" />
          <RailButton icon={Clock01Icon} label="Activity" />
          <RailButton icon={HelpCircleIcon} label="Help" />
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {commandBarOpen && (
        <CommandBarLazy onClose={() => setCommandBarOpen(false)} />
      )}
    </div>
  );
}

function RailButton({
  icon,
  label,
  isActive,
  onClick,
}: {
  icon: typeof InboxIcon;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? "bg-[#1f1f28] text-white"
                : "text-[#52525b] hover:bg-[#18181d] hover:text-[#a1a1aa]"
            }`}
          />
        }
      >
        <HugeiconsIcon icon={icon} size={18} />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function CommandBarLazy({ onClose }: { onClose: () => void }) {
  const [CommandBar, setCommandBar] =
    useState<React.ComponentType<{ onClose: () => void }> | null>(null);

  useEffect(() => {
    import("@/components/command-bar/CommandBar")
      .then((mod) => setCommandBar(() => mod.default))
      .catch(console.error);
  }, []);

  if (!CommandBar) return null;
  return <CommandBar onClose={onClose} />;
}
