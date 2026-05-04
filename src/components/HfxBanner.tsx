import { useEffect, useState } from "react";
import { Plus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import hfxAvatar from "@/assets/anton-avatar.png";
import { supabase } from "@/integrations/supabase/client";

const STARTERS = [
  "Add a feature that ",
  "I love how ",
  "It would be great if ",
  "I'm having trouble with ",
];

type Contributor = { id: string; name: string };

// Funky deterministic gradient avatar from a name
function avatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const h1 = hash % 360;
  const h2 = (h1 + 60 + (hash % 120)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1} 85% 60%), hsl(${h2} 85% 55%))`,
  };
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function ContributorChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
        style={avatarStyle(name)}
        aria-hidden
      >
        {initials(name) || "?"}
      </span>
      <span className="font-bold text-foreground">{name}</span>
    </span>
  );
}

export function HfxBanner() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [contributorName, setContributorName] = useState("");
  const [sending, setSending] = useState(false);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const loadContributors = async () => {
    const { data } = await supabase
      .from("contributors")
      .select("id,name")
      .order("created_at", { ascending: true });
    if (data) setContributors(data);
  };

  useEffect(() => {
    loadContributors();
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    });
  }, []);

  const send = async () => {
    if (!message.trim()) {
      toast.error("Please write something first");
      return;
    }
    setSending(true);
    try {
      const trimmedName = contributorName.trim();
      if (trimmedName) {
        const { error: insertErr } = await supabase
          .from("contributors")
          .insert({ name: trimmedName.slice(0, 60) });
        if (insertErr) console.error("contributor insert error", insertErr);
      }

      const res = await fetch("/api/contact-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail ?? undefined,
          name: trimmedName || userEmail?.split("@")[0],
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to send");
      toast.success("Thanks! Your feedback was sent to HFX Ai Guy.");
      setMessage("");
      setContributorName("");
      setOpen(false);
      loadContributors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 rounded-full border border-border bg-paper/70 px-4 py-2 text-sm shadow-sm">
        <img
          src={hfxAvatar}
          alt="HFX Ai Guy"
          className="h-8 w-8 rounded-full object-cover"
        />
        <span className="text-muted-foreground">
          Made by <span className="font-bold text-foreground">HFX Ai Guy</span>
          {contributors.length > 0 ? " with " : "."}
        </span>
        {contributors.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5 text-muted-foreground">
            <ContributorChip name={c.name} />
            {i < contributors.length - 1 ? <span>,</span> : null}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-primary hover:bg-primary/10"
        >
          <Plus className="h-3.5 w-3.5" />
          contribute and add your name to the list
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              Share your feedback
            </DialogTitle>
            <DialogDescription>
              Pick a starter or write your own — it goes straight to HFX Ai Guy.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMessage(s)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {s.trim()}…
              </button>
            ))}
          </div>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 4000))}
            placeholder="What's on your mind?"
            rows={6}
            className="mt-2"
          />

          <div className="space-y-1">
            <Label htmlFor="contributor-name" className="flex items-center gap-2">
              Your name
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Optional
              </span>
            </Label>
            <Input
              id="contributor-name"
              value={contributorName}
              onChange={(e) => setContributorName(e.target.value.slice(0, 60))}
              placeholder="Add it to the contributors list"
            />
            {contributorName.trim() && (
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                Preview: <ContributorChip name={contributorName.trim()} />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={send} disabled={sending || !message.trim()}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
