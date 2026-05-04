import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuthProvider, useAuth } from "@/lib/auth";

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(72),
});

export const Route = createFileRoute("/auth")({
  component: () => (
    <AuthProvider>
      <AuthPage />
    </AuthProvider>
  ),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const target =
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("redirect")) ||
    "/books";

  useEffect(() => {
    if (!loading && user) navigate({ to: target });
  }, [user, loading, navigate, target]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-paper p-8 shadow-page">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-foreground">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="font-serif text-2xl font-semibold">Weave</span>
        </Link>
        <h1 className="text-center font-serif text-2xl font-semibold">Welcome</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Sign in to your books, or create an account.
        </p>

        <Tabs defaultValue="signin" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="signin">
            <CredentialsForm mode="signin" />
          </TabsContent>
          <TabsContent value="signup">
            <CredentialsForm mode="signup" />
          </TabsContent>
        </Tabs>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            const result = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: window.location.origin + "/books",
            });
            if (result.error) {
              toast.error("Could not sign in with Google");
              return;
            }
            if (result.redirected) return;
            navigate({ to: "/books" });
          }}
        >
          Continue with Google
        </Button>
      </div>
    </div>
  );
}

function CredentialsForm({ mode }: { mode: "signin" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: window.location.origin + "/books" },
        });
        if (error) throw error;
        toast.success("Account created — welcome!");
        navigate({ to: "/books" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        navigate({ to: "/books" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${mode}-password`}>Password</Label>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
