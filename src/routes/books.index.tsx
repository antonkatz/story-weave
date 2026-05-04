import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, BookOpen } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { AppHeader } from "@/components/AppHeader";

import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/books/")({
  component: () => (
    <RequireAuth>
      <BooksPage />
    </RequireAuth>
  ),
});

type Book = {
  id: string;
  title: string;
  description: string;
  updated_at: string;
};

const newBookSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  description: z.string().trim().max(500).optional(),
});

function BooksPage() {
  const { user } = useAuth();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("books")
      .select("id,title,description,updated_at")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast.error("Could not load your books");
          setBooks([]);
        } else {
          setBooks(data ?? []);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-4xl font-semibold">My Books</h1>
            <p className="mt-1 text-muted-foreground">
              Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New book
              </Button>
            </DialogTrigger>
            <NewBookDialog
              onCreated={(book) => {
                setBooks((prev) => [book, ...(prev ?? [])]);
                setOpen(false);
              }}
            />
          </Dialog>
        </div>

        {books === null ? (
          <p className="mt-12 text-muted-foreground">Loading your shelf…</p>
        ) : books.length === 0 ? (
          <EmptyShelf onCreate={() => setOpen(true)} />
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
        
      </main>
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: book.id }}
      className="group block rounded-2xl border border-border bg-paper p-6 shadow-page transition hover:border-primary/40 hover:shadow-lg"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <BookOpen className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-serif text-2xl font-semibold leading-tight">{book.title}</h3>
      {book.description ? (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{book.description}</p>
      ) : (
        <p className="mt-2 text-sm italic text-muted-foreground">No description yet.</p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Updated {new Date(book.updated_at).toLocaleDateString()}
      </p>
    </Link>
  );
}

function EmptyShelf({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-16 rounded-3xl border border-dashed border-border bg-paper px-8 py-16 text-center">
      <BookOpen className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-4 font-serif text-2xl font-semibold">Your shelf is empty</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Start a new book and invite the friends you'd like to write it with.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" /> Create your first book
      </Button>
    </div>
  );
}

function NewBookDialog({ onCreated }: { onCreated: (book: Book) => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = newBookSchema.safeParse({ title, description });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("books")
        .insert({
          owner_id: user.id,
          title: parsed.data.title,
          description: parsed.data.description ?? "",
        })
        .select("id,title,description,updated_at")
        .single();
      if (error) {
        console.error("Book insert error:", error);
        throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` (${error.hint})` : ""}`);
      }
      if (!data) {
        throw new Error("Book was created but could not be read back. Check RLS policies.");
      }

      // Seed an opening chapter
      const { error: chapterError } = await supabase.from("chapters").insert({
        book_id: data.id,
        title: "Introduction",
        position: 0,
      });
      if (chapterError) console.error("Chapter seed error:", chapterError);

      onCreated(data);
      navigate({ to: "/books/$bookId", params: { bookId: data.id } });
    } catch (err) {
      console.error("Create book failed:", err);
      toast.error(err instanceof Error ? err.message : "Could not create book");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="font-serif text-2xl">Start a new book</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The Flowering Wand"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this book about?"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create book"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
