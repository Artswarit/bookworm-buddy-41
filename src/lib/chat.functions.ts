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

// ─── Knowledge Base (all assignment-required topics) ─────────────────
const KNOWLEDGE_BASE: Record<string, string> = {
  publishing_timeline:
    "Our publishing process usually takes about 45 to 60 days from start to finish. We start with a manuscript review which takes 1 to 2 weeks. After that we dive into editing cover design and formatting which takes about 3 to 4 weeks. Once you approve the final proof your book will go live on stores within 7 days!",
  royalty_policy:
    "Royalties are calculated every month and sent over bank transfer by the 28th. You will get 10% of the price for printed paperback copies and 25% for eBooks. This begins 6 months after your book goes live if you have crossed the 500 rupees minimum threshold.",
  isbn_info:
    "Don't worry about the ISBN! We have you covered. We provide a free ISBN during production and it will be placed on your book's back cover and retail pages automatically.",
  author_copies:
    "We send you 2 free paperback copies of your book as soon as it's published! If you ever need more copies you can order them at a special author discount right from your dashboard.",
  add_on_services:
    "We offer quite a few cool add-ons like professional editing custom cover designs marketing campaigns and audiobook production. Feel free to request any of these before you approve the final book proof.",
  bestseller_package:
    "Our Bestseller Package is designed to give your book a strong start. We run a targeted Amazon campaign across 3 relevant categories within a 48 to 72 hour launch window plus promote it on our socials. We usually start this 30 to 45 days after your book goes live. While we do our absolute best we can't guarantee a specific sales rank.",
  pr_campaign:
    "Our PR Campaign gets your book featured in online news portals and media outlets to boost visibility. We handle everything from writing the press release to distributing it. Let our support team know if you want to get started!",
  dashboard:
    "You can log in to your dashboard anytime at dashboard.bookleafpub.com. Just enter your registered email address to receive a secure login code. If you have any trouble getting in just drop us an email at support@bookleafpub.com and we'll help you out!",
  password_reset:
    "To keep things simple and secure we use one-time passcodes sent to your registered email instead of traditional passwords. That means there's no password to reset! Just head over to dashboard.bookleafpub.com and enter your email to get your login code.",
  sales_reports:
    "You can track your sales anytime on the Sales tab of your author dashboard. The data updates once a week and covers all sales from Amazon Flipkart and the BookLeaf store.",
  distribution:
    "We distribute your book across Amazon India Amazon Global Flipkart and the BookLeaf bookstore. Please keep in mind that we don't handle offline bookstore placement.",
  amazon_availability:
    "Your book will list on Amazon Flipkart and the BookLeaf store within 7 days of going live. Prime eligibility depends entirely on Amazon centers so it is not something we can guarantee ourselves.",
  copyright:
    "You retain 100% of the copyright and creative ownership of your work! We only hold non-exclusive distribution rights as outlined in our publishing agreement.",
  pen_name:
    "Yes you can absolutely publish under a pen name! Just let our editorial team know during the manuscript review stage so we can set it up correctly on retail sites and your book cover.",
  refund_policy:
    "We can issue a full refund as long as production work hasn't started yet. Once our team begins working on your book we won't be able to process a refund. For any specific order questions please email us at support@bookleafpub.com.",
  writing_challenge:
    "We love hosting writing contests and challenges! You can find all the details and updates for our upcoming challenges on our website and social channels.",
  support_limitations:
    "We provide all of our support directly over email at support@bookleafpub.com. We aren't able to offer phone or video calls right now but our team works hard to reply to every email within 24 to 48 business hours.",
  contact:
    "You can always reach us at support@bookleafpub.com for help with your book or info@bookleafpub.com for general inquiries. Our main office is located on New Airport Road Srinagar J&K 190005.",
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
      headers: { "Content-Type": "application/json" },
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

    const delays = [1000, 2000, 3000, 4000, 5000, 5000];
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay));
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
  extractedIntent: string | null;
  extractedEmail: string | null;
  extractedName: string | null;
  isGreeting: boolean;
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

Your job is to take a user's raw messy input and return a clean JSON object.

Context of the conversation so far:
${conversationContext || "(new conversation)"}

The user just typed: "${rawMessage}"

Do the following:
1. Fix all spelling mistakes and typos
2. Identify the core intent from this list: greeting, book_status, royalty, isbn, author_copies, publishing_timeline, add_on_services, bestseller_package, pr_campaign, dashboard, sales_reports, distribution, copyright, pen_name, refund, contact, complaint, introduction, unknown
3. Extract any email address if present
4. Extract the user's name if they introduce themselves
5. Determine if this is a greeting or casual hello

IMPORTANT: If the message is clearly a follow-up referencing previous conversation context (like just saying "status" or "publish" after providing an email) then use the conversation history to understand what they mean and set the correctedQuery to a complete sentence.

Return ONLY valid JSON with no markdown formatting:
{"correctedQuery": "the cleaned up version of what the user meant", "extractedIntent": "one of the intents above or null", "extractedEmail": "email@example.com or null", "extractedName": "their name or null", "isGreeting": true/false}`;

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

  // Look in history for valid email if none active
  if (!activeEmail) {
    for (const msg of data.history) {
      if (msg.role !== "user") continue;
      const historyEmails =
        msg.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
      const historyValids = historyEmails.filter(isValidAuthorEmail);
      if (historyValids.length === 1) {
        activeEmail = historyValids[0].toLowerCase();
        break;
      }
    }
  }

  let activeAuthor: Author | null = null;
  if (activeEmail) {
    activeAuthor = await lookupAuthor(activeEmail);
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
  let reply = "";
  let confidence = 90;
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
      reply = `Thanks ${getFirstName(author.name)}! I found your profile. How can I help you today?`;
      confidence = 100;
      escalated = false;
      authorFound = true;
      source = "database";
      activeEmail = original.trim().toLowerCase();
    } else {
      reply =
        "I couldn't find an author account linked to that email. Could you double-check the spelling or try your registered email?";
      confidence = 85;
      escalated = false;
      authorFound = false;
      source = "none";
      activeEmail = original.trim().toLowerCase();
    }
    return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
  } else if (hasAtButInvalid) {
    intent = "email_invalid";
    reply = "Could you enter a valid email address so I can look up your profile?";
    confidence = 85;
    escalated = false;
    authorFound = false;
    source = "none";
    return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
  }

  // Off-topic check
  else if (
    /\b(joke|riddle|bake|cake|recipe|cook|food|chocolate|ipl|cricket|sports|football|won.*match|game|score|weather|temperature|rain|sun|joke|funny|movie|song|music|singer)\b/i.test(
      original,
    )
  ) {
    intent = "general_info";
    reply =
      "That doesn't seem related to BookLeaf support. How can I help you with your book instead?";
    confidence = 85;
    escalated = false;
    source = "none";
  }

  // Intent checks
  // 1. Publishing timeline (Hinglish/English)
  else if (
    /\b(timeline|how long|how much time|process|stages|publishing take|kitna time|kitne din|days|din lagenge|kab tak|kab hoga)\b/.test(
      query,
    )
  ) {
    intent = "publishing_timeline";
    reply = KNOWLEDGE_BASE.publishing_timeline;
  }
  // 2. Royalty (Hinglish/English)
  else if (
    /\b(royalt|payment|paid|earning|when.*get.*money|paisa|rupee|earning|milega|milegi|milenge|rupay|rupya)\b/.test(
      query,
    )
  ) {
    intent = "royalty";
    if (activeAuthor) {
      const cleanRoyalty = activeAuthor.royalty_status.replace(/,/g, "").replace(/\./g, "");
      reply = `Hi ${getFirstName(activeAuthor.name)}! I checked your account for your book "${activeAuthor.book_title}" and your royalty status is ${cleanRoyalty} Just a heads up that statements are sent to your email and payments go through by the 28th of each month`;
      source = "database";
      confidence = 96;
    } else if (activeEmail) {
      reply = `I couldn't find a publishing account under ${activeEmail} Could you double-check your registered email address or drop a line to support@bookleafpub.com`;
      confidence = 85;
    } else if (isPersonalQuery) {
      reply =
        "I can pull up your personal royalty status! Could you share your registered email so I can look that up for you";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.royalty_policy;
    }
  }
  // 3. ISBN
  else if (/\bisbn\b/.test(query)) {
    intent = "isbn";
    if (activeAuthor) {
      reply = `Hi ${getFirstName(activeAuthor.name)}! Yes the free ISBN for your book "${activeAuthor.book_title}" is ${activeAuthor.isbn} and our production team will place it on the back cover and retail pages automatically so you don't have to worry about a thing`;
      source = "database";
      confidence = 96;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your assigned ISBN for you! Could you share your registered email so I can look up your details";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.isbn_info;
    }
  }
  // 4. Author Copies
  else if (
    /\b(author.?cop|copies|my cop|free copy|free copies|paperback|dispatch|shipment|delivery)\b/.test(
      query,
    )
  ) {
    intent = "author_copy";
    if (activeAuthor) {
      const cleanCopy = activeAuthor.author_copy_status.replace(/,/g, "").replace(/\.$/, "");
      reply = `Hi ${getFirstName(activeAuthor.name)}! I checked your free author copies for "${activeAuthor.book_title}" and the status is ${cleanCopy} If you want to order extra copies you can get them at discounted author rates directly through your dashboard`;
      source = "database";
      confidence = 96;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your author copy shipment status! Could you share your registered email so I can look it up";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.author_copies;
    }
  }
  // 5. Add-on status
  else if (
    /\b(add.?on|addon|service|marketing|editing|cover design|audiobook|translation)\b/.test(query)
  ) {
    intent = "addon_status";
    if (activeAuthor && activeAuthor.add_on_services?.length > 0) {
      const cleanAddons = activeAuthor.add_on_services.join(" and ").replace(/,/g, "");
      reply = `Hi ${getFirstName(activeAuthor.name)}! For your book "${activeAuthor.book_title}" you currently have these add-ons active: ${cleanAddons} If you want to add professional editing cover design or marketing packages just let me know and I'll help you set it up`;
      source = "database";
      confidence = 95;
    } else if (activeAuthor) {
      reply = `Hi ${getFirstName(activeAuthor.name)}! It looks like you don't have any active add-on services for "${activeAuthor.book_title}" right now but if you're interested in professional editing marketing campaigns or premium cover design feel free to request them before you approve the final proof`;
      source = "database";
      confidence = 95;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your active add-on packages for you! Could you share your registered email so I can look them up";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.add_on_services;
    }
  }
  // 6. Bestseller
  else if (/\b(bestseller|best.?seller)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.bestseller_package;
  }
  // 7. PR Campaign
  else if (/\b(pr campaign|press release|media)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.pr_campaign;
  }
  // 8. Book Status / stage (Hinglish/English)
  else if (
    /\b(status|stage|progress|publish|live|ready|where.*book|book.*(status|stage|live|progress|ready)|kab live|kaha hai|kab tak|kab publish|stage kya)\b/.test(
      query,
    )
  ) {
    intent = "book_status";
    if (activeAuthor) {
      const cleanSubmission = activeAuthor.final_submission_date.replace(/,/g, "");
      const cleanLive = activeAuthor.book_live_date ? activeAuthor.book_live_date.replace(/,/g, "") : null;
      reply = `Hi ${getFirstName(activeAuthor.name)}! Your book "${activeAuthor.book_title}" is currently in the ${activeAuthor.publishing_stage} stage and we got your final manuscript submission on ${cleanSubmission}${cleanLive ? ` We're working hard to get everything ready and expect your book to go live on Amazon Flipkart and the BookLeaf store by ${cleanLive}` : " Our team is reviewing the files and we'll update you on the next steps very soon"}`;
      source = "database";
      confidence = 96;
    } else if (activeEmail) {
      reply = `I couldn't find a publishing account under ${activeEmail} Could you double-check your registered email address or drop a line to support@bookleafpub.com`;
      confidence = 85;
    } else {
      reply =
        "I can check your book's status for you! Could you share your registered email so I can look up your account";
      confidence = 85;
    }
  }
  // 9. Dashboard access
  else if (/\b(dashboard|login|log in|sign in)\b/.test(query)) {
    intent = "dashboard_access";
    reply = KNOWLEDGE_BASE.dashboard;
  }
  // 10. Password / OTP
  else if (/\b(password|forgot|otp|can.?t log|unable.*login)\b/.test(query)) {
    intent = "dashboard_access";
    reply = KNOWLEDGE_BASE.password_reset;
  }
  // 11. Sales
  else if (/\b(sales|report|analytics|how many.*sold)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.sales_reports;
  }
  // 12. Distribution / availability
  else if (/\b(amazon|flipkart|distribut|where.*available|prime)/i.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.amazon_availability + " " + KNOWLEDGE_BASE.distribution;
  }
  // 13. Pen name
  else if (/\b(pen name|pseudonym|different name)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.pen_name;
  }
  // 14. Copyright
  else if (/\b(copyright|rights|ownership|who owns)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.copyright;
  }
  // 15. Refund
  else if (/\b(refund|cancel|money back)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.refund_policy;
    confidence = 90;
  }
  // 16. Writing challenge
  else if (/\b(writing challenge|contest|competition)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.writing_challenge;
  }
  // 17. Support limitations
  else if (/\b(phone|call|video|meet|in.?person)\b/.test(query)) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.support_limitations;
  }
  // 18. Contact
  else if (
    /\b(contact|reach out|email.*support|support.*email|address|how.*reach)\b/.test(query) &&
    !/my email/i.test(query)
  ) {
    intent = "general_info";
    reply = KNOWLEDGE_BASE.contact;
  }
  // 19. Greeting and Introductions
  else if (
    /^(hi+|hello+|hey+|heya|howdy|good morning|good evening|yo)\b/i.test(query.trim()) ||
    /\b(my name is|i am|i'm|this is)\b/i.test(query.trim())
  ) {
    intent = "general_info";
    reply = "Hi there! 👋 I'm the BookLeaf support assistant. How can I help you with your publishing journey today";
    confidence = 98;
  }
  // 20. Complaints
  else if (/\b(complaint|legal|lawyer|sue|harass|threat)\b/.test(query)) {
    intent = "general_info";
    reply =
      "I'm really sorry to hear that. Please email us at support@bookleafpub.com and a senior support manager will look into this for you right away";
    confidence = 60;
  }
  // Unmatched / Escalation
  else {
    intent = "general_info";
    reply =
      "I'm not completely sure about that but I've shared your question with our support team so they can look into it. You can also reach us directly at support@bookleafpub.com";
    confidence = 35;
    source = "none";
  }

  escalated = confidence < 80;

  return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
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
      console.log(`[sendChat] Session memory lookup:`, matchedEmail);
    }

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
