CREATE TABLE public.authors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT,
  book_title TEXT,
  final_submission_date DATE,
  book_live_date DATE,
  royalty_status TEXT,
  isbn TEXT,
  add_on_services TEXT,
  publishing_stage TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view authors"
  ON public.authors FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert authors"
  ON public.authors FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update authors"
  ON public.authors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete authors"
  ON public.authors FOR DELETE TO authenticated USING (true);