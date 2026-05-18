-- Store the Supabase project API URL as a database setting so the cron
-- schedule can reference it via current_setting() rather than having the
-- URL literal baked into the job definition itself.
alter database postgres
  set app.supabase_url to 'https://jyiqaaethdxbnjzpfzdw.supabase.co';

-- Fire the podcast-import-tick edge function once per minute.
-- The function picks one queued episode, downloads + transcribes it, and
-- (when all episodes are done) runs the structure/quotation agents.
-- verify_jwt is disabled on this function so no auth header is needed.
select cron.schedule(
  'podcast-import-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/podcast-import-tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) as request_id;
  $$
);
