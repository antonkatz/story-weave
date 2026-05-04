CREATE OR REPLACE FUNCTION public.invite_book_content(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'quotes', coalesce((select jsonb_agg(to_jsonb(q)) from (
      select q.id, q.text, q.speaker_id, p.display_name as author_name
      from public.quotes q
      left join public.profiles p on p.id = q.speaker_id
      where q.book_id = v_book_id
    ) q), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(to_jsonb(p)) from (select id, quote_id, chapter_id, section_id from public.quote_placements where book_id = v_book_id) p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;