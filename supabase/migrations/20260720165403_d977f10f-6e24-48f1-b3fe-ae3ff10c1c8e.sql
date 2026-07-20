
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.blog_post_views (
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

GRANT SELECT, INSERT ON public.blog_post_views TO authenticated;
GRANT ALL ON public.blog_post_views TO service_role;

ALTER TABLE public.blog_post_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "views: signed-in users can read their own"
  ON public.blog_post_views FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "views: signed-in users can record their own"
  ON public.blog_post_views FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.blog_post_likes (
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  liked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.blog_post_likes TO authenticated;
GRANT ALL ON public.blog_post_likes TO service_role;

ALTER TABLE public.blog_post_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes: signed-in users can read their own"
  ON public.blog_post_likes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "likes: signed-in users can like as themselves"
  ON public.blog_post_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "likes: signed-in users can unlike their own"
  ON public.blog_post_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.blog_post_views_increment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.blog_posts
    SET views_count = views_count + 1
    WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.blog_post_views_increment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_blog_post_views_increment ON public.blog_post_views;
CREATE TRIGGER trg_blog_post_views_increment
  AFTER INSERT ON public.blog_post_views
  FOR EACH ROW EXECUTE FUNCTION public.blog_post_views_increment();

CREATE OR REPLACE FUNCTION public.blog_post_likes_increment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.blog_posts
    SET likes_count = likes_count + 1
    WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.blog_post_likes_increment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_blog_post_likes_increment ON public.blog_post_likes;
CREATE TRIGGER trg_blog_post_likes_increment
  AFTER INSERT ON public.blog_post_likes
  FOR EACH ROW EXECUTE FUNCTION public.blog_post_likes_increment();

CREATE OR REPLACE FUNCTION public.blog_post_likes_decrement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.blog_posts
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.blog_post_likes_decrement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_blog_post_likes_decrement ON public.blog_post_likes;
CREATE TRIGGER trg_blog_post_likes_decrement
  AFTER DELETE ON public.blog_post_likes
  FOR EACH ROW EXECUTE FUNCTION public.blog_post_likes_decrement();
