import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";

export const Route = createFileRoute("/join/$token")({
  component: () => (
    <RequireAuth>
      <JoinPage />
    </RequireAuth>
  ),
});

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Joining the book…");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("redeem_invite", { _token: token });
      if (error) {
        setStatus(error.message || "This invite is no longer valid.");
        toast.error("Invite invalid");
        return;
      }
      toast.success("You've joined the book!");
      navigate({ to: "/books/$bookId", params: { bookId: data as string } });
    })();
  }, [token, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="rounded-2xl border border-border bg-paper px-8 py-10 text-center shadow-page">
        <p className="font-serif text-xl">{status}</p>
      </div>
    </div>
  );
}
