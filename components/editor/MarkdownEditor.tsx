"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import { RawText } from "@/components/editor/refs";
import { Ref, TaskNumberSuggestion, MentionSuggestion, WikiSuggestion, LinkShortcut } from "@/components/editor/links";
import { useLinkSources } from "@/lib/link-targets";

/**
 * Rich description editor that speaks Markdown on the wire.
 *
 * Markdown is the storage format on purpose: the AI tools and the MCP server
 * read `task.description` as plain text, so whatever is typed here is exactly
 * what the agent sees later. Headings, lists, checklists, quotes, code and
 * links all round-trip, and so do the Obsidian parts the Mac app writes: tables,
 * ==highlights==, callouts, and the #142 / [[Note]] links (as chips here).
 *
 * Linking as you type: "#" and a number picks a task, "@" or "[[" a task or a
 * note, and Cmd-K links the selected words.
 *
 * Commits on blur and after a short idle pause, keyed by `docKey` so switching
 * tasks never writes one task's draft into another.
 */
export function MarkdownEditor({
  docKey,
  value,
  onCommit,
  placeholder = "Write the context here...",
  className = "",
  autofocus = false,
}: {
  docKey: string;
  value: string;
  onCommit: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  autofocus?: boolean;
}) {
  useLinkSources();
  const lastCommitted = useRef(value);
  // Only a real edit writes back: reading a note must never re-save it in the
  // editor's own normalised Markdown.
  const dirty = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (editor: { getMarkdown: () => string }) => {
    if (!dirty.current) return;
    dirty.current = false;
    const md = editor.getMarkdown().trim();
    if (md === lastCommitted.current) return;
    lastCommitted.current = md;
    onCommit(md);
  };

  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: autofocus ? "end" : false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder }),
        TableKit.configure({ table: { resizable: false } }),
        Highlight,
        Ref,
        RawText,
        TaskNumberSuggestion,
        MentionSuggestion,
        WikiSuggestion,
        LinkShortcut,
        Markdown,
      ],
      content: value,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: `task-prose focus:outline-none ${className}`,
          "data-doc": docKey,
        },
      },
      onUpdate: ({ editor }) => {
        dirty.current = true;
        if (idle.current) clearTimeout(idle.current);
        idle.current = setTimeout(() => commit(editor), 1200);
      },
      onBlur: ({ editor }) => {
        if (idle.current) clearTimeout(idle.current);
        commit(editor);
      },
    },
    // Rebuild the editor when the document changes; the in-memory draft
    // belongs to the previous task and must not leak.
    [docKey],
  );

  // External change (another client, the AI) while this editor is idle:
  // adopt it. Never clobber a focused editor mid-typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [value, editor]);

  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);

  return <EditorContent editor={editor} />;
}
