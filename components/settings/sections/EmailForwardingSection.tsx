"use client";

import { Section, Row, Toggle, Tag } from "../primitives";
import { useSettings } from "@/lib/settings";
import { IoMail } from "react-icons/io5";

export function EmailForwardingSection() {
  const { settings, update } = useSettings();
  return (
    <>
      <Section title="Forwarding addresses" description="Forward an email and the subject becomes a task. Addresses appear here once the inbound mail service is wired up.">
        <Row label={<span className="inline-flex items-center gap-2">Inbox address <Tag>Coming</Tag></span>} hint="Creates a task for today" icon={<IoMail className="size-4" />} />
        <Row label="Someday address" hint="Creates an undated task" icon={<IoMail className="size-4" />} />
      </Section>
      <Section title="AI enrichment" description="Let the agent turn a forwarded email into a clear title and notes.">
        <Row label="Rewrite title and notes with AI" hint="Applies to forwarded emails only">
          <Toggle on={settings.email.aiEnrich} onChange={(v) => update("email", { aiEnrich: v })} />
        </Row>
      </Section>
    </>
  );
}
