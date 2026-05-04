import { useEffect, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

function makeToken() {
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "").slice(0, 24);
}

const emailSchema = z.string().trim().email().max(255);

export function InviteDialog({
  bookId,
  trigger,
}: {
  bookId: string;
  trigger: React.ReactNode;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!open) {
      setShareLink(null);
      setEmail("");
    }
  }, [open]);

  const generateLink = async () => {
    if (!user) return;
    setGenerating(true);
    const token = makeToken();
    const { error } = await supabase.from("invites").insert({
      book_id: bookId,
      token,
      created_by: user.id,
    });
    setGenerating(false);
    if (error) {
      toast.error("Could not create invite");
      return;
    }
    setShareLink(`${window.location.origin}/join/${token}`);
  };

  const sendEmailInvite = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    if (!user) return;
    const token = makeToken();
    const { error } = await supabase.from("invites").insert({
      book_id: bookId,
      token,
      email: parsed.data,
      created_by: user.id,
    });
    if (error) {
      toast.error("Could not create invite");
      return;
    }
    const link = `${window.location.origin}/join/${token}`;
    const mailto = `mailto:${parsed.data}?subject=${encodeURIComponent(
      "You're invited to co-write a book"
    )}&body=${encodeURIComponent(`Join me writing this book on Weave: ${link}`)}`;
    window.location.href = mailto;
    toast.success("Invite link copied to your email draft");
    setOpen(false);
  };

  const copy = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    toast.success("Link copied");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Invite a co-author</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="link">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link">Share link</TabsTrigger>
            <TabsTrigger value="email">Email invite</TabsTrigger>
          </TabsList>
          <TabsContent value="link" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Anyone with this link who signs in can join the book.
            </p>
            {shareLink ? (
              <div className="flex items-center gap-2">
                <Input value={shareLink} readOnly />
                <Button size="icon" onClick={copy} variant="secondary">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={generateLink} disabled={generating} className="w-full">
                {generating ? "Generating…" : "Generate share link"}
              </Button>
            )}
          </TabsContent>
          <TabsContent value="email" className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
              />
            </div>
            <Button onClick={sendEmailInvite} className="w-full">
              <Mail className="mr-2 h-4 w-4" /> Send invite
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
