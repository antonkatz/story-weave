import { ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AgentPromptsEditor } from "@/components/agents/AgentPromptsEditor";

export function AgentSettingsDialog({ bookId, trigger }: { bookId: string; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Literary agent prompts (this book)</DialogTitle>
        </DialogHeader>
        <AgentPromptsEditor bookId={bookId} />
      </DialogContent>
    </Dialog>
  );
}
