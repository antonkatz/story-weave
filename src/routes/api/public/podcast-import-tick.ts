// Manual HTTP trigger for the podcast-import-tick edge function.
// The scheduled execution comes from pg_cron → edge function directly.
// This route exists for ad-hoc triggering (e.g. dev testing).
import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function invokeEdgeFn() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/podcast-import-tick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: "{}",
  });
  return r.json();
}

export const Route = createFileRoute("/api/public/podcast-import-tick")({
  server: {
    handlers: {
      POST: async () => Response.json(await invokeEdgeFn()),
      GET: async () => Response.json(await invokeEdgeFn()),
    },
  },
});
