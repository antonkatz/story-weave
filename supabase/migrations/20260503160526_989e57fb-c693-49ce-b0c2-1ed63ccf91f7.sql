ALTER TABLE public.chapters DROP COLUMN IF EXISTS content;

CREATE TABLE IF NOT EXISTS public.message_agent_analysis (
  message_id uuid NOT NULL,
  agent agent_kind NOT NULL,
  book_id uuid NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, agent)
);

ALTER TABLE public.message_agent_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view analysis" ON public.message_agent_analysis
  FOR SELECT TO authenticated USING (is_book_member(book_id, auth.uid()));
CREATE POLICY "members insert analysis" ON public.message_agent_analysis
  FOR INSERT TO authenticated WITH CHECK (is_book_member(book_id, auth.uid()));
CREATE POLICY "members delete analysis" ON public.message_agent_analysis
  FOR DELETE TO authenticated USING (is_book_member(book_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_msg_analysis_book_agent ON public.message_agent_analysis(book_id, agent);