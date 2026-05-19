-- The podcast-import-tick edge function is not auto-deployed by Lovable.dev,
-- so the cron job was 404-ing on every tick.
-- The TanStack server route at /api/public/podcast-import-tick IS deployed and
-- contains the same full worker logic. Store the Lovable.dev app URL as a
-- database setting and point pg_cron there instead.
alter database postgres
  set app.app_url to 'https://project--d3e6caea-0a39-4c53-bbba-303a2af2958b.lovable.app';

-- Remove the old schedule that pointed at the Supabase edge function.
select cron.unschedule('podcast-import-tick');

-- Re-create the schedule pointing at the working app route.
select cron.schedule(
  'podcast-import-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.app_url') || '/api/public/podcast-import-tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) as request_id;
  $$
);
