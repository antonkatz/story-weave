-- Enable full replica identity on podcast tables so Supabase Realtime can
-- filter UPDATE events on non-primary-key columns (import_id, book_id).
-- Without this, the UI's episode status subscriptions miss intermediate
-- state transitions (queued → downloading → transcribing).
alter table public.podcast_imports replica identity full;
alter table public.podcast_import_episodes replica identity full;
