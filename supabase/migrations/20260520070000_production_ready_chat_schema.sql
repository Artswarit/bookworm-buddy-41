-- Create chat_sessions table for conversation memory
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  session_id TEXT NOT NULL PRIMARY KEY,
  verified_email TEXT,
  last_intent TEXT,
  last_query TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on chat_sessions
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated users to perform operations on sessions
CREATE POLICY "Public can select chat sessions"
  ON public.chat_sessions FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can insert chat sessions"
  ON public.chat_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Public can update chat sessions"
  ON public.chat_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Create support_logs table for query interaction logging
CREATE TABLE IF NOT EXISTS public.support_logs (
  request_id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT,
  original_query TEXT,
  normalized_query TEXT,
  extracted_email TEXT,
  detected_intent TEXT,
  confidence DOUBLE PRECISION,
  escalated_status BOOLEAN DEFAULT FALSE,
  final_response TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on support_logs
ALTER TABLE public.support_logs ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated users to view and insert logs
CREATE POLICY "Public can view support logs"
  ON public.support_logs FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can insert support logs"
  ON public.support_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
