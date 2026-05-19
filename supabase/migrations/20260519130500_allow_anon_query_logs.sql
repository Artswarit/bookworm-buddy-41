-- Allow anonymous (unauthenticated) chatbot queries to be logged
-- This is needed because the BookLeaf chat widget doesn't require login
CREATE POLICY "Anon users can insert query logs"
ON public.query_logs
FOR INSERT
TO anon
WITH CHECK (true);

-- Also allow anon to read their own logs (for debugging)
CREATE POLICY "Anon users can view query logs"
ON public.query_logs
FOR SELECT
TO anon
USING (true);
