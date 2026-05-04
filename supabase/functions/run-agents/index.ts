// Literary Agents pipeline: Structure | Quotation | Writing.
// Each agent can be invoked independently. Per-agent analysis is tracked in
// `message_agent_analysis` so each agent only sees messages it hasn't processed.
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

type AgentKind = "structure" | "quotation" | "writing";

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
                type: { type: "string", enum: ["create_quote", "assign_quote"] },
                quote_ref: { type: ["string", "null"] },
                source_message_id: { type: ["string", "null"] },
                speaker_id: { type: ["string", "null"] },
                text: { type: ["string", "null"] },
                chapter_id: { type: ["string", "null"] },
                section_id: { type: ["string", "null"] },
                quote_id: { type: ["string", "null"] },
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
      throw new Response(
        JSON.stringify({ error: res.status === 429 ? "Rate limit exceeded" : "AI credits exhausted" }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    throw new Error(`AI gateway ${res.status}`);
  }
  const json: any = await res.json();
  const tc = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return [];
  try {
    return JSON.parse(tc.function.arguments).actions ?? [];
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

    const { bookId, agent, chapterId, sectionId, messageId } = (await req.json()) as { bookId: string; agent: AgentKind; chapterId?: string; sectionId?: string; messageId?: string };
    if (!bookId) throw new Error("bookId required");
    if (!agent || !["structure", "quotation", "writing"].includes(agent)) {
      throw new Error("agent must be one of: structure, quotation, writing");
    }
    const focusedChapter = chapterId && /^[0-9a-f-]{36}$/i.test(chapterId) ? chapterId : null;
    const focusedSection = sectionId && /^[0-9a-f-]{36}$/i.test(sectionId) ? sectionId : null;
    const focusedMessage = messageId && /^[0-9a-f-]{36}$/i.test(messageId) ? messageId : null;

    // Load full book context
    const [
      { data: book },
      { data: chapters },
      { data: sections },
      { data: quotes },
      { data: placements },
      { data: globalPrompts },
      { data: bookPrompts },
      { data: allMsgs },
      { data: analyzed },
      { data: contextLinks },
    ] = await Promise.all([
      supabase.from("books").select("title,description").eq("id", bookId).maybeSingle(),
      supabase.from("chapters").select("id,title,position,synopsis,theme").eq("book_id", bookId).order("position"),
      supabase.from("chapter_sections").select("id,chapter_id,position,title,purpose,content").eq("book_id", bookId).order("position"),
      supabase.from("quotes").select("id,text,source_message_id,speaker_id").eq("book_id", bookId),
      supabase.from("quote_placements").select("id,quote_id,chapter_id,section_id").eq("book_id", bookId),
      supabase.from("agent_prompts_global").select("agent,prompt"),
      supabase.from("book_agent_prompts").select("agent,prompt").eq("book_id", bookId),
      supabase.from("messages").select("id,author_id,kind,body,transcript,created_at").eq("book_id", bookId).order("created_at"),
      supabase.from("message_agent_analysis").select("message_id,run_count").eq("book_id", bookId).eq("agent", agent),
      supabase.from("chapter_message_context").select("chapter_id,message_id").eq("book_id", bookId),
    ]);

    const analyzedSet = new Set((analyzed ?? []).map((r: any) => r.message_id));
    const runCountFor = (mid: string) =>
      ((analyzed ?? []).find((r: any) => r.message_id === mid)?.run_count as number | undefined) ?? 0;
    let newMessages: any[];
    let usedFallback = false;
    // Resolve focused section -> its chapter (for using context links)
    const sectionRow = focusedSection ? (sections ?? []).find((s: any) => s.id === focusedSection) : null;
    const sectionChapterId = sectionRow?.chapter_id ?? null;
    const effectiveFocusChapter = focusedChapter ?? sectionChapterId;
    if (focusedMessage) {
      const target = (allMsgs ?? []).find((m: any) => m.id === focusedMessage);
      if (!target) {
        return new Response(
          JSON.stringify({ inserted: 0, agent, message: "Message not found." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (runCountFor(focusedMessage) >= 3) {
        return new Response(
          JSON.stringify({ inserted: 0, agent, message: `${agent} agent already ran 3 times on this message.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      newMessages = [target];
    } else if (effectiveFocusChapter) {
      const focusedMsgIds = new Set(
        (contextLinks ?? [])
          .filter((c: any) => c.chapter_id === effectiveFocusChapter)
          .map((c: any) => c.message_id),
      );
      if (focusedMsgIds.size > 0) {
        newMessages = (allMsgs ?? []).filter((m: any) => focusedMsgIds.has(m.id));
      } else {
        usedFallback = true;
        newMessages = allMsgs ?? [];
      }
    } else {
      newMessages = (allMsgs ?? []).filter((m: any) => !analyzedSet.has(m.id));
    }

    if (newMessages.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, agent, message: focusedChapter ? "No messages found in this book yet." : "No new messages for this agent" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const promptFor = (a: string) => {
      const override = (bookPrompts ?? []).find((p: any) => p.agent === a)?.prompt;
      const global = (globalPrompts ?? []).find((p: any) => p.agent === a)?.prompt;
      return override || global || "";
    };

    const validMsgIds = new Set((allMsgs ?? []).map((m: any) => m.id));

    const chaptersText = (chapters ?? [])
      .map((c: any) => {
        const secs = (sections ?? []).filter((s: any) => s.chapter_id === c.id);
        const secLines = secs
          .map((s: any) => {
            const placedCount = (placements ?? []).filter((p: any) => p.section_id === s.id).length;
            const excerpt = (s.content ?? "").trim().slice(0, 800);
            return `  - "${s.title}" (id: ${s.id}) — purpose: ${s.purpose || "(none)"} — ${placedCount} quote(s)${excerpt ? `\n    Existing prose: ${excerpt}${s.content.length > 800 ? "…" : ""}` : ""}`;
          })
          .join("\n") || "  (no sections)";
        return `## Chapter "${c.title}" (id: ${c.id})\nSynopsis: ${c.synopsis || "(none)"}\nTheme: ${c.theme || "(none)"}\nSections:\n${secLines}`;
      })
      .join("\n\n");

    const quotesText = (quotes ?? [])
      .map((q: any) => {
        const places = (placements ?? []).filter((p: any) => p.quote_id === q.id);
        return `- (id: ${q.id}) "${q.text.slice(0, 500)}${q.text.length > 500 ? "…" : ""}" — placed in ${places.length} location(s)`;
      })
      .join("\n");

    const bookContext = `# Book\nTitle: ${book?.title ?? "(untitled)"}\nDescription: ${book?.description ?? "(none)"}\n\n# Existing chapters & sections\n${chaptersText || "(none yet)"}\n\n# Existing quotes\n${quotesText || "(none)"}`;

    // Load author profiles for messages so the agent can attribute quotes
    const authorIds = Array.from(new Set((allMsgs ?? []).map((m: any) => m.author_id).filter(Boolean)));
    const { data: authorProfiles } = authorIds.length
      ? await supabase.from("profiles").select("id,display_name").in("id", authorIds)
      : { data: [] as any[] };
    const authorName = (id: string | null) =>
      (authorProfiles ?? []).find((p: any) => p.id === id)?.display_name || "Unknown";

    const messagesText = newMessages
      .map((m: any) => {
        const t = m.kind === "voice" ? (m.transcript ?? "[voice — no transcript]") : m.body;
        return `- [msg ${m.id}, author_id ${m.author_id} ("${authorName(m.author_id)}")] ${t}`;
      })
      .join("\n");

    let actions: any[] = [];
    if (agent === "structure") {
      const focusNote = focusedChapter
        ? `\n\nFOCUS MODE: only propose section-level actions (add_section / rename_section / set_section_purpose / remove_section) for chapter id ${focusedChapter}. Do NOT touch other chapters and do NOT add_chapter.${usedFallback ? " This chapter has no explicitly-linked context messages, so the messages above are the full book conversation — infer which parts relate to this chapter from its title/synopsis/theme." : ""}`
        : "";
      actions = await callAgent(
        LOVABLE_API_KEY,
        promptFor("structure"),
        `${bookContext}\n\n# New conversation messages since this agent last ran\n${messagesText}\n\nPropose structure actions. CRITICAL: chapter_id and section_id MUST be one of the ids listed above — never invent ids. If a section belongs to a chapter that doesn't exist yet, emit add_chapter only and skip the section this round. Be conservative: only propose changes the conversation supports and that don't duplicate existing structure.${focusNote}`,
        STRUCTURE_TOOLS,
        "structure_actions",
      );
      // Attach the source message ids to add_chapter so the applier can record chapter context
      const newMsgIds = newMessages.map((m: any) => m.id);
      for (const a of actions) {
        if (a.type === "add_chapter") {
          a.source_message_ids = newMsgIds;
        }
        if (focusedChapter && a.type === "add_section" && !a.chapter_id) {
          a.chapter_id = focusedChapter;
        }
      }
      if (focusedChapter) {
        // Keep only section-level actions touching the focused chapter
        actions = actions.filter((a: any) => {
          if (["add_section", "rename_section", "set_section_purpose", "remove_section"].includes(a.type)) {
            return true;
          }
          return false;
        });
      }
    } else if (agent === "quotation") {
      actions = await callAgent(
        LOVABLE_API_KEY,
        promptFor("quotation"),
        `${bookContext}\n\n# New messages to extract quotes from\n${messagesText}\n\nFor each meaningful verbatim quote, emit a create_quote action with the EXACT verbatim text (never null/empty), a quote_ref like q1/q2, the source_message_id (must be one of the msg ids above), the speaker_id (REQUIRED — must equal the author_id of the source message — this attributes the quote to its author), and a chapter_id where the quote belongs (REQUIRED — must be one of the existing chapter ids). section_id is optional (null = quote attached at chapter level). Then emit additional assign_quote actions if the quote belongs to multiple chapters/sections. Avoid duplicating quotes already listed.`,
        QUOTATION_TOOLS,
        "quotation_actions",
      );
      // Validate: drop create_quote with empty text or invalid source_message_id
      actions = actions.filter((a: any) => {
        if (a.type === "create_quote") {
          if (!a.text || typeof a.text !== "string" || !a.text.trim()) {
            console.warn("dropping create_quote with empty text", a);
            return false;
          }
          if (a.source_message_id && !validMsgIds.has(a.source_message_id)) {
            a.source_message_id = null;
          }
          // Auto-fill speaker_id from source message author if missing/invalid
          const srcMsg = a.source_message_id ? (allMsgs ?? []).find((m: any) => m.id === a.source_message_id) : null;
          const validAuthorIds = new Set(authorIds);
          if (!a.speaker_id || !validAuthorIds.has(a.speaker_id)) {
            a.speaker_id = srcMsg?.author_id ?? null;
          }
          // Default to first chapter if model didn't pick one and only one exists
          if (!a.chapter_id && (chapters ?? []).length === 1) {
            a.chapter_id = (chapters as any[])[0].id;
          }
          if (!a.chapter_id) {
            console.warn("dropping create_quote without chapter_id", a);
            return false;
          }
        }
        return true;
      });
    } else if (agent === "writing") {
      if ((sections ?? []).length === 0) {
        return new Response(
          JSON.stringify({ inserted: 0, agent, message: "No sections to write into. Run Structure first." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const sectionFocusNote = focusedSection
        ? `\n\nFOCUS MODE: only propose write_section / append_to_section / replace_section actions for section_id ${focusedSection} (in chapter ${sectionChapterId}). Do not touch other sections.${usedFallback ? " The chapter has no explicitly-linked context messages, so the messages above are the full conversation — infer relevance from the section's title/purpose." : ""}`
        : "";
      actions = await callAgent(
        LOVABLE_API_KEY,
        promptFor("writing"),
        `${bookContext}\n\n# New conversation context\n${messagesText}\n\nFor sections that have assigned quotes (or that the new conversation enriches), propose write_section / append_to_section / replace_section actions. section_id and chapter_id MUST be ids from the book context above. Stay close to verbatim quotes — bridge with minimal connective prose. Do NOT replicate prose that already exists in the section's "Existing prose" — only append new material or rewrite if clearly improved.${sectionFocusNote}`,
        WRITING_TOOLS,
        "writing_actions",
      );
      if (focusedSection) {
        actions = actions.filter((a: any) =>
          ["write_section", "append_to_section", "replace_section"].includes(a.type) && a.section_id === focusedSection,
        );
      }
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validUuid = (v: any) => (typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : null);
    const validChapterIds = new Set((chapters ?? []).map((c: any) => c.id));
    const validSectionIds = new Set((sections ?? []).map((s: any) => s.id));

    const rows = actions.map((a: any) => {
      // Sanitize uuid-ish fields in payload
      for (const k of ["chapter_id", "other_chapter_id", "section_id", "source_message_id", "speaker_id"]) {
        if (k in a) a[k] = validUuid(a[k]);
      }
      // Drop ids that don't actually exist (avoid FK / 22P02 errors)
      if (a.chapter_id && !validChapterIds.has(a.chapter_id)) a.chapter_id = null;
      if (a.other_chapter_id && !validChapterIds.has(a.other_chapter_id)) a.other_chapter_id = null;
      if (a.section_id && !validSectionIds.has(a.section_id)) a.section_id = null;

      return {
        book_id: bookId,
        agent,
        action_type: a.type,
        payload: a,
        summary: a.summary,
        chapter_id: a.chapter_id ?? null,
        proposed_content: a.content ?? "",
      };
    });

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("suggested_edits").insert(rows);
      if (insErr) throw insErr;
    }

    // Mark messages analyzed for this agent (skip in focused chapter mode)
    if (!focusedChapter && !focusedSection) {
      const analysisRows = newMessages.map((m: any) => ({
        message_id: m.id,
        agent,
        book_id: bookId,
      }));
      if (analysisRows.length > 0) {
        await supabase.from("message_agent_analysis").upsert(analysisRows, {
          onConflict: "message_id,agent",
        });
      }
    }

    return new Response(
      JSON.stringify({ inserted: rows.length, agent, analyzed: newMessages.length, usedFallback }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("run-agents error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : (err && typeof err === "object" ? (err as any).message ?? JSON.stringify(err) : String(err)) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
