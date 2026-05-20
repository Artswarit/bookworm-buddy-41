import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

/**
 * BookLeaf AI Author Support — Multi-channel-ready chat server function.
 * Routes through: n8n webhook → n8n MCP → Built-in KB (always works).
 * Strict rule: only answers from DB or KB. Unknown queries → escalate.
 */

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
  sessionId: z.string().optional(),
});

type ChatResult = {
  reply: string;
  confidence: number;
  escalated: boolean;
  intent: string;
  matchedEmail: string | null;
  source: "database" | "knowledge_base" | "none";
  authorFound: boolean;
};

// ─── Knowledge Base (Comprehensive FAQ) ──────────────────────────────
const KNOWLEDGE_BASE: Record<string, string> = {
  writing_challenge:
    "You can join our 21-Day Writing Challenge for ₹1999! This includes publishing your poetry book as a paperback and eBook. You'll submit one poem daily for 21 days. If you're a returning author your existing dashboard remains active and we just need to enable the 'Add a New Book' button for you. Check out the challenge details on our website!",
  publishing_timeline:
    "For standard publishing it takes about 30 to 45 business days from your final submission. If you've opted for the Bestseller Breakthrough Package we fast-track it to 18 to 22 business days! Your status will show as 'In Review' while our team handles formatting ISBN assignment and cover integration.",
  royalty_policy:
    "You get 10% royalty on printed paperbacks and 25% on eBooks (80% of net profit for regular authors, 100% for Bestseller Package). Royalties are paid via Razorpay link once you cross the threshold: ₹2000 for Indian authors or $100 for International. Bestseller Breakthrough authors have no threshold and can request on-demand payout after 30 days live. Calculate your exact earnings at bookleafpub.in/printing-cost-royalty-calculator.",
  sales_reports:
    "Track your sales at ebooks.bookleafpub.com/sales-reports. Reports are updated monthly after the 15th and are current up to the month before last. For new authors the first report is available 45-60 business days after going live. Just enter your ISBN in the white column to see your data!",
  isbn_info:
    "We provide a free ISBN for your book which is assigned during the production stage. Please note that this ISBN is for BookLeaf distribution only. If you want to use Amazon KDP yourself you'll need your own ISBN or the one Amazon assigns.",
  author_copies:
    "For Indian authors we provide one free author copy via a coupon code after publication. To get your coupon just complete the review form at https://docs.google.com/forms/d/e/1FAIpQLSc2q8Npy9bO3zpDuQKiupQP3ALNp_oYDjiEW7I46iSAF9Z64Q/viewform?usp=sf_link. Bestseller Package authors receive 5 complimentary copies (India only).",
  add_on_services:
    "We offer four main Expert Publishing services: Global Distribution (13 Amazon marketplaces + Ingram) the Emily Dickinson Award Global Distribution Bundle (includes Copyright) and the Bestseller Breakthrough Package (Priority publishing + Marketing guides).",
  add_on_prices:
    "Indian authors: Bestseller Package (₹11,999) - twa.bookleafpub.in/bestseller-breakthrough-india-dash-before-completion. Global Bundle (₹8,899) - rzp.io/rzp/uVwzD96. Global Distribution (₹5,499) - rzp.io/l/3lfxiA4Sg. Award (₹4,499) - rzp.io/l/KMajEJzA. Post Publishing Changes (₹2,150) - rzp.io/l/3mXfNwdA. International authors: Bestseller ($249) Global Bundle ($135) Global Dist ($75) Award ($115) and Paperback India ($35).",
  dashboard_login:
    "You can log in at dashboard.bookleafpub.in. If you haven't received your credentials within 2 minutes of payment check your spam folder! If you forgot your password just use the 'Forgot Password' link to receive a reset code via email.",
  hindi_support:
    "Yes you can absolutely submit Hindi poems! You can type them using Google Input Tools or copy-paste from another document. Just make sure to double-check the formatting in the dashboard preview.",
  cover_design:
    "You can design your cover using our dashboard templates or upload your own 5x8 inch custom front cover. Note that custom back covers aren't supported yet but you can customize the text and add an author photo to our standard back cover layout.",
  distribution:
    "Your book will be available on the BookLeaf store Amazon India and Flipkart. With Global Distribution we expand this to all 13 Amazon marketplaces (US UK Canada etc.) Barnes & Noble and the Ingram network (30,000+ stores and libraries).",
  copyright:
    "You retain 100% ownership! For Bestseller authors we handle Copyright Registration in 3 steps: 1. You receive a form and submit PAN/Aadhaar. 2. We file with the Indian Copyright Office. 3. Certificate arrives in 6-9 months although you are protected from the moment we file.",
  award_info:
    "The 21st Century Emily Dickinson Award is a symbolic recognition included in some packages. It's dispatched in batches 45-60 business days after your book is live. Note that awards are not personalized with author names to ensure timely delivery across hundreds of authors.",
  support_limitations:
    "To maintain efficiency we do not offer phone calls or video meetings. All support is provided via WhatsApp email or our helpdesk. We also don't offer standalone editing or custom design services and we strictly only publish poetry at this time (no fiction or novels).",
  kdp_restrictions:
    "You cannot use BookLeaf-provided files or ISBNs to upload your book to Amazon KDP or other platforms independently. If you wish to publish on KDP you must use a different ISBN and a version of your book without BookLeaf branding.",
  registration_links:
    "Ready to start? Indian authors can sign up at bookleafpub.in/writing-challenge while international authors can join at bookleafpub.com/writing-challenge-us.",
  support_contact:
    "For technical issues or registration help please raise a ticket at bookleafpublishing.freshdesk.com or email us at support@bookleafpub.com. We do not offer phone or video support. You can also watch our tutorial at youtu.be/Z9wxMeo624k.",
  fiction_policy:
    "BookLeaf Publishing currently only accepts poetry submissions for the 21-Day Writing Challenge. We do not accept fiction novels short stories or anthologies.",
  refund_policy:
    "We offer a full refund as long as our production team hasn't started working on your book yet. Once production begins we can't process a refund. If you're not satisfied with the challenge please reach out to our support team.",
  pen_name:
    "Yes you can use a pen name or pseudonym for both the writing challenge and your published book! Just set it up in your author profile on the dashboard.",
  bestseller_package:
    "The Bestseller Breakthrough Package includes a dedicated Publishing Consultant (who will contact you via email within 5-7 business days), priority publishing (18-22 days), 5 free author copies (Indian authors only), and Amazon Prime placement. You also get global distribution across 13 marketplaces and Ingram network.",
};

interface Author {
  email: string;
  name: string;
  book_title: string;
  isbn: string;
  final_submission_date: string;
  book_live_date: string | null;
  royalty_status: string;
  add_on_services: string[];
  author_copy_status: string;
  publishing_stage: string;
  dashboard_access: string;
}

// ─── Mocked Author Database ──────────────────────────────────────────
const MOCK_AUTHORS: Record<string, Author> = {
  "priya.sharma@gmail.com": {
    email: "priya.sharma@gmail.com",
    name: "Priya Sharma",
    book_title: "Whispers of the Valley",
    isbn: "978-93-12345-01-1",
    final_submission_date: "November 10 2024",
    book_live_date: "January 15 2025",
    royalty_status: "Processed. We credited 4200 rupees on March 1 2025.",
    add_on_services: ["Bestseller Package", "PR Campaign"],
    author_copy_status: "Dispatched on January 20 2025 via BlueDart (AWB: BD9234567)",
    publishing_stage: "Live",
    dashboard_access: "Active",
  },
  "arjun.mehta@yahoo.com": {
    email: "arjun.mehta@yahoo.com",
    name: "Arjun Mehta",
    book_title: "The Iron Compass",
    isbn: "978-93-12345-02-8",
    final_submission_date: "January 5 2025",
    book_live_date: "April 20 2025",
    royalty_status: "Pending. Your first royalty cycle starts in Q3 2025.",
    add_on_services: ["Award Submission"],
    author_copy_status: "In progress. We expect to ship them by April 25 2025.",
    publishing_stage: "Pre-Launch",
    dashboard_access: "Active",
  },
  "sara.johnson@xyz.com": {
    email: "sara.johnson@xyz.com",
    name: "Sara Johnson",
    book_title: "Echoes in Bloom",
    isbn: "978-93-12345-03-5",
    final_submission_date: "February 18 2025",
    book_live_date: "June 1 2025",
    royalty_status: "Not applicable yet because your book isn't live.",
    add_on_services: ["Bestseller Package"],
    author_copy_status: "Not shipped yet since your book is still in progress.",
    publishing_stage: "Editing & Design",
    dashboard_access: "Active",
  },
  "vikram.nair@hotmail.com": {
    email: "vikram.nair@hotmail.com",
    name: "Vikram Nair",
    book_title: "Silicon Dreams",
    isbn: "978-93-12345-04-2",
    final_submission_date: "September 1 2024",
    book_live_date: "December 10 2024",
    royalty_status: "Processed. We credited 7800 rupees on March 1 2025.",
    add_on_services: ["PR Campaign", "Award Submission", "Bestseller Package"],
    author_copy_status: "Delivered on December 15 2024.",
    publishing_stage: "Live",
    dashboard_access: "Active",
  },
  "meera.iyer@gmail.com": {
    email: "meera.iyer@gmail.com",
    name: "Meera Iyer",
    book_title: "The Last Garden",
    isbn: "978-93-12345-05-9",
    final_submission_date: "March 10 2025",
    book_live_date: "July 15 2025",
    royalty_status: "Not applicable yet.",
    add_on_services: [],
    author_copy_status: "Not shipped yet.",
    publishing_stage: "Manuscript Review",
    dashboard_access: "Active",
  },
};

// ─── n8n Webhook path ────────────────────────────────────────────────
async function sendViaN8nWebhook(
  data: z.infer<typeof chatSchema>,
  matchedEmail: string | null,
): Promise<ChatResult> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL || process.env.VITE_N8N_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("N8N_WEBHOOK_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookLeaf-Secret": process.env.N8N_WEBHOOK_SECRET || "bl-prod-secure-123",
      },
      signal: controller.signal,
      body: JSON.stringify({
        query: data.message,
        email: matchedEmail || "",
        platform: "web",
        sessionId: data.sessionId || "",
        history: data.history || [],
      }),
    });
    if (!res.ok) throw new Error(`N8N_HTTP_${res.status}`);
    const text = await res.text();
    if (!text || text.trim().length === 0) throw new Error("N8N_EMPTY_RESPONSE");
    const json = JSON.parse(text);
    const reply = String(json.reply ?? json.message ?? "");
    if (!reply) throw new Error("N8N_NO_REPLY");
    return {
      reply,
      confidence: Number(json.confidence ?? 0),
      escalated: Boolean(json.escalated ?? true),
      intent: String(json.intent ?? "general_info"),
      matchedEmail: json.matched_email ?? json.author_email ?? null,
      source: normalizeSource(json.data_source),
      authorFound: json.data_source === "database" || json.data_source === "supabase_live",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── n8n MCP path (JSON-RPC over Streamable HTTP) ────────────────────
interface McpCallResponse {
  result?: {
    structuredContent?: {
      executionId?: string;
    };
    content?: Array<{
      text?: string;
    }>;
  };
}

async function mcpCall(
  token: string,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallResponse> {
  const res = await fetch("https://ashwarit.app.n8n.cloud/mcp-server/http", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`MCP_HTTP_${res.status}`);
  const sseText = await res.text();
  const jsonStr = sseText
    .split("\n")
    .filter((l: string) => l.startsWith("data: "))
    .map((l: string) => l.slice(6))
    .join("");
  if (!jsonStr) throw new Error("MCP_EMPTY_SSE");
  return JSON.parse(jsonStr) as McpCallResponse;
}

async function sendViaN8nMcp(
  data: z.infer<typeof chatSchema>,
  matchedEmail: string | null,
): Promise<ChatResult> {
  const mcpToken = process.env.N8N_MCP_BEARER_TOKEN;
  if (!mcpToken) throw new Error("N8N_MCP_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const execResult = await mcpCall(
      mcpToken,
      "tools/call",
      {
        name: "execute_workflow",
        arguments: {
          workflowId: "NB9fdk1sldeIWVOx",
          data: {
            query: data.message,
            email: matchedEmail || "",
            platform: "web",
            sessionId: data.sessionId || "",
            history: data.history || [],
          },
        },
      },
      controller.signal,
    );
    const execId =
      execResult?.result?.structuredContent?.executionId ??
      execResult?.result?.content?.[0]?.text?.match(/"executionId"\s*:\s*"?(\w+)"?/)?.[1];
    if (!execId) throw new Error("MCP_NO_EXEC_ID");
    console.log(`[MCP] Workflow execution started: ${execId}`);

    // Exponential backoff with jitter for polling
    let attempt = 0;
    const maxAttempts = 8;
    const baseDelay = 1000;

    while (attempt < maxAttempts) {
      const delay = Math.pow(1.5, attempt) * baseDelay + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;

      const poll = await mcpCall(
        mcpToken,
        "tools/call",
        {
          name: "get_execution",
          arguments: {
            executionId: String(execId),
            workflowId: "NB9fdk1sldeIWVOx",
            includeData: true,
          },
        },
        controller.signal,
      );
      const pollText = poll?.result?.content?.[0]?.text;
      if (!pollText) continue;

      interface ExecNodeOutput {
        reply?: string;
        message?: string;
        status?: string;
        confidence?: number;
        escalated?: boolean;
        intent?: string;
        matched_email?: string;
        data_source?: string;
      }
      interface ExecRun {
        data?: {
          main?: Array<Array<{ json?: ExecNodeOutput }>>;
        };
      }
      interface ExecData {
        status?: string;
        data?: {
          status?: string;
          resultData?: {
            runData?: Record<string, ExecRun[]>;
          };
        };
      }

      let execData: ExecData | null = null;
      try {
        execData = JSON.parse(pollText) as ExecData;
      } catch {
        continue;
      }
      const status = execData.status ?? execData.data?.status;
      if (status === "running" || status === "waiting") continue;
      const runData = execData.data?.resultData?.runData ?? {};
      for (const nodeName of [
        "14 - Send HTTP Response",
        "12 - Build Final Response",
        "10b - Resolved Handler",
        "10a - Escalation Handler",
        "ERROR - Global Fallback Handler",
      ]) {
        const runs = runData[nodeName];
        if (!runs?.length) continue;
        const output = runs[runs.length - 1]?.data?.main?.[0]?.[0]?.json;
        if (output && (output.message || output.reply || output.status)) {
          console.log(`[MCP] Got result from node "${nodeName}"`);
          return {
            reply: String(output.reply ?? output.message ?? ""),
            confidence: Number(output.confidence ?? 0),
            escalated: Boolean(output.escalated ?? true),
            intent: String(output.intent ?? "general_info"),
            matchedEmail: output.matched_email ?? null,
            source: normalizeSource(output.data_source),
            authorFound:
              output.data_source === "database" || output.data_source === "supabase_live",
          };
        }
      }
      if (status === "error") throw new Error(`MCP_EXEC_ERROR`);
      throw new Error("MCP_NO_OUTPUT");
    }
    throw new Error("MCP_POLL_TIMEOUT");
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────
function normalizeSource(s: unknown): "database" | "knowledge_base" | "none" {
  const v = String(s ?? "none");
  if (v === "database" || v === "supabase_live" || v === "db_record") return "database";
  if (v === "knowledge_base") return "knowledge_base";
  return "none";
}

// ─── Supabase & local fallback lookups ─────────────────────────────────
async function lookupAuthor(email: string): Promise<Author | null> {
  const cleanEmail = email.toLowerCase().trim();

  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (sbUrl && sbKey) {
      const supabase = createClient(sbUrl, sbKey);
      const { data, error } = await supabase
        .from("authors")
        .select("*")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (!error && data) {
        console.log(`[Supabase] Found author:`, data);
        return {
          email: data.email,
          name: data.name || data.author_name || "Author",
          book_title: data.book_title || "Unknown Book",
          isbn: data.isbn || "Not assigned yet",
          final_submission_date: data.final_submission_date || "Not submitted yet",
          book_live_date: data.book_live_date || null,
          royalty_status: data.royalty_status || "No royalty details yet.",
          add_on_services: Array.isArray(data.add_on_services) ? data.add_on_services : [],
          author_copy_status: data.author_copy_status || "Not shipped yet.",
          publishing_stage: data.publishing_stage || "Manuscript Review",
          dashboard_access: data.dashboard_access || "Active",
        };
      }
    }
  } catch (err) {
    console.warn(`[Supabase lookup failed, using local MOCK_AUTHORS]:`, err);
  }

  return MOCK_AUTHORS[cleanEmail] ?? null;
}

// Support/system emails that must NEVER be used as author identity
const SYSTEM_EMAILS = new Set([
  "support@bookleafpub.com",
  "info@bookleafpub.com",
  "help@bookleafpub.com",
  "admin@bookleafpub.com",
  "noreply@bookleafpub.com",
]);

function isValidAuthorEmail(email: string): boolean {
  return (
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) &&
    !SYSTEM_EMAILS.has(email.toLowerCase())
  );
}

// ─── Session Memory Helpers ───────────────────────────────────────────
async function lookupSessionEmail(sessionId: string): Promise<string | null> {
  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (sbUrl && sbKey) {
      const supabase = createClient(sbUrl, sbKey);
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("verified_email")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (!error && data) {
        return data.verified_email || null;
      }
    }
  } catch (err) {
    console.warn(`[lookupSessionEmail failed]:`, err);
  }
  return null;
}

async function saveSessionEmail(
  sessionId: string,
  email: string,
  intent: string,
  query: string,
): Promise<void> {
  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (sbUrl && sbKey) {
      const supabase = createClient(sbUrl, sbKey);
      const { error } = await supabase.from("chat_sessions").upsert({
        session_id: sessionId,
        verified_email: email,
        last_intent: intent,
        last_query: query,
        timestamp: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.warn("[saveSessionEmail error]:", error.message);
      }
    }
  } catch (err) {
    console.warn(`[saveSessionEmail failed]:`, err);
  }
}

// ─── Support logs Logging Helper ──────────────────────────────────────
async function logToSupportLogs(log: {
  request_id: string;
  session_id?: string;
  original_query: string;
  normalized_query: string;
  extracted_email?: string | null;
  detected_intent: string;
  confidence: number;
  escalated_status: boolean;
  final_response: string;
}): Promise<void> {
  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (sbUrl && sbKey) {
      const supabase = createClient(sbUrl, sbKey);
      const { error } = await supabase.from("support_logs").insert({
        request_id: log.request_id,
        session_id: log.session_id || null,
        original_query: log.original_query,
        normalized_query: log.normalized_query,
        extracted_email: log.extracted_email || null,
        detected_intent: log.detected_intent,
        confidence: log.confidence,
        escalated_status: log.escalated_status,
        final_response: log.final_response,
        timestamp: new Date().toISOString(),
      });
      if (error) {
        console.warn("[logToSupportLogs error]:", error.message);
      }
    }
  } catch (err) {
    console.warn(`[logToSupportLogs failed]:`, err);
  }
}

// ─── NLP Typo Normalizer (offline fallback) ───────────────────────────
function cleanAndNormalizeQuery(query: string): {
  original: string;
  normalized: string;
  emails: string[];
} {
  const original = query;
  const clean = query.trim().replace(/\s+/g, " ");
  let normalized = clean.toLowerCase();

  // Typo Map for cleaning messy human input (offline fallback)
  const typoMap: Record<string, string> = {
    whre: "where", wher: "where", wheere: "where",
    bopok: "book", boook: "book", bok: "book", bokk: "book",
    roylty: "royalty", royality: "royalty", roylties: "royalty", royaltys: "royalty",
    maiil: "mail", emial: "email", emaill: "email", mial: "email",
    statis: "status", stutus: "status", statuss: "status", stats: "status",
    copi: "copy", copis: "copies",
    isnb: "isbn", ibsn: "isbn",
    delivred: "delivered", deliverd: "delivered", delivry: "delivery",
    dashbord: "dashboard", dashboad: "dashboard",
    statge: "stage", stge: "stage",
    publsh: "publish", publsih: "publish", publsihing: "publishing",
    paymnt: "payment", payemnt: "payment", pament: "payment",
    rveiw: "review", reveiw: "review",
    auhtor: "author", authro: "author", athor: "author",
    pric: "price", pirce: "price",
    halp: "help", hlep: "help", helo: "hello",
  };

  normalized = normalized.replace(/\b\w+\b/g, (match) => {
    return typoMap[match] ?? match;
  });

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = original.match(emailRe) ?? [];
  const uniqueEmails = Array.from(new Set(emails.map((e) => e.toLowerCase().trim())));

  return { original, normalized, emails: uniqueEmails };
}

// ─── Gemini AI Smart Preprocessor ─────────────────────────────────────
interface GeminiPreprocessResult {
  correctedQuery: string;
  extractedIntents: string[]; // Changed to array for multi-intent support
  extractedEmail: string | null;
  extractedName: string | null;
  isGreeting: boolean;
  isRambling: boolean; // Flag to indicate if the user is writing a long/complex sentence
}

async function geminiPreprocess(
  rawMessage: string,
  history: Array<{ role: string; content: string }>,
): Promise<GeminiPreprocessResult | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[Gemini] No API key found. Skipping AI preprocessing.");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const conversationContext = history
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `You are a smart query preprocessor for BookLeaf Publishing's author support chatbot.

Your job is to analyze a user's input (especially long or complex sentences) and extract all relevant information.

Context of the conversation so far:
${conversationContext || "(new conversation)"}

The user just typed: "${rawMessage}"

Do the following:
1. Fix all spelling mistakes and typos.
2. Identify ALL core intents present in the message from this list: greeting, book_status, royalty, isbn, author_copies, publishing_timeline, add_on_services, bestseller_package, pr_campaign, dashboard, sales_reports, distribution, copyright, pen_name, refund, contact, complaint, introduction, pricing, hindi_support, unknown.
3. If the user mentions multiple topics (e.g., "how long does it take and what is the royalty?"), capture BOTH intents.
4. Extract any email address if present.
5. Extract the user's name if they introduce themselves.
6. Determine if the user is writing a long/complex sentence (isRambling: true).
7. Set "correctedQuery" to a clean, keyword-dense master query that summarizes EVERYTHING the user asked.

Return ONLY valid JSON with no markdown formatting:
{"correctedQuery": "clean master query", "extractedIntents": ["intent1", "intent2"], "extractedEmail": "email@example.com or null", "extractedName": "their name or null", "isGreeting": true/false, "isRambling": true/false}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    });

    const text = response.text?.trim() || "";
    // Strip markdown code fences if Gemini wraps the response
    const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(jsonStr) as GeminiPreprocessResult;
    console.log("[Gemini] Preprocessed:", parsed);
    return parsed;
  } catch (err) {
    console.warn("[Gemini] Preprocessing failed (falling back to offline):", err);
    return null;
  }
}

// ─── Built-in KB fallback (always works, no external deps) ───────────
async function sendViaBuiltinKB(
  data: z.infer<typeof chatSchema>,
  matchedEmail: string | null,
): Promise<ChatResult> {
  const { original, normalized, emails } = cleanAndNormalizeQuery(data.message);

  // 1. Guard against multiple match emails in query
  const validEmails = emails.filter(isValidAuthorEmail);
  if (validEmails.length > 1) {
    return {
      reply:
        "I found a few email addresses in your message! To make sure I open the right account could you let me know which one is your registered author email?",
      confidence: 80,
      escalated: false,
      intent: "multiple_matches",
      matchedEmail: null,
      source: "none",
      authorFound: false,
    };
  }

  // Active email matching
  let activeEmail = matchedEmail;
  if (!activeEmail && validEmails.length === 1) {
    activeEmail = validEmails[0];
  }

  // Look in history for valid email if none active (Search from latest to oldest)
  if (!activeEmail && data.history?.length > 0) {
    const reversedHistory = [...data.history].reverse();
    for (const msg of reversedHistory) {
      if (msg.role !== "user") continue;
      const historyEmails =
        msg.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
      const historyValids = historyEmails.filter(isValidAuthorEmail);
      if (historyValids.length >= 1) {
        activeEmail = historyValids[historyValids.length - 1].toLowerCase();
        console.log(`[BuiltinKB] Found email in history: ${activeEmail}`);
        break;
      }
    }
  }

  let activeAuthor: Author | null = null;
  if (activeEmail) {
    activeAuthor = await lookupAuthor(activeEmail);
    if (!activeAuthor) {
      console.log(`[BuiltinKB] Active email ${activeEmail} not found in DB`);
    }
  } else {
    console.log(`[BuiltinKB] No active email identified for query: "${original}"`);
  }

  const getFirstName = (fullName: string) => {
    return fullName.split(" ")[0] || fullName;
  };

  const query = normalized;

  // Personal context check (English + Hinglish)
  const isPersonalQuery =
    /\b(my|i have|i got|where.s my|what.s my|check my|show my|give me my|mera|meri|mujhe|apne)\b/i.test(
      original,
    ) || /\b(kab|kaha|status|stage|royalty)\b/i.test(query);

  let intent = "";
  let replies: string[] = []; // Store multiple replies for long sentences
  let matchedConfidences: number[] = []; // Track confidences for each match
  let source: "database" | "knowledge_base" | "none" = "knowledge_base";
  let authorFound = !!activeAuthor;
  let escalated = false;

  // Email submission handler
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const isEmailOnly = emailRegex.test(original.trim());
  const hasAtButInvalid =
    original.trim().includes("@") && !isEmailOnly && original.trim().split(/\s+/).length === 1;

  if (isEmailOnly) {
    intent = "email_submission";
    const author = await lookupAuthor(original.trim());
    if (author) {
      replies.push(`Thanks ${getFirstName(author.name)}! I found your profile. How can I help you today?`);
      matchedConfidences.push(100);
      escalated = false;
      authorFound = true;
      source = "database";
      activeEmail = original.trim().toLowerCase();
    } else {
      replies.push("I couldn't find an author account linked to that email. Could you double-check the spelling or try your registered email?");
      matchedConfidences.push(85);
      escalated = false;
      authorFound = false;
      source = "none";
      activeEmail = original.trim().toLowerCase();
    }
    return { reply: replies.join(" "), confidence: matchedConfidences[0], escalated, intent, matchedEmail: activeEmail, source, authorFound };
  } else if (hasAtButInvalid) {
    intent = "email_invalid";
    replies.push("Could you enter a valid email address so I can look up your profile?");
    matchedConfidences.push(85);
    escalated = false;
    authorFound = false;
    source = "none";
    return { reply: replies.join(" "), confidence: matchedConfidences[0], escalated, intent, matchedEmail: activeEmail, source, authorFound };
  }

  // Off-topic check
  if (
    /\b(joke|riddle|bake|cake|recipe|cook|food|chocolate|ipl|cricket|sports|football|won.*match|game|score|weather|temperature|rain|sun|joke|funny|movie|song|music|singer)\b/i.test(
      original,
    )
  ) {
    intent = "general_info";
    replies.push("That doesn't seem related to BookLeaf support. How can I help you with your book instead?");
    matchedConfidences.push(85);
    escalated = false;
    source = "none";
  }

  // Intent checks (Non-exclusive for long sentences)
  // 1. Publishing timeline
  if (/\b(timeline|process|stage|publishing take|kitna time|kitne din|days|din lagenge|kab tak|kab hoga)\b/i.test(query)) {
    intent = "publishing_timeline";
    replies.push(KNOWLEDGE_BASE.publishing_timeline);
    matchedConfidences.push(95);
  }
  // 2. Royalty
  if (/\b(royalty|royalties|payment|paid|earning|paisa|rupee|milega|milegi|milenge|rupay|rupya)\b/i.test(query)) {
    intent = "royalty";
    if (activeAuthor) {
      const cleanRoyalty = activeAuthor.royalty_status.replace(/,/g, "").replace(/\./g, "");
      replies.push(`Hi ${getFirstName(activeAuthor.name)}! I checked your account for your book "${activeAuthor.book_title}" and your royalty status is ${cleanRoyalty} Just a heads up that statements are sent to your email and payments go through by the 28th of each month`);
      source = "database";
      matchedConfidences.push(96);
    } else if (isPersonalQuery && !activeEmail) {
      replies.push("I can pull up your personal royalty status! Could you share your registered email so I can look that up for you");
      matchedConfidences.push(85);
    } else {
      replies.push(KNOWLEDGE_BASE.royalty_policy);
      matchedConfidences.push(95);
    }
  }
  // 3. ISBN
  if (/\bisbn|kdp\b/i.test(query)) {
    intent = "isbn";
    if (query.includes("kdp")) {
      replies.push(KNOWLEDGE_BASE.kdp_restrictions);
      matchedConfidences.push(98);
    } else if (activeAuthor) {
      replies.push(`Hi ${getFirstName(activeAuthor.name)}! Yes the free ISBN for your book "${activeAuthor.book_title}" is ${activeAuthor.isbn} and our production team will place it on the back cover and retail pages automatically so you don't have to worry about a thing`);
      source = "database";
      matchedConfidences.push(96);
    } else if (isPersonalQuery && !activeEmail) {
      replies.push("I can check your assigned ISBN for you! Could you share your registered email so I can look up your details");
      matchedConfidences.push(85);
    } else {
      replies.push(KNOWLEDGE_BASE.isbn_info);
      matchedConfidences.push(95);
    }
  }
  // 4. Author Copies
  if (/\b(author.?cop|copies|free copy|paperback|dispatch|shipment|delivery)\b/i.test(query)) {
    intent = "author_copy";
    if (activeAuthor) {
      const cleanCopy = activeAuthor.author_copy_status.replace(/,/g, "").replace(/\.$/, "");
      replies.push(`Hi ${getFirstName(activeAuthor.name)}! I checked your free author copies for "${activeAuthor.book_title}" and the status is ${cleanCopy} If you want to order extra copies you can get them at discounted author rates directly through your dashboard`);
      source = "database";
      matchedConfidences.push(96);
    } else if (isPersonalQuery && !activeEmail) {
      replies.push("I can check your author copy shipment status! Could you share your registered email so I can look it up");
      matchedConfidences.push(85);
    } else {
      replies.push(KNOWLEDGE_BASE.author_copies);
      matchedConfidences.push(95);
    }
  }
  // 5. Writing Challenge
  if (/\b(challenge|join|poetry|21 day)\b/i.test(query)) {
    intent = "writing_challenge";
    replies.push(KNOWLEDGE_BASE.writing_challenge);
    matchedConfidences.push(95);
  }
  // 6. Pricing
  if (/\b(price|cost|how much|fee|link|payment)\b/i.test(query)) {
    intent = "pricing";
    replies.push(KNOWLEDGE_BASE.add_on_prices);
    matchedConfidences.push(95);
  }
  // 7. Hindi Support
  if (/\b(hindi|keyboard|regional language)\b/i.test(query)) {
    intent = "hindi_support";
    replies.push(KNOWLEDGE_BASE.hindi_support);
    matchedConfidences.push(95);
  }
  // 8. Book Status
  if (/\b(status|stage|progress|publish|live|ready|where.*book|kab live|kaha hai|kab tak|kab publish|stage kya)\b/i.test(query)) {
    intent = "book_status";
    if (activeAuthor) {
      const cleanSubmission = activeAuthor.final_submission_date.replace(/,/g, "");
      const cleanLive = activeAuthor.book_live_date ? activeAuthor.book_live_date.replace(/,/g, "") : null;
      replies.push(`Hi ${getFirstName(activeAuthor.name)}! Your book "${activeAuthor.book_title}" is currently in the ${activeAuthor.publishing_stage} stage and we got your final manuscript submission on ${cleanSubmission}${cleanLive ? ` We're working hard to get everything ready and expect your book to go live on Amazon Flipkart and the BookLeaf store by ${cleanLive}` : " Our team is reviewing the files and we'll update you on the next steps very soon"}`);
      source = "database";
      matchedConfidences.push(96);
    } else if (!activeEmail) {
      replies.push("I can check your book's status for you! Could you share your registered email so I can look up your account");
      matchedConfidences.push(85);
    }
  }
  // 9. Dashboard login / Password
  if (/\b(dashboard|login|log in|sign in|password|otp|forgot|can.?t log|unable.*login|credential)\b/i.test(query)) {
    intent = "dashboard_access";
    replies.push(KNOWLEDGE_BASE.dashboard_login);
    matchedConfidences.push(95);
  }
  // 10. Cover Design
  if (/\b(cover|design|template|author info|photo|back cover)\b/i.test(query)) {
    intent = "cover_design";
    replies.push(KNOWLEDGE_BASE.cover_design);
    matchedConfidences.push(95);
  }
  // 11. Distribution
  if (/\b(amazon|flipkart|distribut|where.*available|prime|ingram|barnes)\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.distribution);
    matchedConfidences.push(95);
  }
  // 11. Sales
  if (/\bsales|report|analytics|how many.*sold\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.sales_reports);
    matchedConfidences.push(95);
  }
  // 11b. Royalty Thresholds & Claims
  if (/\bthreshold|minimum|claim|razorpay|payout|transfer|bank account|upi\b/i.test(query)) {
    intent = "royalty";
    replies.push(KNOWLEDGE_BASE.royalty_policy);
    matchedConfidences.push(95);
  }
  // 12. Add-on services
  if (/\badd.?on|addon|service|marketing|editing|bestseller|breakthrough|award|dickinson|copyright|consultant|manager\b/i.test(query)) {
    intent = "addon_status";
    if (/\bconsultant|manager\b/i.test(query)) {
      replies.push(KNOWLEDGE_BASE.bestseller_package);
    } else if (/\baward|dickinson\b/i.test(query)) {
      replies.push(KNOWLEDGE_BASE.award_info);
    } else {
      replies.push(KNOWLEDGE_BASE.add_on_services);
    }
    matchedConfidences.push(95);
  }
  // 13. Pen name
  if (/\bpen name|pseudonym|different name\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.pen_name);
    matchedConfidences.push(95);
  }
  // 13b. Fiction Policy
  if (/\bfiction|novel|short story\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.fiction_policy);
    matchedConfidences.push(98);
  }
  // 14. Copyright
  if (/\b(copyright|rights|ownership|who owns)\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.copyright);
    matchedConfidences.push(95);
  }
  // 15. Refund
  if (/\b(refund|cancel|money back)\b/i.test(query)) {
    intent = "general_info";
    replies.push(KNOWLEDGE_BASE.refund_policy);
    matchedConfidences.push(90);
  }
  // 17. Contact / Technical Issues
  if (/\b(contact|reach out|email.*support|support.*email|address|how.*reach|ticket|freshdesk|issue|problem|working|load|video|tutorial|register|sign up|join)\b/i.test(query)) {
    intent = "general_info";
    if (/\bregister|sign up|join\b/i.test(query)) {
      replies.push(KNOWLEDGE_BASE.registration_links);
    } else {
      replies.push(KNOWLEDGE_BASE.support_contact);
    }
    matchedConfidences.push(95);
  }
  // 18. Complaints
  if (/\b(complaint|legal|lawyer|sue|harass|threat)\b/i.test(query)) {
    intent = "general_info";
    replies.push("I'm really sorry to hear that. Please email us at support@bookleafpub.com and a senior support manager will look into this for you right away");
    matchedConfidences.push(60);
  }

  // Final Reply synthesis
  let finalReply = "";
  let confidence = 90;
  if (replies.length > 0) {
    // Remove duplicate information from multiple matches
    const uniqueReplies = Array.from(new Set(replies));
    finalReply = uniqueReplies.join(" ");
    // Use the minimum confidence from all matches for safety
    confidence = matchedConfidences.length > 0 ? Math.min(...matchedConfidences) : 90;
  } else {
    // 19. Greeting and Introductions (Only if no other intent matched)
    if (
      /^(hi+|hello+|hey+|heya|howdy|good morning|good evening|yo)\b/i.test(query.trim()) ||
      /\b(my name is|i am|i'm|this is)\b/i.test(query.trim())
    ) {
      intent = "general_info";
      finalReply = "Hi there! 👋 I'm the BookLeaf support assistant. How can I help you with your publishing journey today";
      confidence = 98;
    } else {
      // Unmatched / Escalation
      intent = "general_info";
      finalReply =
        "I'm not completely sure about that but I have shared your question with our support team so they can look into it for you right away. You can also reach us directly at support@bookleafpub.com";
      confidence = 35;
      source = "none";
    }
  }

  escalated = confidence < 80;

  return { reply: finalReply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
}

// ─── Universal Sanitizer for Human Tone ─────────────────────────────
function sanitizeReplyForHumanTone(reply: string): string {
  return reply
    // Remove all commas
    .replace(/,/g, "")
    // Remove em dashes (—), en dashes (–), and spaced hyphens
    .replace(/[—–]/g, " ")
    .replace(/\s-\s/g, " ")
    // Replace colons with a natural conversational transition
    .replace(/:\s*/g, " is ")
    // Remove semicolons
    .replace(/;/g, "")
    // Remove trailing periods to feel like a real text message
    .replace(/\.$/, "")
    // Clean up any double spaces created by replacements
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Exported server function ────────────────────────────────────────
export const sendChat = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    const requestId = "BL-" + Math.random().toString(36).substring(2, 7).toUpperCase();

    // ─── Gemini AI Smart Preprocessing ──────────────────────────
    const geminiResult = await geminiPreprocess(data.message, data.history || []);
    const preprocessedMessage = geminiResult?.correctedQuery || data.message;
    console.log(`[sendChat] Original: "${data.message}" → Preprocessed: "${preprocessedMessage}"`);
    console.log(`[sendChat] Extracted Intents:`, geminiResult?.extractedIntents || []);

    // Overwrite data.message with the AI-corrected version for all downstream strategies
    const enhancedData = { ...data, message: preprocessedMessage };

    const { original, normalized, emails } = cleanAndNormalizeQuery(preprocessedMessage);
    const validEmails = emails.filter(isValidAuthorEmail);

    // If Gemini extracted an email that regex missed, inject it
    if (geminiResult?.extractedEmail && !validEmails.includes(geminiResult.extractedEmail.toLowerCase())) {
      const geminiEmail = geminiResult.extractedEmail.toLowerCase();
      if (isValidAuthorEmail(geminiEmail)) {
        validEmails.push(geminiEmail);
      }
    }

    // 1. Multiple Match Handling Guard
    if (validEmails.length > 1) {
      const multipleMatchResponse =
        "I found a few email addresses in your message! To make sure I open the right account could you let me know which one is your registered author email?";

      const cleanReply = sanitizeReplyForHumanTone(multipleMatchResponse);

      await logToSupportLogs({
        request_id: requestId,
        session_id: data.sessionId,
        original_query: original,
        normalized_query: normalized,
        extracted_email: null,
        detected_intent: "multiple_matches",
        confidence: 80,
        escalated_status: false,
        final_response: cleanReply,
      });

      return {
        reply: cleanReply,
        confidence: 80,
        intent: "multiple_matches",
        escalated: false,
        data_source: "none" as const,
        requestId: requestId,
      };
    }

    // 2. Session Memory lookup
    let matchedEmail: string | null = null;
    if (data.sessionId) {
      matchedEmail = await lookupSessionEmail(data.sessionId);
    }

    // 2b. Fallback: Search history for an email if session lookup fails
    if (!matchedEmail && data.history?.length > 0) {
      const reversedHistory = [...data.history].reverse();
      for (const msg of reversedHistory) {
        if (msg.role !== "user") continue;
        const emails = msg.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
        const valids = emails.filter(isValidAuthorEmail);
        if (valids.length >= 1) {
          matchedEmail = valids[valids.length - 1].toLowerCase();
          console.log(`[sendChat] Recovered email from history: ${matchedEmail}`);
          break;
        }
      }
    }

    console.log(`[sendChat] Active email context:`, matchedEmail || "none");

    // 3. Email extraction/overrides
    if (validEmails.length === 1) {
      const emailToCheck = validEmails[0];
      const author = await lookupAuthor(emailToCheck);
      if (author) {
        matchedEmail = emailToCheck;
      }
    }

    // 4. Routing strategies (using enhanced/cleaned message)
    // When we already have a session email, prioritize built-in KB first
    // because it has direct database access and can answer author-specific queries immediately
    const strategies: Array<{ name: string; fn: () => Promise<ChatResult> }> = [];
    if (matchedEmail) {
      // Built-in KB goes first when we know the author (direct DB access)
      strategies.push({ name: "built-in-kb", fn: () => sendViaBuiltinKB(enhancedData, matchedEmail) });
      if (process.env.N8N_WEBHOOK_URL || process.env.VITE_N8N_WEBHOOK_URL)
        strategies.push({
          name: "n8n-webhook",
          fn: () => sendViaN8nWebhook(enhancedData, matchedEmail),
        });
      if (process.env.N8N_MCP_BEARER_TOKEN)
        strategies.push({ name: "n8n-mcp", fn: () => sendViaN8nMcp(enhancedData, matchedEmail) });
    } else {
      // No session email yet, try n8n first for general queries
      if (process.env.N8N_WEBHOOK_URL || process.env.VITE_N8N_WEBHOOK_URL)
        strategies.push({
          name: "n8n-webhook",
          fn: () => sendViaN8nWebhook(enhancedData, matchedEmail),
        });
      if (process.env.N8N_MCP_BEARER_TOKEN)
        strategies.push({ name: "n8n-mcp", fn: () => sendViaN8nMcp(enhancedData, matchedEmail) });
      strategies.push({ name: "built-in-kb", fn: () => sendViaBuiltinKB(enhancedData, matchedEmail) });
    }

    let finalResult: ChatResult | null = null;
    for (const { name, fn } of strategies) {
      try {
        console.log(`[sendChat] Trying ${name}...`);
        const result = await fn();

        if (result && result.reply && result.reply.trim().length > 0) {
          console.log(`[sendChat] ${name} returned confidence ${result.confidence}`);
          
          if (!finalResult || result.confidence > finalResult.confidence) {
            finalResult = result;
          }

          if (!result.escalated && result.confidence >= 80) {
            console.log(`[sendChat] ${name} succeeded with high confidence. Break.`);
            break;
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[sendChat] ${name} failed:`, errMsg);
      }
    }

    // Fallback response if all failed
    if (!finalResult) {
      const fallbackResponse =
        "I'm having trouble connecting right now but I've passed this to our support team. Could you try again in a moment";
      finalResult = {
        reply: fallbackResponse,
        confidence: 30,
        escalated: true,
        intent: "general_info",
        matchedEmail,
        source: "none" as const,
        authorFound: !!matchedEmail,
      };
    }

    const cleanReply = sanitizeReplyForHumanTone(finalResult.reply);

    // 5. Update session memory if matched email changed or intent verified
    const resolvedEmailToSave = finalResult.matchedEmail || matchedEmail;
    if (data.sessionId && resolvedEmailToSave) {
      await saveSessionEmail(
        data.sessionId,
        resolvedEmailToSave,
        finalResult.intent,
        data.message,
      );
    }

    // 6. Query Interaction Logging (asynchronous support_logs)
    await logToSupportLogs({
      request_id: requestId,
      session_id: data.sessionId,
      original_query: original,
      normalized_query: normalized,
      extracted_email: finalResult.matchedEmail || (validEmails.length > 0 ? validEmails[0] : null),
      detected_intent: finalResult.intent,
      confidence: finalResult.confidence,
      escalated_status: finalResult.escalated,
      final_response: cleanReply,
    });

    // 7. Return exactly the required final response format
    return {
      reply: cleanReply,
      confidence: finalResult.confidence,
      intent: finalResult.intent,
      escalated: finalResult.escalated,
      data_source:
        finalResult.source === "database"
          ? "db_record"
          : finalResult.source === "knowledge_base"
            ? "knowledge_base"
            : "none",
      requestId: requestId,
    };
  });
