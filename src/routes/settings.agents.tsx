import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";
import { AgentPromptsEditor } from "@/components/agents/AgentPromptsEditor";

export const Route = createFileRoute("/settings/agents")({
  component: () => (
    <RequireAuth>
      <AgentsSettingsPage />
    </RequireAuth>
  ),
});

function AgentsSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/books">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
        <div>
          <h1 className="font-serif text-2xl font-semibold">Literary agents</h1>
          <p className="text-sm text-muted-foreground">
            Global default prompts for the Structure, Quotation, and Writing agents. Each book can override these.
          </p>
        </div>
      </div>
      <AgentPromptsEditor />
    </div>
  );
}
