-- Trigger to create profile on new auth user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to add book owner as member
DROP TRIGGER IF EXISTS on_book_created_add_owner ON public.books;
CREATE TRIGGER on_book_created_add_owner
  AFTER INSERT ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- updated_at triggers
DROP TRIGGER IF EXISTS books_touch_updated_at ON public.books;
CREATE TRIGGER books_touch_updated_at
  BEFORE UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS chapters_touch_updated_at ON public.chapters;
CREATE TRIGGER chapters_touch_updated_at
  BEFORE UPDATE ON public.chapters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
