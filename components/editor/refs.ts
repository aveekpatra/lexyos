import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Links inside text, the same Markdown the Mac app and the backend read:
 *   #142              a task, by number
 *   [label](#142)     a task, with its own words
 *   [[Title]]         a note, by title (also [[Title|alias]], [[Title#Heading]])
 * The backend turns every one of them into a graph edge on save
 * (convex/lib/graph.ts), so they must survive the editor exactly.
 */
export type RefAttrs = {
  kind: "task" | "note";
  /** Task number as text, or the note target ("Title" or "Title#Heading"). */
  target: string;
  label: string | null;
};

const NOTE = /^\[\[([^\]\n|]{1,160})(?:\|([^\]\n]{1,160}))?\]\]/;
const LABELED_TASK = /^\[([^\]\n]{1,200})\]\(#(\d{1,6})\)/;
const TASK = /^#(\d{1,6})(?![\w])/;

function firstRefIndex(src: string): number {
  const hits = [src.search(/\[\[/), src.search(/\[[^\]\n]{1,200}\]\(#\d/), src.search(/(^|[\s(])#\d/)].filter((i) => i >= 0);
  if (!hits.length) return -1;
  const i = Math.min(...hits);
  // "(^|[\s(])#" matched the boundary character; step past it.
  return src[i] === "#" || src[i] === "[" ? i : i + 1;
}

export function refMarkdown(attrs: RefAttrs): string {
  if (attrs.kind === "task") return attrs.label ? `[${attrs.label}](#${attrs.target})` : `#${attrs.target}`;
  return attrs.label ? `[[${attrs.target}|${attrs.label}]]` : `[[${attrs.target}]]`;
}

export const RefNode = Node.create({
  name: "ref",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: "task" },
      target: { default: "" },
      label: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: "span[data-ref]",
      getAttrs: (el) => ({
        kind: (el as HTMLElement).dataset.ref,
        target: (el as HTMLElement).dataset.target,
        label: (el as HTMLElement).dataset.label ?? null,
      }),
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as RefAttrs;
    return ["span", mergeAttributes(HTMLAttributes, { "data-ref": a.kind, "data-target": a.target, ...(a.label ? { "data-label": a.label } : {}) }),
      a.label ?? (a.kind === "task" ? `#${a.target}` : a.target)];
  },

  renderText({ node }) {
    return refMarkdown(node.attrs as RefAttrs);
  },

  markdownTokenizer: {
    name: "ref",
    level: "inline",
    start: (src: string) => firstRefIndex(src),
    tokenize: (src: string) => {
      let m = NOTE.exec(src);
      if (m) return { type: "ref", raw: m[0], kind: "note", target: m[1].trim(), label: m[2]?.trim() ?? null };
      m = LABELED_TASK.exec(src);
      if (m) return { type: "ref", raw: m[0], kind: "task", target: m[2], label: m[1] };
      m = TASK.exec(src);
      if (m) return { type: "ref", raw: m[0], kind: "task", target: m[1], label: null };
      return undefined;
    },
  },

  parseMarkdown: (token) => ({
    type: "ref",
    attrs: { kind: token.kind, target: token.target, label: token.label ?? null },
  }),

  renderMarkdown: (node) => refMarkdown(node.attrs as RefAttrs),
});

/**
 * Text the editor must hand back untouched: Obsidian callout markers
 * ("> [!note] Title"), which Markdown would otherwise escape to "\[!note\]".
 */
export const RawText = Node.create({
  name: "rawText",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return { text: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-raw]", getAttrs: (el) => ({ text: (el as HTMLElement).textContent ?? "" }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-raw": "", class: "md-callout-mark" }), node.attrs.text];
  },

  renderText({ node }) {
    return node.attrs.text;
  },

  markdownTokenizer: {
    name: "rawText",
    level: "inline",
    start: (src: string) => src.search(/\[![A-Za-z-]+\][+-]?/),
    tokenize: (src: string) => {
      const m = /^\[![A-Za-z-]+\][+-]?/.exec(src);
      return m ? { type: "rawText", raw: m[0], text: m[0] } : undefined;
    },
  },

  parseMarkdown: (token) => ({ type: "rawText", attrs: { text: token.text } }),
  renderMarkdown: (node) => node.attrs?.text ?? "",
});
