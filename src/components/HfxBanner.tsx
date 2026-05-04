import { useState } from "react";
import { Plus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import hfxAvatar from "@/assets/hfx-ai-guy.png";
import { useAuth } from "@/lib/auth";

const STARTERS = [
  "Add a feature that ",
  "I love how ",
  "It would be great if ",
  "I'm having trouble with ",
];

export function HfxBanner() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!message.trim()) {
      toast.error("Please write something first");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/contact-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user?.email,
          name: user?.email?.split("@")[0],
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to send");
      toast.success("Thanks! Your feedback was sent to HFX Ai Guy.");
      setMessage("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="mx-auto mt-8 flex max-w-6xl items-center gap-3 rounded-full border border-border bg-paper/70 px-4 py-2 text-sm shadow-sm">
        <img
          src={hfxAvatar}
          alt="HFX Ai Guy"
          className="h-8 w-8 rounded-full object-cover"
        />
        <span className="text-muted-foreground">
          Made by <span className="font-medium text-foreground">HFX Ai Guy</span>.
        </span>
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
