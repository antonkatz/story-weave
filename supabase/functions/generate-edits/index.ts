// Generates suggested edits for a book by reading recent conversation,
// using Lovable AI Gateway with tool-calling for structured output.
// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You help a group of friends collaboratively write a book by listening to their conversation and proposing concrete chapter edits.

You will receive:
- The current chapters of the book (title + content)
- The recent conversation between the co-authors (text and transcribed voice messages)

Your job: propose 1 to 4 thoughtful edits that weave ideas, anecdotes, or quotes from the conversation into the manuscript. Each edit must be one of:
- "append": add new prose to the end of an existing chapter (set chapter_id, proposed_content)
- "replace": replace an existing chapter's full content (set chapter_id, proposed_content)
- "new_chapter": draft a brand-new chapter (set proposed_title, proposed_content; leave chapter_id null)

Write in a warm, literary voice. Each proposed_content should be polished prose, not bullet points. Provide a short, human-readable summary explaining what the edit captures from the conversation.

Only suggest edits that are genuinely supported by the conversation. If there isn't enough new material, return an empty list.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { bookId } = await req.json();
    if (!bookId) throw new Error("bookId required");

    const [{ data: chapters }, { data: messages }] = await Promise.all([
      supabase
        .from("chapters")
        .select("id,title,content,position")
        .eq("book_id", bookId)
        .order("position", { ascending: true }),
      supabase
        .from("messages")
        .select("id,kind,body,transcript,created_at,author_id")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const convo = (messages ?? [])
      .reverse()
      .map((m: any) => {
        const txt = m.kind === "voice" ? (m.transcript ?? "[voice — not transcribed yet]") : m.body;
        return `- ${txt}`;
      })
      .join("\n");

    const chapterText = (chapters ?? [])
      .map((c: any) => `### Chapter "${c.title}" (id: ${c.id})\n${c.content || "(empty)"}`)
      .join("\n\n");

    const userPrompt = `# Current chapters\n\n${chapterText || "(no chapters yet)"}\n\n# Recent conversation\n\n${convo || "(no messages yet)"}\n\nPropose chapter edits.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "propose_edits",
              description: "Return 0-4 proposed chapter edits.",
              parameters: {
                type: "object",
                properties: {
                  edits: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: ["append", "replace", "new_chapter"] },
                        chapter_id: { type: ["string", "null"] },
                        proposed_title: { type: ["string", "null"] },
                        proposed_content: { type: "string" },
                        summary: { type: "string" },
                      },
                      required: ["kind", "proposed_content", "summary"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["edits"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "propose_edits" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI error", aiRes.status, txt);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded — please wait a bit." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted — please add credits in Settings → Workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("AI gateway error");
    }

    const aiJson: any = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = JSON.parse(toolCall.function.arguments);
    const edits: any[] = args.edits ?? [];

    if (edits.length === 0) {
      return new Response(JSON.stringify({ inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = edits.map((e) => ({
      book_id: bookId,
      chapter_id: e.kind === "new_chapter" ? null : e.chapter_id ?? null,
      kind: e.kind,
      summary: e.summary,
      proposed_title: e.proposed_title ?? null,
      proposed_content: e.proposed_content,
    }));

    const { error: insErr } = await supabase.from("suggested_edits").insert(rows);
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-edits error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
