import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth, AuthProvider } from "@/lib/auth";
import {
  BookReader,
  type ReaderBook,
  type ReaderChapter,
  type ReaderSection,
  type ReaderQuote,
  type ReaderPlacement,
} from "@/components/book/BookReader";

export const Route = createFileRoute("/join/$token")({
  component: () => (
    <AuthProvider>
      <JoinPage />
    </AuthProvider>
  ),
});

type Preview = {
  book_id: string;
  book_title: string;
  book_description: string;
  inviter_name: string;
  expires_at: string | null;
  redeemed_at: string | null;
};

function JoinPage() {
  const { token } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const [sections, setSections] = useState<ReaderSection[]>([]);
  const [quotes, setQuotes] = useState<ReaderQuote[]>([]);
  const [placements, setPlacements] = useState<ReaderPlacement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: prev, error: pErr }, { data: content }] = await Promise.all([
        supabase.rpc("invite_preview", { _token: token }),
        supabase.rpc("invite_book_content", { _token: token }),
      ]);
      if (pErr || !prev || (Array.isArray(prev) && prev.length === 0)) {
        setError("This invite link is invalid or has expired.");
        return;
      }
      const row = (Array.isArray(prev) ? prev[0] : prev) as Preview;
      setPreview(row);
      if (content && typeof content === "object") {
        const c = content as {
          book: ReaderBook;
          chapters: ReaderChapter[];
          sections: ReaderSection[];
          quotes: ReaderQuote[];
          placements: ReaderPlacement[];
        };
        setBook(c.book);
        setChapters(c.chapters ?? []);
        setSections(c.sections ?? []);
        setQuotes(c.quotes ?? []);
        setPlacements(c.placements ?? []);
      }
    })();
  }, [token]);

  const join = async () => {
    if (!user) {
      window.location.href = `/auth?redirect=${encodeURIComponent(`/join/${token}`)}`;
      return;
    }
    setJoining(true);
    const { data, error: jErr } = await supabase.rpc("redeem_invite", { _token: token });
    setJoining(false);
    if (jErr) {
      toast.error(jErr.message || "Could not join");
      return;
    }
    toast.success("You've joined!");
    navigate({ to: "/books/$bookId", params: { bookId: data as string } });
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="rounded-2xl border border-border bg-paper px-8 py-10 text-center shadow-page">
          <p className="font-serif text-xl">{error}</p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary underline">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!preview || !book) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading invite…
      </div>
    );
  }

  return (
    <BookReader
      book={book}
      chapters={chapters}
      sections={sections}
      quotes={quotes}
      placements={placements}
      banner={
        <div className="no-print sticky top-0 z-20 border-b border-border bg-primary/10 backdrop-blur">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4 text-primary" />
              <span>
                <strong>{preview.inviter_name}</strong> invited you to change this book:
              </span>
            </div>
            <Button size="sm" onClick={join} disabled={joining}>
              <Plus className="mr-1 h-4 w-4" /> {joining ? "Joining…" : "Add to the conversation"}
            </Button>
          </div>
        </div>
      }
    />
  );
}
