import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BookOpen, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  component: () => (
    <AuthProvider>
      <Index />
    </AuthProvider>
  ),
});

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/books" });
    }
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <h1 className="font-serif text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
            Write a book together,
            <br />
            <span className="text-primary">one conversation at a time.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Quill turns the free-flowing voice and text conversations between you
            and your friends into chapters. AI drafts the edits — you and your
            co-authors decide what makes the page.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Start writing</Link>
            </Button>
          </div>
        </div>

        <div className="mt-24 grid gap-6 sm:grid-cols-3">
          <Feature
            icon={<MessageCircle className="h-5 w-5" />}
            title="Talk it out"
            body="Send voice or text messages. Voice is auto-transcribed so the words are never lost."
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="AI drafts the edits"
            body="Ideas from your conversations are turned into proposed chapter edits — added, rewritten, or new."
          />
          <Feature
            icon={<BookOpen className="h-5 w-5" />}
            title="Approve together"
            body="Co-authors approve or reject every edit. Your manuscript only grows when you all agree."
          />
        </div>
      </main>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-paper p-6 shadow-page">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 font-serif text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
