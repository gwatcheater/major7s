
DROP POLICY IF EXISTS "Blog images: public read" ON storage.objects;

-- Allow direct GETs (anon + authenticated) without enabling bucket listing.
-- Storage list endpoints require a permissive policy on (bucket_id, name='');
-- restricting to name <> '' blocks listing while keeping object reads public.
CREATE POLICY "Blog images: public object read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'blog-images' AND name <> '');
