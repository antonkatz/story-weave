DROP POLICY IF EXISTS "members can view books" ON public.books;
CREATE POLICY "members or owners can view books"
  ON public.books
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = owner_id) OR public.is_book_member(id, auth.uid()));

DROP TRIGGER IF EXISTS on_book_created ON public.books;
DROP TRIGGER IF EXISTS on_book_created_add_owner ON public.books;
CREATE TRIGGER on_book_created_add_owner
  AFTER INSERT ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.add_owner_as_member();

DROP TRIGGER IF EXISTS books_touch ON public.books;
DROP TRIGGER IF EXISTS books_touch_updated_at ON public.books;
CREATE TRIGGER books_touch_updated_at
  BEFORE UPDATE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS chapters_touch ON public.chapters;
DROP TRIGGER IF EXISTS chapters_touch_updated_at ON public.chapters;
CREATE TRIGGER chapters_touch_updated_at
  BEFORE UPDATE ON public.chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();