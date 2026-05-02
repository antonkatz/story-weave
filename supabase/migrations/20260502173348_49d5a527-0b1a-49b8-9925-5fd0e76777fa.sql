
-- ============ ENUMS ============
create type public.member_role as enum ('owner', 'co_author');
create type public.message_kind as enum ('text', 'voice');
create type public.edit_kind as enum ('append', 'replace', 'new_chapter');
create type public.edit_status as enum ('pending', 'approved', 'rejected');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles selectable by everyone signed in"
  on public.profiles for select to authenticated using (true);
create policy "users can insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "users can update own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- Auto create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============ BOOKS ============
create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.books enable row level security;

-- ============ BOOK MEMBERS ============
create table public.book_members (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'co_author',
  created_at timestamptz not null default now(),
  unique (book_id, user_id)
);
alter table public.book_members enable row level security;

-- Security definer helpers (avoid RLS recursion)
create or replace function public.is_book_member(_book_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.book_members
    where book_id = _book_id and user_id = _user_id
  );
$$;

create or replace function public.is_book_owner(_book_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.books where id = _book_id and owner_id = _user_id
  );
$$;

-- BOOKS policies
create policy "members can view books"
  on public.books for select to authenticated
  using (public.is_book_member(id, auth.uid()));
create policy "users can create books"
  on public.books for insert to authenticated
  with check (auth.uid() = owner_id);
create policy "owners can update books"
  on public.books for update to authenticated
  using (auth.uid() = owner_id);
create policy "owners can delete books"
  on public.books for delete to authenticated
  using (auth.uid() = owner_id);

-- BOOK MEMBERS policies
create policy "members can view book_members"
  on public.book_members for select to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "owners can add members"
  on public.book_members for insert to authenticated
  with check (public.is_book_owner(book_id, auth.uid()) or auth.uid() = user_id);
create policy "owners can remove members"
  on public.book_members for delete to authenticated
  using (public.is_book_owner(book_id, auth.uid()) or auth.uid() = user_id);

-- Auto-add owner as member when book is created
create or replace function public.add_owner_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.book_members (book_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_book_created
  after insert on public.books
  for each row execute procedure public.add_owner_as_member();

-- ============ CHAPTERS ============
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null,
  content text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.chapters enable row level security;

create policy "members can view chapters"
  on public.chapters for select to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "members can insert chapters"
  on public.chapters for insert to authenticated
  with check (public.is_book_member(book_id, auth.uid()));
create policy "members can update chapters"
  on public.chapters for update to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "members can delete chapters"
  on public.chapters for delete to authenticated
  using (public.is_book_member(book_id, auth.uid()));

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text not null default '',
  audio_path text,
  transcript text,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

create policy "members can view messages"
  on public.messages for select to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "members can send messages"
  on public.messages for insert to authenticated
  with check (public.is_book_member(book_id, auth.uid()) and auth.uid() = author_id);
create policy "authors can update own messages"
  on public.messages for update to authenticated
  using (auth.uid() = author_id);
create policy "authors can delete own messages"
  on public.messages for delete to authenticated
  using (auth.uid() = author_id);

-- ============ SUGGESTED EDITS ============
create table public.suggested_edits (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete cascade,
  kind public.edit_kind not null,
  summary text not null,
  proposed_title text,
  proposed_content text not null,
  status public.edit_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
alter table public.suggested_edits enable row level security;

create policy "members can view edits"
  on public.suggested_edits for select to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "members can insert edits"
  on public.suggested_edits for insert to authenticated
  with check (public.is_book_member(book_id, auth.uid()));
create policy "members can update edits"
  on public.suggested_edits for update to authenticated
  using (public.is_book_member(book_id, auth.uid()));

-- ============ INVITES ============
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  token text not null unique,
  email text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);
alter table public.invites enable row level security;

create policy "members can view invites for their books"
  on public.invites for select to authenticated
  using (public.is_book_member(book_id, auth.uid()));
create policy "members can create invites"
  on public.invites for insert to authenticated
  with check (public.is_book_member(book_id, auth.uid()) and auth.uid() = created_by);
create policy "members can update invites"
  on public.invites for update to authenticated
  using (public.is_book_member(book_id, auth.uid()));

-- Allow signed-in users to look up an invite by token (so they can redeem it)
create or replace function public.find_invite_by_token(_token text)
returns table (id uuid, book_id uuid, email text, expires_at timestamptz, redeemed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, book_id, email, expires_at, redeemed_at from public.invites where token = _token;
$$;

create or replace function public.redeem_invite(_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite public.invites%rowtype;
begin
  select * into v_invite from public.invites where token = _token;
  if v_invite.id is null then
    raise exception 'Invalid invite';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite has expired';
  end if;

  insert into public.book_members (book_id, user_id, role)
  values (v_invite.book_id, auth.uid(), 'co_author')
  on conflict (book_id, user_id) do nothing;

  update public.invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where id = v_invite.id and redeemed_at is null;

  return v_invite.book_id;
end;
$$;

-- ============ STORAGE BUCKET ============
insert into storage.buckets (id, name, public)
values ('voice-messages', 'voice-messages', false)
on conflict (id) do nothing;

create policy "members can read voice files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-messages'
    and public.is_book_member((string_to_array(name, '/'))[1]::uuid, auth.uid())
  );
create policy "members can upload voice files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-messages'
    and public.is_book_member((string_to_array(name, '/'))[1]::uuid, auth.uid())
  );

-- ============ REALTIME ============
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.suggested_edits;
alter publication supabase_realtime add table public.chapters;
alter publication supabase_realtime add table public.book_members;
alter publication supabase_realtime add table public.books;

-- ============ updated_at triggers ============
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger books_touch before update on public.books
  for each row execute procedure public.touch_updated_at();
create trigger chapters_touch before update on public.chapters
  for each row execute procedure public.touch_updated_at();
