CREATE TABLE public.chapter_message_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, message_id)
);

CREATE INDEX idx_cmc_chapter ON public.chapter_message_context(chapter_id);
CREATE INDEX idx_cmc_book ON public.chapter_message_context(book_id);

ALTER TABLE public.chapter_message_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view chapter context"
ON public.chapter_message_context FOR SELECT TO authenticated
USING (is_book_member(book_id, auth.uid()));

CREATE POLICY "members insert chapter context"
ON public.chapter_message_context FOR INSERT TO authenticated
WITH CHECK (is_book_member(book_id, auth.uid()));

CREATE POLICY "members delete chapter context"
ON public.chapter_message_context FOR DELETE TO authenticated
USING (is_book_member(book_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.chapter_message_context;