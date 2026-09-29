"use client";

import { Extension, ReactNodeViewRenderer, ReactRenderer, NodeViewWrapper, type Editor, type NodeViewProps } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { findLinkTargets, type LinkItem, type LinkTrigger } from "@/lib/link-targets";
import { RefNode, type RefAttrs } from "@/components/editor/refs";
import { LinkMenu, type LinkMenuHandle } from "@/components/editor/LinkMenu";

function refFor(item: LinkItem, label: string | null = null): RefAttrs {
  return item.kind === "task"
    ? { kind: "task", target: String(item.number), label }
    : { kind: "note", target: item.title, label };
}

/* ─── The chip: "#142 Title" for a task, the note's title for a note ─── */

function RefChip({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as RefAttrs;
  const router = useRouter();
  const number = attrs.kind === "task" ? Number(attrs.target) : NaN;
  const task = useQuery(api.tasks.byNumber, attrs.kind === "task" && Number.isFinite(number) ? { number } : "skip");
  const noteTitle = attrs.kind === "note" ? attrs.target.split("#")[0].trim() : "";
  const note = useQuery(api.notes.byTitle, attrs.kind === "note" && noteTitle ? { title: noteTitle } : "skip");

  const missing = attrs.kind === "task" ? task === null : note === null;
  const heading = attrs.kind === "note" && attrs.target.includes("#") ? attrs.target.split("#").slice(1).join("#") : "";
  const text = attrs.label
    ?? (attrs.kind === "task" ? `#${attrs.target}${task ? ` ${task.title}` : ""}` : heading ? `${noteTitle} › ${heading}` : noteTitle);
  const done = attrs.kind === "task" && task?.status === "done";

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (attrs.kind === "task" && task) router.push(`/task/${task._id}`);
    if (attrs.kind === "note" && note) router.push(`/notes/${note._id}`);
  };

  return (
    <NodeViewWrapper
      as="span"
      className={`ref-chip ref-${attrs.kind} ${missing ? "ref-missing" : ""} ${done ? "ref-done" : ""} ${selected ? "ref-selected" : ""}`}
      onClick={open}
      title={missing ? (attrs.kind === "task" ? `No task #${attrs.target}` : `No note called "${noteTitle}"`) : undefined}
      data-drag-handle=""
    >
      {text}
    </NodeViewWrapper>
  );
}

export const Ref = RefNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RefChip, { as: "span" });
  },
});

/* ─── Suggestions: "#" + number, "@" and "[[" ─── */

function suggestionRender() {
  return () => {
    let renderer: ReactRenderer<LinkMenuHandle> | null = null;
    let unmount: (() => void) | null = null;
    return {
      onStart: (props: SuggestionProps<LinkItem, LinkItem>) => {
        renderer = new ReactRenderer(LinkMenu, {
          editor: props.editor,
          props: { items: props.items, onPick: (item: LinkItem) => props.command(item) },
        });
        const el = renderer.element as HTMLElement;
        el.style.zIndex = "60";
        unmount = props.mount(el);
      },
      onUpdate: (props: SuggestionProps<LinkItem, LinkItem>) => {
        renderer?.updateProps({ items: props.items, onPick: (item: LinkItem) => props.command(item) });
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "Escape") return false;
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        unmount?.();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}

function linkSuggestion(name: string, char: string, trigger: LinkTrigger, extra: { allowSpaces?: boolean; allowedPrefixes?: string[] | null } = {}) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<LinkItem, LinkItem>({
          editor: this.editor,
          pluginKey: new PluginKey(name),
          char,
          allowSpaces: extra.allowSpaces ?? false,
          allowedPrefixes: extra.allowedPrefixes === undefined ? [" ", "("] : extra.allowedPrefixes,
          items: ({ query }) => {
            if (trigger === "number" && !/^\d{1,6}$/.test(query)) return [];
            return findLinkTargets(query, trigger);
          },
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, [{ type: "ref", attrs: refFor(props) }, { type: "text", text: " " }]).run();
          },
          render: suggestionRender(),
        }),
      ];
    },
  });
}

export const TaskNumberSuggestion = linkSuggestion("refByNumber", "#", "number");
export const MentionSuggestion = linkSuggestion("refMention", "@", "any", { allowSpaces: true });
export const WikiSuggestion = linkSuggestion("refWiki", "[[", "any", { allowSpaces: true, allowedPrefixes: null });

/* ─── Cmd-K: link the selected words, or start a [[ link ─── */

function openWrapPicker(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    editor.chain().focus().insertContent("[[").run();
    return true;
  }
  const label = editor.state.doc.textBetween(from, to, " ").trim();
  if (!label) return false;
  const rect = editor.view.coordsAtPos(from);
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = `${rect.left}px`;
  holder.style.top = `${rect.bottom + 6}px`;
  holder.style.zIndex = "60";
  document.body.appendChild(holder);
  let renderer: ReactRenderer<LinkMenuHandle> | null = null;
  const close = () => {
    document.removeEventListener("mousedown", outside, true);
    renderer?.destroy();
    holder.remove();
    editor.commands.focus();
  };
  const outside = (e: MouseEvent) => { if (!holder.contains(e.target as Node)) close(); };
  renderer = new ReactRenderer(LinkMenu, {
    editor,
    props: {
      items: [],
      searchable: true,
      onClose: close,
      onPick: (item: LinkItem) => {
        close();
        editor.chain().focus().insertContentAt({ from, to }, { type: "ref", attrs: refFor(item, label) }).run();
      },
    },
  });
  holder.appendChild(renderer.element);
  document.addEventListener("mousedown", outside, true);
  return true;
}

export const LinkShortcut = Extension.create({
  name: "refShortcut",
  addKeyboardShortcuts() {
    return { "Mod-k": ({ editor }) => openWrapPicker(editor as Editor) };
  },
});
