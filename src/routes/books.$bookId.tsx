import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Users, Bot, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RequireAuth } from "@/components/RequireAuth";
import { Conversation } from "@/components/book/Conversation";
import { Chapters } from "@/components/book/Chapters";
import { QuotesBrowser } from "@/components/book/QuotesBrowser";
import { InviteDialog } from "@/components/book/InviteDialog";
import { AgentSettingsDialog } from "@/components/book/AgentSettingsDialog";

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
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("chapters");
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);

  const handleApplied = useCallback((target: { chapterId: string; sectionId: string | null }) => {
    setActiveTab("chapters");
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
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-paper">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/books">
                <ArrowLeft className="mr-1 h-4 w-4" /> Books
              </Link>
            </Button>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Book</p>
              <h1 className="font-serif text-xl font-semibold leading-tight">{book.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
            <AgentSettingsDialog
              bookId={bookId}
              trigger={
                <Button size="sm" variant="outline">
                  <Bot className="mr-1.5 h-4 w-4" /> Agents
                </Button>
              }
            />
            <InviteDialog bookId={bookId} trigger={<Button size="sm">Invite</Button>} />
          </div>
        </div>
      </header>

      {/* Workspace */}
      <main className="grid flex-1 overflow-hidden lg:grid-cols-[1fr_420px]">
        <section className="overflow-hidden border-r border-border paper-texture">
          <Tabs defaultValue="chapters" className="flex h-full flex-col">
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
              />
            </TabsContent>
            <TabsContent value="quotes" className="m-0 flex-1 overflow-hidden">
              <QuotesBrowser
                bookId={bookId}
                chapters={chapters}
                onJumpToChapter={(chapterId) => setSelectedChapterId(chapterId)}
              />
            </TabsContent>
          </Tabs>
        </section>

        <aside className="flex flex-col overflow-hidden bg-paper">
          <Conversation
            bookId={bookId}
            jumpToMessageId={jumpToMessageId ? jumpToMessageId.split("#")[0] : null}
          />
        </aside>
      </main>
    </div>
  );
}
