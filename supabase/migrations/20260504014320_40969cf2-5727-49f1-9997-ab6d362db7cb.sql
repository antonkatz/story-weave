CREATE TABLE public.contributors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contributors are viewable by everyone"
ON public.contributors FOR SELECT
USING (true);

CREATE POLICY "Anyone can add themselves as a contributor"
ON public.contributors FOR INSERT
WITH CHECK (char_length(trim(name)) BETWEEN 1 AND 60);

CREATE INDEX idx_contributors_created_at ON public.contributors(created_at DESC);