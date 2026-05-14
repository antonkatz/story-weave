
-- Extensions for scheduled worker
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Status enums
do $$ begin
  create type public.podcast_import_status as enum ('pending','running','done','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.podcast_episode_status as enum ('queued','downloading','transcribing','done','error');
exception when duplicate_object then null; end $$;

create table if not exists public.podcast_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status public.podcast_import_status not null default 'pending',
  error text,
  source_url text not null,
  podcast_title text not null default '',
  book_id uuid,
  agents_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.podcast_import_episodes (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.podcast_imports(id) on delete cascade,
  position int not null default 0,
  episode_title text not null default '',
  audio_url text not null,
  duration_sec int not null default 0,
  status public.podcast_episode_status not null default 'queued',
  error text,
  source_message_id uuid,
  attempts int not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists podcast_import_episodes_import_id_idx on public.podcast_import_episodes(import_id);
create index if not exists podcast_import_episodes_status_idx on public.podcast_import_episodes(status);
create index if not exists podcast_imports_status_idx on public.podcast_imports(status);

-- updated_at triggers
drop trigger if exists touch_podcast_imports on public.podcast_imports;
create trigger touch_podcast_imports before update on public.podcast_imports
for each row execute function public.touch_updated_at();

drop trigger if exists touch_podcast_import_episodes on public.podcast_import_episodes;
create trigger touch_podcast_import_episodes before update on public.podcast_import_episodes
for each row execute function public.touch_updated_at();

-- RLS
alter table public.podcast_imports enable row level security;
alter table public.podcast_import_episodes enable row level security;

drop policy if exists "owner views imports" on public.podcast_imports;
create policy "owner views imports" on public.podcast_imports
for select to authenticated using (
  auth.uid() = user_id
  or (book_id is not null and public.is_book_member(book_id, auth.uid()))
);

drop policy if exists "owner inserts imports" on public.podcast_imports;
create policy "owner inserts imports" on public.podcast_imports
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "owner updates imports" on public.podcast_imports;
create policy "owner updates imports" on public.podcast_imports
for update to authenticated using (auth.uid() = user_id);

drop policy if exists "owner views episodes" on public.podcast_import_episodes;
create policy "owner views episodes" on public.podcast_import_episodes
for select to authenticated using (
  exists (
    select 1 from public.podcast_imports i
    where i.id = import_id and (
      i.user_id = auth.uid()
      or (i.book_id is not null and public.is_book_member(i.book_id, auth.uid()))
    )
  )
);

drop policy if exists "owner inserts episodes" on public.podcast_import_episodes;
create policy "owner inserts episodes" on public.podcast_import_episodes
for insert to authenticated with check (
  exists (
    select 1 from public.podcast_imports i
    where i.id = import_id and i.user_id = auth.uid()
  )
);

drop policy if exists "owner updates episodes" on public.podcast_import_episodes;
create policy "owner updates episodes" on public.podcast_import_episodes
for update to authenticated using (
  exists (
    select 1 from public.podcast_imports i
    where i.id = import_id and i.user_id = auth.uid()
  )
);

-- Realtime
alter publication supabase_realtime add table public.podcast_imports;
alter publication supabase_realtime add table public.podcast_import_episodes;
