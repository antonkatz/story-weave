// Literary Agents pipeline: Structure -> Quotation -> Writing.
// Emits granular actions as rows in suggested_edits for human approval.
// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3-flash-preview";

const STRUCTURE_TOOLS = [
  {
    type: "function",
    function: {
      name: "structure_actions",
      description: "Propose structure changes to chapters and sections.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "add_chapter",
                    "rename_chapter",
                    "set_chapter_synopsis",
                    "set_chapter_theme",
                    "combine_chapters",
                    "add_section",
                    "rename_section",
                    "set_section_purpose",
                    "remove_section",
                  ],
                },
                chapter_id: { type: ["string", "null"] },
                other_chapter_id: { type: ["string", "null"] },
                section_id: { type: ["string", "null"] },
                title: { type: ["string", "null"] },
                synopsis: { type: ["string", "null"] },
                theme: { type: ["string", "null"] },
                purpose: { type: ["string", "null"] },
                position: { type: ["number", "null"] },
                summary: { type: "string" },
              },
              required: ["type", "summary"],
              additionalProperties: false,
            },
          },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
  },
];

const QUOTATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "quotation_actions",
      description: "Extract quotes and assign them to chapters/sections.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["create_quote", "assign_quote"],
                },
                // for create_quote
                quote_ref: { type: ["string", "null"], description: "Local id used to refer to a quote within this batch (e.g. q1)" },
                source_message_id: { type: ["string", "null"] },
                speaker_id: { type: ["string", "null"] },
                text: { type: ["string", "null"] },
                // for assign_quote
                chapter_id: { type: ["string", "null"] },
                section_id: { type: ["string", "null"] },
                summary: { type: "string" },
              },
              required: ["type", "summary"],
              additionalProperties: false,
            },
          },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
  },
];

const WRITING_TOOLS = [
  {
    type: "function",
    function: {
      name: "writing_actions",
      description: "Write or rewrite section prose using assigned quotes.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["write_section", "append_to_section", "replace_section"],
                },
                chapter_id: { type: "string" },
                section_id: { type: "string" },
                content: { type: "string" },
                summary: { type: "string" },
              },
              required: ["type", "chapter_id", "section_id", "content", "summary"],
              additionalProperties: false,
            },
          },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
  },
];

async function callAgent(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  tools: any,
  toolName: string,
) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`agent ${toolName} error`, res.status, t);
    if (res.status === 429 || res.status === 402) {
      throw new Response(JSON.stringify({ error: res.status === 429 ? "Rate limit exceeded" : "AI credits exhausted" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    throw new Error(`AI gateway ${res.status}`);
  }
  const json: any = await res.json();
  const tc = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return [];
  try {
    const args = JSON.parse(tc.function.arguments);
    return args.actions ?? [];
  } catch (e) {
    console.error("parse args", e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { bookId } = await req.json();
    if (!bookId) throw new Error("bookId required");

    const [
      { data: chapters },
      { data: sections },
      { data: quotes },
      { data: placements },
      { data: globalPrompts },
      { data: bookPrompts },
      { data: newMessages },
    ] = await Promise.all([
      supabase.from("chapters").select("id,title,position,synopsis,theme").eq("book_id", bookId).order("position"),
      supabase.from("chapter_sections").select("id,chapter_id,position,title,purpose,content").eq("book_id", bookId).order("position"),
      supabase.from("quotes").select("id,text,source_message_id,speaker_id").eq("book_id", bookId),
      supabase.from("quote_placements").select("id,quote_id,chapter_id,section_id").eq("book_id", bookId),
      supabase.from("agent_prompts_global").select("agent,prompt"),
      supabase.from("book_agent_prompts").select("agent,prompt").eq("book_id", bookId),
      supabase.from("messages").select("id,author_id,kind,body,transcript,created_at").eq("book_id", bookId).is("analyzed_at", null).order("created_at"),
    ]);

    if (!newMessages || newMessages.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, byAgent: {}, message: "No new messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const promptFor = (agent: string) => {
      const override = (bookPrompts ?? []).find((p: any) => p.agent === agent)?.prompt;
      const global = (globalPrompts ?? []).find((p: any) => p.agent === agent)?.prompt;
      return override || global || "";
    };

    const chaptersText = (chapters ?? [])
      .map((c: any) => {
        const secs = (sections ?? []).filter((s: any) => s.chapter_id === c.id);
        return `## Chapter "${c.title}" (id: ${c.id})\nSynopsis: ${c.synopsis || "(none)"}\nTheme: ${c.theme || "(none)"}\nSections:\n${secs.map((s: any) => `  - "${s.title}" (id: ${s.id}) — purpose: ${s.purpose || "(none)"}`).join("\n") || "  (no sections)"}`;
      })
      .join("\n\n");

    const messagesText = newMessages
      .map((m: any) => {
        const t = m.kind === "voice" ? (m.transcript ?? "[voice — no transcript]") : m.body;
        return `- [msg ${m.id}, author ${m.author_id}] ${t}`;
      })
      .join("\n");

    const allMessagesForQuotes = newMessages
      .map((m: any) => `- [msg ${m.id}] ${m.kind === "voice" ? (m.transcript ?? "") : m.body}`)
      .join("\n");

    const quotesText = (quotes ?? [])
      .map((q: any) => {
        const places = (placements ?? []).filter((p: any) => p.quote_id === q.id);
        return `- (id: ${q.id}) "${q.text.slice(0, 200)}" — placed in ${places.length} location(s)`;
      })
      .join("\n");

    // 1. Structure agent
    const structureActions = await callAgent(
      LOVABLE_API_KEY,
      promptFor("structure"),
      `# Current chapters & sections\n${chaptersText || "(none yet)"}\n\n# New conversation messages since last analysis\n${messagesText}\n\nPropose structure actions. Be conservative — only what the conversation supports.`,
      STRUCTURE_TOOLS,
      "structure_actions",
    );

    // 2. Quotation agent
    const quotationActions = await callAgent(
      LOVABLE_API_KEY,
      promptFor("quotation"),
      `# Current chapters & sections\n${chaptersText || "(none yet)"}\n\n# Existing quotes\n${quotesText || "(none)"}\n\n# New messages to extract quotes from\n${allMessagesForQuotes}\n\nFor each meaningful verbatim quote, emit a create_quote action (with a quote_ref like q1, q2). Then emit assign_quote actions referencing existing chapters/sections by id, OR (if it's a new quote) referring to it by quote_ref. Same quote may be assigned to multiple chapters.`,
      QUOTATION_TOOLS,
      "quotation_actions",
    );

    // 3. Writing agent — only if there are sections to write into
    let writingActions: any[] = [];
    if ((sections ?? []).length > 0) {
      writingActions = await callAgent(
        LOVABLE_API_KEY,
        promptFor("writing"),
        `# Chapters & sections\n${chaptersText}\n\n# Quotes available (with placements)\n${quotesText || "(none)"}\n\n# New conversation context\n${messagesText}\n\nFor sections that have assigned quotes (or that the new conversation enriches), propose write_section / append_to_section / replace_section actions. Stay close to verbatim quotes — bridge with minimal connective prose.`,
        WRITING_TOOLS,
        "writing_actions",
      );
    }

    // Build suggested_edits rows
    const rows: any[] = [];
    for (const a of structureActions) {
      rows.push({
        book_id: bookId,
        agent: "structure",
        action_type: a.type,
        payload: a,
        summary: a.summary,
        chapter_id: a.chapter_id ?? null,
      });
    }
    for (const a of quotationActions) {
      rows.push({
        book_id: bookId,
        agent: "quotation",
        action_type: a.type,
        payload: a,
        summary: a.summary,
        chapter_id: a.chapter_id ?? null,
      });
    }
    for (const a of writingActions) {
      rows.push({
        book_id: bookId,
        agent: "writing",
        action_type: a.type,
        payload: a,
        summary: a.summary,
        chapter_id: a.chapter_id ?? null,
        proposed_content: a.content ?? "",
      });
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("suggested_edits").insert(rows);
      if (insErr) throw insErr;
    }

    // Mark messages analyzed
    const ids = newMessages.map((m: any) => m.id);
    await supabase.from("messages").update({ analyzed_at: new Date().toISOString() }).in("id", ids);

    return new Response(
      JSON.stringify({
        inserted: rows.length,
        byAgent: {
          structure: structureActions.length,
          quotation: quotationActions.length,
          writing: writingActions.length,
        },
        analyzed: ids.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("run-agents error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
