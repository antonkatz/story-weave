
-- Chapters: synopsis & theme
ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS synopsis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT '';

-- Chapter sections
CREATE TABLE IF NOT EXISTS public.chapter_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL,
  book_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chapter_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can view sections" ON public.chapter_sections FOR SELECT TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can insert sections" ON public.chapter_sections FOR INSERT TO authenticated WITH CHECK (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can update sections" ON public.chapter_sections FOR UPDATE TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can delete sections" ON public.chapter_sections FOR DELETE TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE TRIGGER trg_chapter_sections_touch BEFORE UPDATE ON public.chapter_sections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX IF NOT EXISTS idx_chapter_sections_chapter ON public.chapter_sections(chapter_id, position);

-- Quotes
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  source_message_id uuid,
  speaker_id uuid,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can view quotes" ON public.quotes FOR SELECT TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can insert quotes" ON public.quotes FOR INSERT TO authenticated WITH CHECK (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can update quotes" ON public.quotes FOR UPDATE TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can delete quotes" ON public.quotes FOR DELETE TO authenticated USING (public.is_book_member(book_id, auth.uid()));

-- Quote placements (many-to-many quote -> chapter/section)
CREATE TABLE IF NOT EXISTS public.quote_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  section_id uuid,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can view placements" ON public.quote_placements FOR SELECT TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can insert placements" ON public.quote_placements FOR INSERT TO authenticated WITH CHECK (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can update placements" ON public.quote_placements FOR UPDATE TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members can delete placements" ON public.quote_placements FOR DELETE TO authenticated USING (public.is_book_member(book_id, auth.uid()));

-- Messages: analyzed_at
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

-- Agent enum
DO $$ BEGIN
  CREATE TYPE public.agent_kind AS ENUM ('structure', 'quotation', 'writing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Global agent prompts
CREATE TABLE IF NOT EXISTS public.agent_prompts_global (
  agent public.agent_kind PRIMARY KEY,
  prompt text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_prompts_global ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read global prompts" ON public.agent_prompts_global FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update global prompts" ON public.agent_prompts_global FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth insert global prompts" ON public.agent_prompts_global FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.agent_prompts_global (agent, prompt) VALUES
('structure', 'You are the Structure Agent. Your job is to design and refine the overall skeleton of the book based on the conversation and existing chapters. Propose chapters with clear synopses and themes, and break each chapter into logically ordered sections, each with a distinct purpose. Prefer small, surgical changes. Only propose what is supported by the conversation.'),
('quotation', 'You are the Quotation Agent. Your job is to extract direct, verbatim quotes from the conversation messages and assign them to the chapters and sections where they belong. The same quote can be assigned to multiple chapters if it is relevant. Preserve the original wording exactly. Always cite the source message id.'),
('writing', 'You are the Writing Agent. Your job is to weave the assigned quotes for a section into cohesive prose. Stay close to the verbatim quotations: connect them with the lightest possible bridging text, in a warm, literary voice. Always target a specific chapter and section.')
ON CONFLICT (agent) DO NOTHING;

-- Per-book overrides
CREATE TABLE IF NOT EXISTS public.book_agent_prompts (
  book_id uuid NOT NULL,
  agent public.agent_kind NOT NULL,
  prompt text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, agent)
);
ALTER TABLE public.book_agent_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view book prompts" ON public.book_agent_prompts FOR SELECT TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members insert book prompts" ON public.book_agent_prompts FOR INSERT TO authenticated WITH CHECK (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members update book prompts" ON public.book_agent_prompts FOR UPDATE TO authenticated USING (public.is_book_member(book_id, auth.uid()));
CREATE POLICY "members delete book prompts" ON public.book_agent_prompts FOR DELETE TO authenticated USING (public.is_book_member(book_id, auth.uid()));

-- Suggested edits: agent / action_type / payload
ALTER TABLE public.suggested_edits
  ADD COLUMN IF NOT EXISTS agent public.agent_kind,
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow suggested_edits.kind to be optional for new agent-style edits
ALTER TABLE public.suggested_edits ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE public.suggested_edits ALTER COLUMN summary SET DEFAULT '';
ALTER TABLE public.suggested_edits ALTER COLUMN proposed_content SET DEFAULT '';
