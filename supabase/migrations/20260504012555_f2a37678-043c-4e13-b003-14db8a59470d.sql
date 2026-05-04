ALTER TABLE public.message_agent_analysis
  ADD COLUMN IF NOT EXISTS run_count integer NOT NULL DEFAULT 1;