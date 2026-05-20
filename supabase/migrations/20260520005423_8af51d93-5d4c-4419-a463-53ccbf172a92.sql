
CREATE POLICY "Public can read authors for chatbot lookup"
ON public.authors
FOR SELECT
TO anon
USING (true);
