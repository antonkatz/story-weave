-- Public invite preview RPC: returns minimal book + inviter info for an invite token.
-- SECURITY DEFINER + grant to anon so the join landing page can render before auth.
create or replace function public.invite_preview(_token text)
returns table (
  book_id uuid,
  book_title text,
  book_description text,
  inviter_name text,
  expires_at timestamptz,
  redeemed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as book_id,
    b.title as book_title,
    b.description as book_description,
    coalesce(p.display_name, 'Someone') as inviter_name,
    i.expires_at,
    i.redeemed_at
  from public.invites i
  join public.books b on b.id = i.book_id
  left join public.profiles p on p.id = i.created_by
  where i.token = _token
  limit 1;
$$;

grant execute on function public.invite_preview(text) to anon, authenticated;

-- Public read-only book content for invite-token viewing.
create or replace function public.invite_book_content(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_book_id uuid;
  v_result jsonb;
begin
  select book_id into v_book_id from public.invites
    where token = _token and (expires_at is null or expires_at > now())
    limit 1;
  if v_book_id is null then
    return null;
  end if;
  select jsonb_build_object(
    'book', (select to_jsonb(b) from (select id, title, description from public.books where id = v_book_id) b),
    'chapters', coalesce((select jsonb_agg(to_jsonb(c) order by c.position) from (select id, title, position, synopsis, theme from public.chapters where book_id = v_book_id) c), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from (select id, chapter_id, title, purpose, content, position from public.chapter_sections where book_id = v_book_id) s), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(to_jsonb(q)) from (select id, text from public.quotes where book_id = v_book_id) q), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(to_jsonb(p)) from (select id, quote_id, chapter_id, section_id from public.quote_placements where book_id = v_book_id) p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.invite_book_content(text) to anon, authenticated;