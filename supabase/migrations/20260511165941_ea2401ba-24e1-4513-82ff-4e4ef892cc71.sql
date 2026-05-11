
-- New table for diarized speakers per book
CREATE TABLE public.book_speakers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id uuid NOT NULL,
  speaker_key text NOT NULL,
  display_name text NOT NULL DEFAULT 'Speaker',
  sample_message_id uuid,
  sample_start_sec numeric,
  sample_end_sec numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, speaker_key)
);

ALTER TABLE public.book_speakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view book speakers"
  ON public.book_speakers FOR SELECT TO authenticated
  USING (public.is_book_member(book_id, auth.uid()));

CREATE POLICY "members insert book speakers"
  ON public.book_speakers FOR INSERT TO authenticated
  WITH CHECK (public.is_book_member(book_id, auth.uid()));

CREATE POLICY "members update book speakers"
  ON public.book_speakers FOR UPDATE TO authenticated
  USING (public.is_book_member(book_id, auth.uid()));

CREATE TRIGGER touch_book_speakers_updated_at
  BEFORE UPDATE ON public.book_speakers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_book_speakers_book ON public.book_speakers(book_id);

-- Extend messages with diarization fields
ALTER TABLE public.messages
  ADD COLUMN speaker_id uuid,
  ADD COLUMN source_audio_message_id uuid,
  ADD COLUMN audio_start_sec numeric,
  ADD COLUMN audio_end_sec numeric,
  ADD COLUMN diarization jsonb;

CREATE INDEX idx_messages_source_audio ON public.messages(source_audio_message_id);
CREATE INDEX idx_messages_speaker ON public.messages(speaker_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.book_speakers;
