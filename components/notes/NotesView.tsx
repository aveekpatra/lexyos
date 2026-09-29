"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatDistanceToNow, format } from "date-fns";
import {
  IoAdd, IoCreateOutline, IoDocumentText, IoEllipsisHorizontal, IoSearch, IoTrash, IoPencil,
  IoFolderOpen, IoClose, IoChevronDown, IoChevronForward, IoCheckmarkCircle, IoEllipseOutline,
} from "react-icons/io5";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ProjectGlyph } from "@/components/ui/project-glyph";
import { ProjectIconGrid } from "@/components/projects/ProjectIconGrid";
import { PROJECT_COLORS } from "@/components/projects/CreateProjectDialog";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator, MenuSub, MenuSubTrigger, MenuSubPopup } from "@/components/ui/menu";
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup } from "@/components/ui/context-menu";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { softPill, bluePill, glassIconButton } from "@/lib/ui/chrome";
import { cn } from "@/lib/utils";

/*
 * Notebooks and notes, the same two columns as the Mac app: notebooks on the
 * left (search replaces them with results), the notebook's notes next to it,
 * and the open note as a page. Notes are Markdown; "#142", "@" and "[[" link
 * tasks and notes, and those links are the knowledge graph the agent walks.
 */

const ROW = "flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-[14px] transition-colors";
const ROW_IDLE = "text-text-secondary hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06]";
const ROW_ACTIVE = "bg-black/[0.07] text-text-strong dark:bg-white/[0.1]";
const BOOK_KEY = "lexyos:notes:notebook";

type Notebook = Doc<"notebooks"> & { noteCount?: number };
type NoteSummary = { _id: Id<"notes">; notebookId: Id<"notebooks">; title: string; snippet: string; updatedAt: number };

export default function NotesView({ noteId }: { noteId: Id<"notes"> | null }) {
  const router = useRouter();
  const notebooks = useQuery(api.notebooks.list, {}) as Notebook[] | undefined;
  const note = useQuery(api.notes.get, noteId ? { id: noteId } : "skip");
  const [chosen, setChosen] = useState<Id<"notebooks"> | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Notebook | null | "new">(null);
  const [deleting, setDeleting] = useState<Notebook | null>(null);

  // The remembered notebook, read after mount so SSR and first paint agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BOOK_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (saved) setChosen(saved as Id<"notebooks">);
    } catch {}
  }, []);

  // An open note brings its notebook along.
  const noteBook = note?.notebookId ?? null;
  const selected = useMemo(() => {
    if (!notebooks) return null;
    const want = noteBook ?? chosen;
    return notebooks.find((b) => b._id === want)?._id ?? notebooks[0]?._id ?? null;
  }, [notebooks, noteBook, chosen]);

  const choose = (id: Id<"notebooks">) => {
    setChosen(id);
    try { localStorage.setItem(BOOK_KEY, id); } catch {}
    if (noteId && note?.notebookId !== id) router.push("/notes");
  };

  const notes = useQuery(api.notes.list, selected ? { notebookId: selected } : "skip") as NoteSummary[] | undefined;
  const searching = query.trim().length > 0;
  const results = useQuery(api.notes.search, searching ? { query: query.trim(), limit: 40 } : "skip") as NoteSummary[] | undefined;
  const createNote = useMutation(api.notes.create);
  const book = notebooks?.find((b) => b._id === selected) ?? null;

  const newNote = async () => {
    if (!selected) return;
    const id = await createNote({ notebookId: selected });
    router.push(`/notes/${id}`);
  };

  const left = useResizableWidth("notebooks", { initial: 240, min: 200, max: 360, side: "right" });
  const middle = useResizableWidth("notes-list", { initial: 300, min: 240, max: 480, side: "right" });

  return (
    <div className="flex h-full min-h-0">
      {/* Notebooks, or search results */}
      <aside className="relative flex shrink-0 flex-col border-r border-line" style={{ width: left.width }}>
        <ResizeHandle side="right" onPointerDown={left.onPointerDown} active={left.resizing} />
        <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
          <h1 className="flex-1 text-[15px] font-semibold text-text-strong">Notes</h1>
          <button onClick={() => setEditing("new")} aria-label="New notebook" title="New notebook" className={glassIconButton}>
            <IoAdd className="size-4" />
          </button>
        </div>
        <div className="shrink-0 px-3 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-full bg-black/[0.05] px-3.5 dark:bg-white/[0.06]">
            <IoSearch className="size-4 shrink-0 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
              placeholder="Search notes"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text-strong outline-none placeholder:text-text-faint"
            />
            {searching && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="text-text-faint hover:text-text-strong">
                <IoClose className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
          {searching ? (
            results === undefined ? null : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-text-faint">No notes match</p>
            ) : (
              results.map((n) => (
                <NoteRow key={n._id} note={n} active={n._id === noteId} bookName={notebooks?.find((b) => b._id === n.notebookId)?.name} />
              ))
            )
          ) : (
            <>
              {notebooks?.map((b) => (
                <ContextMenu key={b._id}>
                  <ContextMenuTrigger>
                    <div className="group relative">
                      <button onClick={() => choose(b._id)} className={cn(ROW, b._id === selected ? ROW_ACTIVE : ROW_IDLE)}>
                        <ProjectGlyph icon={b.icon ?? "IoBook"} className="size-[18px]" style={{ color: b.color ?? "#8b5cf6" }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                        <span className="text-[12px] tabular-nums text-text-faint group-hover:opacity-0">{b.noteCount ?? ""}</span>
                      </button>
                      <Menu>
                        <MenuTrigger render={<button aria-label="Notebook options" className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full text-text-faint opacity-0 hover:bg-black/[0.06] hover:text-text-strong group-hover:opacity-100 data-popup-open:opacity-100 dark:hover:bg-white/[0.1]" />}>
                          <IoEllipsisHorizontal className="size-3.5" />
                        </MenuTrigger>
                        <MenuPopup align="end"><BookMenuItems onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} /></MenuPopup>
                      </Menu>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuPopup><BookMenuItems onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} /></ContextMenuPopup>
                </ContextMenu>
              ))}
              {notebooks && notebooks.length === 0 && (
                <button onClick={() => setEditing("new")} className={cn(ROW, ROW_IDLE, "text-text-faint")}>
                  <IoAdd className="size-[18px]" /> New notebook
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      {/* The notebook's notes (hidden while searching) */}
      {!searching && (
        <section className="relative flex shrink-0 flex-col border-r border-line" style={{ width: middle.width }}>
          <ResizeHandle side="right" onPointerDown={middle.onPointerDown} active={middle.resizing} />
          <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-strong">{book?.name ?? ""}</h2>
            {book && (
              <button onClick={newNote} aria-label="New note" title="New note" className={glassIconButton}>
                <IoCreateOutline className="size-4" />
              </button>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
            {notes?.map((n) => <NoteRow key={n._id} note={n} active={n._id === noteId} />)}
            {notes && notes.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <p className="text-[13px] text-text-faint">No notes in this notebook yet.</p>
                <button onClick={newNote} className={softPill}><IoCreateOutline className="size-3.5" /> New note</button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* The page */}
      <main className="min-w-0 flex-1 overflow-hidden">
        {noteId ? (
          note === undefined ? null : note === null ? (
            <Empty title="Note not found" subtitle="It may have been deleted." />
          ) : (
            <NotePage key={note._id} note={note} notebooks={notebooks ?? []} />
          )
        ) : (
          <Empty
            title={book ? "No note open" : "No notebooks yet"}
            subtitle={book ? "Pick a note, or start a new one." : "Make a notebook to start writing."}
            action={book ? <button onClick={newNote} className={bluePill}><IoCreateOutline className="size-3.5" /> New note</button>
              : <button onClick={() => setEditing("new")} className={bluePill}><IoAdd className="size-3.5" /> New notebook</button>}
          />
        )}
      </main>

      <NotebookDialog
        notebook={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onCreated={(id) => choose(id)}
      />
      <DeleteNotebookDialog notebook={deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} onDeleted={() => router.push("/notes")} />
    </div>
  );
}

function BookMenuItems({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <>
      <MenuItem onClick={onEdit}><IoPencil className="size-4" /> Edit notebook</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={onDelete} className="text-[#ef4444]"><IoTrash className="size-4" /> Delete notebook</MenuItem>
    </>
  );
}

function Empty({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <IoDocumentText className="mb-1 size-8 text-text-faint" />
      <p className="text-[15px] font-medium text-text-secondary">{title}</p>
      <p className="text-[13px] text-text-faint">{subtitle}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function NoteRow({ note, active, bookName }: { note: NoteSummary; active: boolean; bookName?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/notes/${note._id}`)}
      className={cn("flex w-full flex-col gap-0.5 rounded-[14px] px-3 py-2.5 text-left transition-colors", active ? ROW_ACTIVE : ROW_IDLE)}
    >
      <span className="truncate text-[14px] font-medium text-text-strong">{note.title || "Untitled"}</span>
      {note.snippet && <span className="line-clamp-2 text-[12px] leading-snug text-text-muted">{note.snippet}</span>}
      <span className="text-[11px] text-text-faint">
        {bookName ? `${bookName} · ` : ""}{formatDistanceToNow(note.updatedAt, { addSuffix: true })}
      </span>
    </button>
  );
}

/* ─── The page ─── */

function NotePage({ note, notebooks }: { note: Doc<"notes">; notebooks: Notebook[] }) {
  const router = useRouter();
  const update = useMutation(api.notes.update);
  const remove = useMutation(api.notes.remove);
  const [title, setTitle] = useState(note.title);
  const [titleFor, setTitleFor] = useState(note.title);
  // Another device renamed it while this field holds no unsaved typing.
  if (note.title !== titleFor) {
    setTitleFor(note.title);
    if (title === titleFor) setTitle(note.title);
  }

  // Titles save a moment after typing stops, as on the Mac.
  useEffect(() => {
    if (title === note.title) return;
    const t = setTimeout(() => { void update({ id: note._id, title }); }, 600);
    return () => clearTimeout(t);
  }, [title, note._id, note.title, update]);

  const del = async () => {
    await remove({ id: note._id });
    router.push("/notes");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="flex-1 text-[12px] text-text-faint" title={format(note.updatedAt, "PPpp")}>
          Edited {formatDistanceToNow(note.updatedAt, { addSuffix: true })}
        </span>
        <Menu>
          <MenuTrigger render={<button aria-label="Note options" className={glassIconButton} />}>
            <IoEllipsisHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuSub>
              <MenuSubTrigger><IoFolderOpen className="size-4" /> Move to</MenuSubTrigger>
              <MenuSubPopup>
                {notebooks.filter((b) => b._id !== note.notebookId).map((b) => (
                  <MenuItem key={b._id} onClick={() => void update({ id: note._id, notebookId: b._id })}>
                    <ProjectGlyph icon={b.icon ?? "IoBook"} className="size-4" style={{ color: b.color ?? "#8b5cf6" }} />
                    {b.name}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
            <MenuItem onClick={() => navigator.clipboard.writeText(`[[${note.title}]]`)}>Copy link</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={del} className="text-[#ef4444]"><IoTrash className="size-4" /> Delete note</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-10 pb-28 pt-6">
          <AutoTextarea
            value={title}
            onChange={setTitle}
            onCommit={() => { if (title !== note.title) void update({ id: note._id, title }); }}
            placeholder="Untitled"
            className="text-[32px] font-bold leading-[1.2] tracking-[-0.02em] text-text-strong"
          />
          <div className="mt-6">
            <MarkdownEditor
              docKey={note._id}
              value={note.body}
              onCommit={(md) => void update({ id: note._id, body: md })}
              placeholder="Write in Markdown. Type @ or [[ to link a task or note, # and a number for a task. Select text and press ⌘K to link it."
              autofocus={!note.body && !!note.title}
            />
          </div>
          <Connections kind="note" id={note._id} />
          <NoteHistory noteId={note._id} />
        </div>
      </div>
    </div>
  );
}

/* ─── Connections: what links here and what this links to ─── */

export function Connections({ kind, id, children }: { kind: "task" | "note"; id: string; children?: React.ReactNode }) {
  const router = useRouter();
  const related = useQuery(api.graph.related, { kind, id });
  const disconnect = useMutation(api.graph.disconnect);
  const unlink = useMutation(api.tasks.unlink);
  const items = useMemo(() => {
    const seen = new Map<string, NonNullable<typeof related>[number] & { directions: Set<string> }>();
    for (const r of related ?? []) {
      const key = `${r.kind}:${r.id}`;
      const have = seen.get(key);
      if (have) { have.directions.add(r.direction); if (r.via === "link") have.via = "link"; }
      else seen.set(key, { ...r, directions: new Set([r.direction]) });
    }
    return [...seen.values()];
  }, [related]);

  if (!items.length && !children) return null;

  const remove = async (r: (typeof items)[number]) => {
    if (kind === "task" && r.kind === "task") await unlink({ id: id as Id<"tasks">, otherId: r.id as Id<"tasks"> });
    await disconnect({ fromKind: kind, fromId: id, toKind: r.kind, toId: r.id });
  };

  return (
    <section className="mt-10">
      <div className="mb-1 flex items-center px-3 py-1">
        <h2 className="text-[13px] font-semibold text-text-strong">Connections</h2>
        {items.length > 0 && <span className="ml-2 text-[12px] tabular-nums text-text-faint">{items.length}</span>}
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map((r) => (
          <div key={`${r.kind}:${r.id}`} className="group flex h-9 items-center gap-3 rounded-full px-3 transition-colors hover:bg-hover">
            {r.kind === "task" ? (
              r.status === "done" ? <IoCheckmarkCircle className="size-4 shrink-0 text-brand" /> : <IoEllipseOutline className="size-4 shrink-0 text-brand" />
            ) : (
              <IoDocumentText className="size-4 shrink-0 text-violet-500" />
            )}
            <button
              onClick={() => router.push(r.kind === "task" ? `/task/${r.id}` : `/notes/${r.id}`)}
              className={cn("min-w-0 flex-1 truncate text-left text-[13px] text-text-secondary group-hover:text-foreground", r.status === "done" && "text-text-faint line-through")}
            >
              {r.kind === "task" && r.number !== undefined && <span className="mr-2 font-mono text-[12px] text-text-faint">#{r.number}</span>}
              {r.title}
            </button>
            <span className="shrink-0 text-[11px] text-text-faint">
              {r.via === "link" ? "linked" : r.directions.has("out") && r.directions.has("in") ? "mentioned both ways" : r.directions.has("out") ? "mentioned here" : "mentions this"}
            </span>
            {r.via === "link" && (
              <button onClick={() => void remove(r)} aria-label="Remove connection" title="Remove connection" className="flex size-6 shrink-0 items-center justify-center rounded-full text-text-faint opacity-0 hover:bg-black/[0.06] hover:text-text-strong group-hover:opacity-100 dark:hover:bg-white/[0.1]">
                <IoClose className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {children}
      </div>
    </section>
  );
}

/* ─── A note's story ─── */

function NoteHistory({ noteId }: { noteId: Id<"notes"> }) {
  const [open, setOpen] = useState(false);
  const events = useQuery(api.notes.history, { id: noteId });
  if (!events?.length) return null;
  const describe = (e: (typeof events)[number]): string => {
    const label = (v: unknown) => (v && typeof v === "object" && "label" in v ? String((v as { label: unknown }).label) : "");
    switch (e.field) {
      case "created": return "Created";
      case "title": return e.from ? `Renamed from “${String(e.from)}”` : "Titled";
      case "body": return "Edited";
      case "notebook": return `Moved from ${String(e.from ?? "a notebook")} to ${String(e.to ?? "another")}`;
      case "mention": return e.to ? `Linked ${label(e.to)}` : "Removed a link";
      case "mentionedIn": return `Mentioned in ${label(e.to) || "a task"}`;
      default: return e.field;
    }
  };
  const who = (a: string) => (a === "mac" ? "on Mac" : a === "agent" ? "by the agent" : "on the web");
  return (
    <section className="mt-8">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1 text-[13px] font-semibold text-text-strong">
        {open ? <IoChevronDown className="size-3.5" /> : <IoChevronForward className="size-3.5" />}
        History
        <span className="text-[12px] font-normal tabular-nums text-text-faint">{events.length}</span>
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-2 px-3">
          {[...events].reverse().map((e) => (
            <li key={e._id} className="flex items-baseline gap-3 text-[13px]">
              <span className="min-w-0 flex-1 text-text-secondary">{describe(e)}</span>
              <span className="shrink-0 text-[11px] text-text-faint">{who(e.actor)} &middot; {format(e.at, "MMM d, HH:mm")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ─── Notebook dialogs ─── */

function NotebookDialog({ notebook, open, onOpenChange, onCreated }: {
  notebook: Notebook | null; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: Id<"notebooks">) => void;
}) {
  const create = useMutation(api.notebooks.create);
  const update = useMutation(api.notebooks.update);
  const seed = () => ({ name: notebook?.name ?? "", color: notebook?.color ?? PROJECT_COLORS[5], icon: notebook?.icon ?? "IoBook" });
  const [draft, setDraft] = useState(seed);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = open ? notebook?._id ?? "new" : null;
  if (key !== seededFor) { setSeededFor(key); setDraft(seed()); }

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return;
    if (notebook) await update({ id: notebook._id, name, color: draft.color, icon: draft.icon });
    else onCreated(await create({ name, color: draft.color, icon: draft.icon }));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[440px] !rounded-[24px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-[17px]">{notebook ? "Edit notebook" : "New notebook"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 pb-2">
          <div className="flex h-11 items-center gap-2 rounded-full bg-black/[0.04] pl-3 pr-4 dark:bg-white/[0.06]">
            <ProjectGlyph icon={draft.icon} className="size-5" style={{ color: draft.color }} />
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
              placeholder="Notebook name"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] font-medium text-text-strong outline-none placeholder:font-normal placeholder:text-text-faint"
            />
          </div>
          <div className="grid grid-cols-10 gap-1.5 px-1">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, color: c }))}
                aria-label={`Colour ${c}`}
                className="flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: c, boxShadow: draft.color === c ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${c}` : undefined }}
              />
            ))}
          </div>
          <ProjectIconGrid value={draft.icon} color={draft.color} onSelect={(icon) => setDraft((d) => ({ ...d, icon }))} />
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className={softPill}>Cancel</button>
          <button onClick={() => void save()} disabled={!draft.name.trim()} className={cn(bluePill, "disabled:opacity-40")}>
            {notebook ? "Save" : "Create notebook"}
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DeleteNotebookDialog({ notebook, onOpenChange, onDeleted }: {
  notebook: Notebook | null; onOpenChange: (o: boolean) => void; onDeleted: () => void;
}) {
  const remove = useMutation(api.notebooks.remove);
  return (
    <Dialog open={!!notebook} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-[17px]">Delete {notebook?.name ?? "notebook"}?</DialogTitle>
          <DialogDescription>Its {notebook?.noteCount ?? 0} notes and their history are deleted too. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className={softPill}>Cancel</button>
          <button
            onClick={async () => { if (!notebook) return; await remove({ id: notebook._id }); onOpenChange(false); onDeleted(); }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#ef4444] px-3.5 text-xs font-medium text-white hover:bg-[#dc2626]"
          >
            <IoTrash className="size-3.5" /> Delete notebook
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
