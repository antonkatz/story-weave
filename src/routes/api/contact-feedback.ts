import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(255).optional(),
  message: z.string().trim().min(1).max(4000),
});

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export const Route = createFileRoute("/api/contact-feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const parsed = schema.safeParse(body);
          if (!parsed.success) {
            return new Response(
              JSON.stringify({ error: parsed.error.issues[0]?.message ?? "Invalid input" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
          const RESEND_API_KEY = process.env.RESEND_API_KEY;
          if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
            return new Response(
              JSON.stringify({ error: "Email service not configured" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const { name, email, message } = parsed.data;
          const escape = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const html = `
            <h2>New Weave feedback</h2>
            <p><strong>From:</strong> ${escape(name || "Anonymous")}${
              email ? ` &lt;${escape(email)}&gt;` : ""
            }</p>
            <p style="white-space:pre-wrap;">${escape(message)}</p>
          `;

          const response = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": RESEND_API_KEY,
            },
            body: JSON.stringify({
              from: "Weave Feedback <notify@hfxaiguy.com>",
              to: ["anton@hfxaiguy.com"],
              subject: `Weave feedback${name ? ` from ${name}` : ""}`,
              html,
              reply_to: email || undefined,
            }),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            return new Response(
              JSON.stringify({ error: (data as any)?.message || "Failed to send" }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
