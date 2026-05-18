CREATE TABLE public.query_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_query TEXT,
  detected_intent TEXT,
  matched_email TEXT,
  bot_response TEXT,
  confidence_score DOUBLE PRECISION,
  escalated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.query_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view query logs"
ON public.query_logs
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert query logs"
ON public.query_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update query logs"
ON public.query_logs
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete query logs"
ON public.query_logs
FOR DELETE
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_query_logs_updated_at
BEFORE UPDATE ON public.query_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();