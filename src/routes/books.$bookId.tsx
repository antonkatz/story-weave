import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Users, Bot, BookOpen, Pencil, Trash2, BookText, Quote, MessageCircle, UsersRound, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RequireAuth } from "@/components/RequireAuth";
import { Conversation } from "@/components/book/Conversation";
import { Chapters } from "@/components/book/Chapters";
import { QuotesBrowser } from "@/components/book/QuotesBrowser";
import { InviteDialog } from "@/components/book/InviteDialog";
import { AgentSettingsDialog } from "@/components/book/AgentSettingsDialog";
import { ActionHistory } from "@/components/book/ActionHistory";
import { Speakers } from "@/components/book/Speakers";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/books/$bookId")({
  component: () => (
    <RequireAuth>
      <BookPage />
    </RequireAuth>
  ),
});

type Book = {
  id: string;
  title: string;
  description: string;
  owner_id: string;
};

type Chapter = {
  id: string;
  title: string;
  position: number;
  synopsis?: string;
  theme?: string;
};

type Member = {
  user_id: string;
  role: "owner" | "co_author";
  display_name: string;
};

function BookPage() {
  const { bookId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("chapters");
  const [mobileView, setMobileView] = useState<"chapters" | "quotes" | "conversation" | "people">("chapters");
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleApplied = useCallback((target: { chapterId: string; sectionId: string | null }) => {
    setActiveTab("chapters");
    setMobileView("chapters");
    setSelectedChapterId(target.chapterId);
    setSelectedSectionId(target.sectionId ? `${target.sectionId}#${Date.now()}` : null);
  }, []);

  const reloadChapters = useCallback(async () => {
    const { data } = await supabase
      .from("chapters")
      .select("id,title,position,synopsis,theme")
      .eq("book_id", bookId)
      .order("position", { ascending: true });
    setChapters((data ?? []) as Chapter[]);
  }, [bookId]);

  const reloadMembers = useCallback(async () => {
    const { data: m } = await supabase
      .from("book_members")
      .select("user_id,role")
      .eq("book_id", bookId);
    if (!m) return;
    const ids = m.map((x) => x.user_id);
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,display_name")
      .in("id", ids);
    const profMap = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
    setMembers(
      m.map((x) => ({
        user_id: x.user_id,
        role: x.role as Member["role"],
        display_name: profMap.get(x.user_id) || "Co-author",
      }))
    );
  }, [bookId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("books")
        .select("id,title,description,owner_id")
        .eq("id", bookId)
        .single();
      if (!active) return;
      if (error || !data) {
        toast.error("Could not load this book");
        navigate({ to: "/books" });
        return;
      }
      setBook(data);
      await Promise.all([reloadChapters(), reloadMembers()]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [bookId, navigate, reloadChapters, reloadMembers]);

  // Realtime: chapters & members
  useEffect(() => {
    const ch = supabase
      .channel(`book:${bookId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chapters", filter: `book_id=eq.${bookId}` },
        () => reloadChapters()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_members", filter: `book_id=eq.${bookId}` },
        () => reloadMembers()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [bookId, reloadChapters, reloadMembers]);

  if (loading || !book) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading book…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:min-h-0">
      {/* Top bar */}
      <header className="border-b border-border bg-paper">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" asChild className="shrink-0">
              <Link to="/books">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:ml-1 sm:inline">Books</span>
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0">
                <p className="hidden text-xs uppercase tracking-wide text-muted-foreground sm:block">Book</p>
                <h1 className="truncate font-serif text-base font-semibold leading-tight sm:text-xl">{book.title}</h1>
              </div>
              {user?.id === book.owner_id && (
                <div className="hidden items-center sm:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-1 h-7 w-7 text-muted-foreground"
                    aria-label="Rename book"
                    title="Rename book"
                    onClick={() => setRenameOpen(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label="Delete book"
                    title="Delete book"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div className="flex -space-x-1.5">
                {members.slice(0, 5).map((m) => (
                  <div
                    key={m.user_id}
                    title={m.display_name}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper bg-secondary text-xs font-medium text-secondary-foreground"
                  >
                    {m.display_name[0]?.toUpperCase() ?? "?"}
                  </div>
                ))}
                {members.length > 5 && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper bg-muted text-xs">
                    +{members.length - 5}
                  </div>
                )}
              </div>
            </div>
            {/* Desktop secondary actions */}
            <div className="hidden items-center gap-2 sm:flex">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate({ to: "/books/$bookId/read", params: { bookId } })}
              >
                <BookOpen className="mr-1.5 h-4 w-4" /> Read / Export
              </Button>
              <AgentSettingsDialog
                bookId={bookId}
                trigger={
                  <Button size="sm" variant="outline">
                    <Bot className="mr-1.5 h-4 w-4" /> Agents
                  </Button>
                }
              />
            </div>
            <InviteDialog bookId={bookId} trigger={<Button size="sm">Invite</Button>} />
            {/* Mobile overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden" aria-label="More">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate({ to: "/books/$bookId/read", params: { bookId } })}>
                  <BookOpen className="mr-2 h-4 w-4" /> Read / Export
                </DropdownMenuItem>
                <AgentSettingsDialog
                  bookId={bookId}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Bot className="mr-2 h-4 w-4" /> Agents
                    </DropdownMenuItem>
                  }
                />
                {user?.id === book.owner_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Workspace — desktop (≥ lg): two-column grid */}
      <main className="hidden flex-1 overflow-hidden lg:grid lg:grid-cols-[1fr_420px]">
        <section className="flex flex-col overflow-hidden border-r border-border paper-texture">
          <div className="flex min-h-0 flex-1 flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border bg-paper/70 px-4 py-2">
                <TabsList>
                  <TabsTrigger value="chapters">Chapters ({chapters.length})</TabsTrigger>
                  <TabsTrigger value="quotes">Quotes</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="chapters" className="m-0 flex-1 overflow-hidden">
                <Chapters
                  bookId={bookId}
                  chapters={chapters}
                  onChange={reloadChapters}
                  selectedChapterId={selectedChapterId}
                  onSelectChapter={setSelectedChapterId}
                  onJumpToMessage={(id) => setJumpToMessageId(`${id}#${Date.now()}`)}
                  selectedSectionId={selectedSectionId ? selectedSectionId.split("#")[0] : null}
                />
              </TabsContent>
              <TabsContent value="quotes" className="m-0 flex-1 overflow-hidden">
                <QuotesBrowser
                  bookId={bookId}
                  chapters={chapters}
                  onJumpToChapter={(chapterId) => {
                    setActiveTab("chapters");
                    setSelectedChapterId(chapterId);
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        </section>

        <aside className="flex flex-col overflow-hidden bg-paper">
          <div className="flex min-h-0 flex-1 flex-col">
            <Conversation
              bookId={bookId}
              jumpToMessageId={jumpToMessageId ? jumpToMessageId.split("#")[0] : null}
              onApplied={handleApplied}
            />
          </div>
          <div className="flex min-h-[260px] flex-none flex-col border-t border-border" style={{ height: "38%" }}>
            <Tabs defaultValue="speakers" className="flex h-full flex-col">
              <div className="border-b border-border bg-paper/70 px-3 py-1.5">
                <TabsList>
                  <TabsTrigger value="speakers">Speakers</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="speakers" className="m-0 flex-1 overflow-hidden">
                <Speakers bookId={bookId} />
              </TabsContent>
              <TabsContent value="history" className="m-0 flex-1 overflow-hidden">
                <ActionHistory bookId={bookId} />
              </TabsContent>
            </Tabs>
          </div>
        </aside>
      </main>

      {/* Workspace — mobile (< lg): single full-screen view + bottom tab bar */}
      <main className="flex flex-1 flex-col overflow-hidden pb-14 lg:hidden">
        <div className="flex-1 overflow-hidden">
          {mobileView === "chapters" && (
            <div className="h-full paper-texture">
              <Chapters
                bookId={bookId}
                chapters={chapters}
                onChange={reloadChapters}
                selectedChapterId={selectedChapterId}
                onSelectChapter={setSelectedChapterId}
                onJumpToMessage={(id) => {
                  setJumpToMessageId(`${id}#${Date.now()}`);
                  setMobileView("conversation");
                }}
                selectedSectionId={selectedSectionId ? selectedSectionId.split("#")[0] : null}
              />
            </div>
          )}
          {mobileView === "quotes" && (
            <div className="h-full paper-texture">
              <QuotesBrowser
                bookId={bookId}
                chapters={chapters}
                onJumpToChapter={(chapterId) => {
                  setSelectedChapterId(chapterId);
                  setMobileView("chapters");
                }}
              />
            </div>
          )}
          {mobileView === "conversation" && (
            <div className="h-full bg-paper">
              <Conversation
                bookId={bookId}
                jumpToMessageId={jumpToMessageId ? jumpToMessageId.split("#")[0] : null}
                onApplied={handleApplied}
              />
            </div>
          )}
          {mobileView === "people" && (
            <div className="h-full bg-paper">
              <Tabs defaultValue="speakers" className="flex h-full flex-col">
                <div className="border-b border-border bg-paper/70 px-3 py-1.5">
                  <TabsList>
                    <TabsTrigger value="speakers">Speakers</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="speakers" className="m-0 flex-1 overflow-hidden">
                  <Speakers bookId={bookId} />
                </TabsContent>
                <TabsContent value="history" className="m-0 flex-1 overflow-hidden">
                  <ActionHistory bookId={bookId} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
        <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-paper lg:hidden">
          {([
            { key: "chapters", label: "Chapters", icon: BookText },
            { key: "quotes", label: "Quotes", icon: Quote },
            { key: "conversation", label: "Chat", icon: MessageCircle },
            { key: "people", label: "People", icon: UsersRound },
          ] as const).map(({ key, label, icon: Icon }) => {
            const active = mobileView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMobileView(key)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </main>

      <RenameBookDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        bookId={bookId}
        currentTitle={book.title}
        onRenamed={(t) => setBook((b) => (b ? { ...b, title: t } : b))}
      />
      <DeleteBookDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        bookId={bookId}
        bookTitle={book.title}
        onDeleted={() => navigate({ to: "/books" })}
      />
    </div>
  );
}

function RenameBookDialog({
  open,
  onOpenChange,
  bookId,
  currentTitle,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookId: string;
  currentTitle: string;
  onRenamed: (title: string) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setTitle(currentTitle);
  }, [open, currentTitle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    const { error } = await supabase.from("books").update({ title: t }).eq("id", bookId);
    setSaving(false);
    if (error) {
      toast.error("Could not rename book");
      return;
    }
    toast.success("Renamed");
    onRenamed(t);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename book</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="book-title">Title</Label>
            <Input id="book-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBookDialog({
  open,
  onOpenChange,
  bookId,
  bookTitle,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookId: string;
  bookTitle: string;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setConfirmText("");
    }
  }, [open]);

  const doDelete = async () => {
    setDeleting(true);
    // Cascade-delete book contents (no FK cascades configured at the DB layer).
    // Order matters: child rows first.
    try {
      await supabase.from("suggested_edits").delete().eq("book_id", bookId);
      await supabase.from("message_agent_analysis").delete().eq("book_id", bookId);
      await supabase.from("chapter_message_context").delete().eq("book_id", bookId);
      await supabase.from("quote_placements").delete().eq("book_id", bookId);
      await supabase.from("quotes").delete().eq("book_id", bookId);
      await supabase.from("chapter_sections").delete().eq("book_id", bookId);
      await supabase.from("chapters").delete().eq("book_id", bookId);
      await supabase.from("messages").delete().eq("book_id", bookId);
      await supabase.from("invites").delete().eq("book_id", bookId);
      await supabase.from("book_agent_prompts").delete().eq("book_id", bookId);
      await supabase.from("book_members").delete().eq("book_id", bookId);
      const { error } = await supabase.from("books").delete().eq("id", bookId);
      if (error) throw error;
    } catch (e) {
      setDeleting(false);
      toast.error(e instanceof Error ? e.message : "Could not delete book");
      return;
    }
    setDeleting(false);
    toast.success("Book deleted");
    onOpenChange(false);
    onDeleted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete book</DialogTitle>
        </DialogHeader>
        {step === 1 ? (
          <>
            <p className="text-sm text-muted-foreground">
              You're about to permanently delete <strong>{bookTitle}</strong> — all chapters, sections, quotes, and
              messages will be gone. This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setStep(2)}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm">
              Type <strong>DELETE</strong> to confirm permanent deletion of <em>{bookTitle}</em>.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={confirmText.trim() !== "DELETE" || deleting}
                onClick={doDelete}
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
