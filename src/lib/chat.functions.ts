import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

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
    "The publishing process usually takes about 45 to 60 days. First, your manuscript is reviewed (1 to 2 weeks), then it goes into editing, typesetting, and cover design (3 to 4 weeks). After that, you'll get a final proof to review. Once you approve it, your book will go live on Amazon, Flipkart, and our website within 7 days. Your author copies will ship within a week after that.",
  royalty_policy:
    "Royalties are calculated monthly and paid by bank transfer, usually by the 28th of the following month. For print books, you receive 10% of the MRP, and for eBooks, it's 25% of the MRP. Payouts start once you reach a minimum of 500 rupees. You'll receive a royalty statement by email before each payment, and your first cycle starts 6 months after your book goes live.",
  isbn_info:
    "We provide a free ISBN during the production stage, which will appear on your back cover and listings on Amazon and Flipkart. There is nothing you need to do on your end. Just a heads up, BookLeaf ISBNs can't be used for KDP or other self-publishing platforms.",
  author_copies:
    "Every author gets 2 free paperback copies once their book is published. If you want to order more, you can get them at the special author price directly from your dashboard. These copies usually ship within 7 days of your book going live.",
  add_on_services:
    "We offer several add-ons like editing, premium cover design, marketing packages, audiobooks, and translation. You can add these to your project anytime before your book enters the final proofing stage.",
  bestseller_package:
    "Our Bestseller Package includes an Amazon bestseller campaign across 3 categories with a 48 to 72 hour launch window, social media promotion, and a bestseller certificate. This campaign usually runs 30 to 45 days after your book goes live. Please keep in mind that we can't guarantee specific rankings or sales numbers.",
  dashboard:
    "You can log into your dashboard at dashboard.bookleafpub.com using your registered email and a one-time passcode. From there, you'll be able to track your book's status, sales data, royalties, and add-on services. If you have any trouble logging in, please email support@bookleafpub.com.",
  password_reset:
    "We use one-time passcodes (OTP) for login, so there is no password to reset. Just go to dashboard.bookleafpub.com and enter your registered email to get a login code. If you don't receive the OTP, please check your spam folder or reach out to support@bookleafpub.com.",
  sales_reports:
    "You can find your sales reports on the dashboard under the Sales tab. The sales data updates weekly and breaks down sales by platforms like Amazon, Flipkart, and our website. Log in at dashboard.bookleafpub.com to check them out.",
  distribution:
    "We distribute books across Amazon India, Amazon Global, Flipkart, and the BookLeaf website. International distribution is also available for select titles. Please note that offline bookstore placement is not something we can guarantee.",
  amazon_availability:
    "Your book will be listed on Amazon, Flipkart, and bookleafpub.com within 7 days of going live. Amazon Prime eligibility depends entirely on Amazon's criteria, so that is not something we can guarantee.",
  copyright:
    "You always keep the copyright and full creative ownership of your work. We only hold non-exclusive publishing and distribution rights as detailed in your agreement.",
  pen_name:
    "Yes, you can absolutely publish under a pen name! Just let our team know during the manuscript review stage. We'll make sure it appears on the cover, Amazon, Flipkart, and all other distribution channels.",
  refund_policy:
    "Refund options depend on where your book is in the process. If work hasn't started yet, a refund may be possible. Once the book enters production, we generally can't offer refunds. Please email support@bookleafpub.com with your details if you have any questions.",
  award_submission:
    "We submit eligible books to 5 to 10 literary awards that match your genre. These submissions go out within 60 days of your book going live. Award results depend on each organization's timeline and are not guaranteed.",
  pr_campaign:
    "Our PR Campaign includes a press release sent to over 50 media outlets, outreach to bloggers and influencers, and a featured author interview on our blog. The campaign usually runs for 2 to 4 weeks after activation.",
  writing_challenge:
    "We host writing challenges and contests for aspiring authors from time to time. We announce all the details on our website and social media. Winners can receive publishing packages or mentorship opportunities.",
  support_limitations:
    "We provide customer support by email at support@bookleafpub.com. Phone calls, video calls, or in-person meetings are not available right now. You can expect a reply within 24 to 48 business hours.",
  contact:
    "You can reach us at info@bookleafpub.com for general questions, or support@bookleafpub.com for support. Our office is located at New Airport Road, ParrayPora, Srinagar, J&K 190005.",
};

// ─── Mocked Author Database ──────────────────────────────────────────
const MOCK_AUTHORS: Record<string, any> = {
  "priya.sharma@gmail.com": {
    email: "priya.sharma@gmail.com",
    name: "Priya Sharma",
    book_title: "Whispers of the Valley",
    isbn: "978-93-12345-01-1",
    final_submission_date: "November 10, 2024",
    book_live_date: "January 15, 2025",
    royalty_status: "Processed. We credited 4,200 rupees on March 1, 2025.",
    add_on_services: ["Bestseller Package", "PR Campaign"],
    author_copy_status: "Dispatched on January 20, 2025 via BlueDart (AWB: BD9234567)",
    publishing_stage: "Live",
    dashboard_access: "Active",
  },
  "arjun.mehta@yahoo.com": {
    email: "arjun.mehta@yahoo.com",
    name: "Arjun Mehta",
    book_title: "The Iron Compass",
    isbn: "978-93-12345-02-8",
    final_submission_date: "January 5, 2025",
    book_live_date: "April 20, 2025",
    royalty_status: "Pending. Your first royalty cycle starts in Q3 2025.",
    add_on_services: ["Award Submission"],
    author_copy_status: "In progress. We expect to ship them by April 25, 2025.",
    publishing_stage: "Pre-Launch",
    dashboard_access: "Active",
  },
  "sara.johnson@xyz.com": {
    email: "sara.johnson@xyz.com",
    name: "Sara Johnson",
    book_title: "Echoes in Bloom",
    isbn: "978-93-12345-03-5",
    final_submission_date: "February 18, 2025",
    book_live_date: "June 1, 2025",
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
    final_submission_date: "September 1, 2024",
    book_live_date: "December 10, 2024",
    royalty_status: "Processed. We credited 7,800 rupees on March 1, 2025.",
    add_on_services: ["PR Campaign", "Award Submission", "Bestseller Package"],
    author_copy_status: "Delivered on December 15, 2024.",
    publishing_stage: "Live",
    dashboard_access: "Active",
  },
  "meera.iyer@gmail.com": {
    email: "meera.iyer@gmail.com",
    name: "Meera Iyer",
    book_title: "The Last Garden",
    isbn: "978-93-12345-05-9",
    final_submission_date: "March 10, 2025",
    book_live_date: "July 15, 2025",
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
      body: JSON.stringify({ query: data.message, email: matchedEmail || "", platform: "web" }),
    });
    if (!res.ok) throw new Error(`N8N_HTTP_${res.status}`);
    const text = await res.text();
    if (!text || text.trim().length === 0) throw new Error("N8N_EMPTY_RESPONSE");
    const json = JSON.parse(text);
    // Handle both { reply } and { message } response formats
    const reply = String(json.reply ?? json.message ?? "");
    if (!reply) throw new Error("N8N_NO_REPLY");
    return {
      reply,
      confidence: Number(json.confidence ?? 0),
      escalated: Boolean(json.escalated ?? true),
      intent: String(json.intent ?? "other"),
      matchedEmail: json.matched_email ?? json.author_email ?? null,
      source: normalizeSource(json.data_source),
      authorFound: json.data_source === "database" || json.data_source === "supabase_live",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── n8n MCP path (JSON-RPC over Streamable HTTP) ────────────────────
async function mcpCall(
  token: string,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
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
  return JSON.parse(jsonStr);
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
          data: { query: data.message, email: matchedEmail || "", platform: "web" },
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
      let execData: any;
      try {
        execData = JSON.parse(pollText);
      } catch {
        continue;
      }
      const status = execData?.status ?? execData?.data?.status;
      if (status === "running" || status === "waiting") continue;
      const runData = execData?.data?.resultData?.runData ?? {};
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
            intent: String(output.intent ?? "other"),
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

// ─── Supabase & local fallback lookups ─────────────────────────────────

async function lookupAuthor(email: string): Promise<any> {
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

async function logQueryToSupabase(
  userQuery: string,
  detectedIntent: string,
  matchedEmail: string | null,
  botResponse: string,
  confidenceScore: number,
  escalated: boolean,
) {
  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (sbUrl && sbKey) {
      await fetch(`${sbUrl}/rest/v1/query_logs`, {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          user_query: userQuery,
          detected_intent: detectedIntent,
          matched_email: matchedEmail,
          bot_response: botResponse,
          confidence_score: confidenceScore,
          escalated,
        }),
      }).catch(() => {});
    }
  } catch {
    /* logging is best-effort */
  }
}

// ─── Built-in KB fallback (always works, no external deps) ───────────

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

async function sendViaBuiltinKB(data: z.infer<typeof chatSchema>): Promise<ChatResult> {
  const query = data.message.toLowerCase();

  // ── Email extraction: ONLY from user messages, never from bot responses ──
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // 1. Scan for any verified author in current message or history first (never overwrite verified with invalid/support)
  let activeEmail: string | null = null;
  let activeAuthor: any = null;

  const currentEmails = data.message.match(emailRe) ?? [];
  for (const e of currentEmails) {
    if (isValidAuthorEmail(e)) {
      const author = await lookupAuthor(e);
      if (author) {
        activeEmail = e.toLowerCase();
        activeAuthor = author;
        break;
      }
    }
  }

  if (!activeEmail) {
    for (const msg of data.history) {
      if (msg.role !== "user") continue;
      const matches = msg.content.match(emailRe) ?? [];
      for (const e of matches) {
        if (isValidAuthorEmail(e)) {
          const author = await lookupAuthor(e);
          if (author) {
            activeEmail = e.toLowerCase();
            activeAuthor = author;
            break;
          }
        }
      }
      if (activeAuthor) break;
    }
  }

  // 2. If no verified author found, fallback to any valid-looking email in current message or history
  if (!activeEmail) {
    for (const e of currentEmails) {
      if (isValidAuthorEmail(e)) {
        activeEmail = e.toLowerCase();
        break;
      }
    }
    if (!activeEmail) {
      for (const msg of data.history) {
        if (msg.role !== "user") continue;
        const matches = msg.content.match(emailRe) ?? [];
        for (const e of matches) {
          if (isValidAuthorEmail(e)) {
            activeEmail = e.toLowerCase();
            break;
          }
        }
        if (activeEmail) break;
      }
    }
  }

  // ── Helper: is this a personal/possessive query requiring author identity? ──
  const isPersonalQuery =
    /\b(my |i have|i got|where.s my|what.s my|check my|show my|give me my)\b/i.test(data.message);

  let intent = "";
  let reply = "";
  let confidence = 90;
  let source: "database" | "knowledge_base" | "none" = "knowledge_base";
  let authorFound = !!activeAuthor;
  let escalated = false;

  // ── Intent matching (ordered by specificity) ──

  // ── Email-only & Invalid Email matchers ──
  const trimmed = data.message.trim();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const isEmailOnly = emailRegex.test(trimmed);
  const hasAtButInvalid =
    trimmed.includes("@") && !isEmailOnly && trimmed.split(/\s+/).length === 1;

  if (isEmailOnly) {
    intent = "email_submission";
    const author = await lookupAuthor(trimmed);
    if (author) {
      reply = `Thanks ${author.name}. I found your author profile. How can I help you today?`;
      confidence = 100;
      escalated = false;
      authorFound = true;
      source = "database";
      activeEmail = trimmed.toLowerCase();
      activeAuthor = author;
    } else {
      reply = "I couldn’t find an author account linked to this email. Please check and try again.";
      confidence = 85;
      escalated = false;
      authorFound = false;
      source = "none";
      activeEmail = trimmed.toLowerCase();
    }
    await logQueryToSupabase(data.message, intent, activeEmail, reply, confidence, escalated);
    return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
  } else if (hasAtButInvalid) {
    intent = "email_invalid";
    reply = "Please enter a valid email address so I can look up your profile.";
    confidence = 85;
    escalated = false;
    authorFound = false;
    source = "none";
    await logQueryToSupabase(data.message, intent, activeEmail, reply, confidence, escalated);
    return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
  }

  // ── Off-topic check ──
  else if (
    /\b(joke|riddle|bake|cake|recipe|cook|food|chocolate|ipl|cricket|sports|football|won.*match|game|score|weather|temperature|rain|sun|joke|funny|movie|song|music|singer)\b/i.test(
      query,
    )
  ) {
    intent = "off_topic";
    reply =
      "That doesn’t seem related to BookLeaf publishing support, so I’ve shared it with our support team.";
    confidence = 30;
    escalated = true;
    source = "none";
  }

  // Awards (check before book status — "guarantee book win award")
  else if (/\b(award|literary prize|nomination|win.*award|guarantee.*award)\b/.test(query)) {
    intent = "award_submission";
    reply = KNOWLEDGE_BASE.award_submission;
  }
  // Book status / "is my book live" (must have book-related keyword)
  else if (
    /\b(book.*(live|status|stage|progress|ready)|is.*book.*live|where.*my.*book|my book.*(status|stage))\b/.test(
      query,
    )
  ) {
    intent = "publishing_stage";
    if (activeAuthor) {
      reply = `Hey ${activeAuthor.name}! Your book "${activeAuthor.book_title}" is in the ${activeAuthor.publishing_stage} stage. It was submitted on ${activeAuthor.final_submission_date}${activeAuthor.book_live_date ? `, and we expect it to go live by ${activeAuthor.book_live_date}` : ""}.`;
      source = "database";
      authorFound = true;
      confidence = 96;
    } else if (activeEmail) {
      reply = `I couldn't find an account for ${activeEmail}. Could you check if that's the email you registered with? You can also reach us at support@bookleafpub.com.`;
      confidence = 60;
    } else {
      reply =
        "I can definitely check your book's status for you! Could you share your registered email so I can look up your account?";
      confidence = 85;
    }
  }
  // Royalties
  else if (/\b(royalt|payment|paid|earning|when.*get.*money)/i.test(query)) {
    intent = "royalty_status";
    if (activeAuthor) {
      reply = `Hey ${activeAuthor.name}! Regarding royalties for "${activeAuthor.book_title}": ${activeAuthor.royalty_status} As a quick reminder, royalties are calculated monthly and usually paid by the 28th of the following month.`;
      source = "database";
      authorFound = true;
      confidence = 95;
    } else if (activeEmail) {
      reply = `I couldn't find an account for ${activeEmail}. Could you check that email? You can also reach us at support@bookleafpub.com.`;
      confidence = 60;
    } else if (isPersonalQuery) {
      reply =
        "I can check your royalty details for you! Could you share your registered email so I can pull up your info?";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.royalty_policy;
    }
  }
  // ISBN
  else if (/\bisbn\b/.test(query)) {
    intent = "isbn_lookup";
    if (activeAuthor) {
      reply = `Hey ${activeAuthor.name}! The ISBN for "${activeAuthor.book_title}" is ${activeAuthor.isbn}. As a reminder, BookLeaf provides a free ISBN during production. It will appear on your back cover and retail listings like Amazon and Flipkart.`;
      source = "database";
      authorFound = true;
      confidence = 96;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your ISBN for you! Could you share your registered email so I can look up your details?";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.isbn_info;
    }
  }
  // Author copies
  else if (/\b(author.?cop|copies|my cop)\b/.test(query)) {
    intent = "author_copies";
    if (activeAuthor) {
      reply = `Hey ${activeAuthor.name}! Regarding your author copies for "${activeAuthor.book_title}": ${activeAuthor.author_copy_status} As a reminder, every author gets 2 free paperbacks once published, and you can order more at author prices on your dashboard.`;
      source = "database";
      authorFound = true;
      confidence = 94;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your author copies status for you! Could you share your registered email so I can look it up?";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.author_copies;
    }
  }
  // Add-on services
  else if (/\b(add.?on|addon|service|what.*include)\b/.test(query)) {
    intent = "add_on_services";
    if (activeAuthor && activeAuthor.add_on_services?.length > 0) {
      reply = `Hey ${activeAuthor.name}! You have these active add-ons for "${activeAuthor.book_title}": ${activeAuthor.add_on_services.join(", ")}. BookLeaf offers various add-on services, which you can add anytime before the final proofing stage.`;
      source = "database";
      authorFound = true;
      confidence = 93;
    } else if (isPersonalQuery && !activeEmail) {
      reply =
        "I can check your active add-on services for you! Could you share your registered email so I can look them up?";
      confidence = 85;
    } else {
      reply = KNOWLEDGE_BASE.add_on_services;
    }
  }
  // Bestseller package
  else if (/\b(bestseller|best.?seller)\b/.test(query)) {
    intent = "bestseller_package";
    reply = KNOWLEDGE_BASE.bestseller_package;
  }
  // PR Campaign
  else if (/\b(pr campaign|press release|media)\b/.test(query)) {
    intent = "pr_campaign";
    reply = KNOWLEDGE_BASE.pr_campaign;
  }
  // Publishing timeline
  else if (/\b(timeline|how long|how much time|process|stages|publishing take)\b/.test(query)) {
    intent = "publishing_timeline";
    reply = KNOWLEDGE_BASE.publishing_timeline;
  }
  // Dashboard / login
  else if (/\b(dashboard|login|log in|sign in)\b/.test(query)) {
    intent = "dashboard_access";
    reply = KNOWLEDGE_BASE.dashboard;
  }
  // Password / OTP
  else if (/\b(password|forgot|otp|can.?t log|unable.*login)\b/.test(query)) {
    intent = "password_reset";
    reply = KNOWLEDGE_BASE.password_reset;
  }
  // Sales reports
  else if (/\b(sales|report|analytics|how many.*sold)\b/.test(query)) {
    intent = "sales_reports";
    reply = KNOWLEDGE_BASE.sales_reports;
  }
  // Amazon / distribution
  else if (/\b(amazon|flipkart|distribut|where.*available|prime)/i.test(query)) {
    intent = "amazon_availability";
    reply = KNOWLEDGE_BASE.amazon_availability + " " + KNOWLEDGE_BASE.distribution;
  }
  // Pen name
  else if (/\b(pen name|pseudonym|different name)\b/.test(query)) {
    intent = "pen_name";
    reply = KNOWLEDGE_BASE.pen_name;
  }
  // Copyright
  else if (/\b(copyright|rights|ownership|who owns)\b/.test(query)) {
    intent = "copyright";
    reply = KNOWLEDGE_BASE.copyright;
  }
  // Refund / cancellation
  else if (/\b(refund|cancel|money back)\b/.test(query)) {
    intent = "refund_policy";
    reply = KNOWLEDGE_BASE.refund_policy;
    confidence = 85;
  }
  // Writing challenge
  else if (/\b(writing challenge|contest|competition)\b/.test(query)) {
    intent = "writing_challenge";
    reply = KNOWLEDGE_BASE.writing_challenge;
  }
  // Support limitations
  else if (/\b(phone|call|video|meet|in.?person)\b/.test(query)) {
    intent = "support_limitations";
    reply = KNOWLEDGE_BASE.support_limitations;
  }
  // Contact (but not "my email is..." — that's personal context)
  else if (
    /\b(contact|reach out|email.*support|support.*email|address|how.*reach)\b/.test(query) &&
    !/my email/i.test(query)
  ) {
    intent = "contact";
    reply = KNOWLEDGE_BASE.contact;
  }
  // Greeting
  else if (/^(hi|hello|hey|good morning|good evening)\b/.test(query.trim())) {
    intent = "greeting";
    reply =
      "Hi there! 👋 I'm the BookLeaf support assistant. I can help you with publishing timelines, royalties, ISBNs, book status, and author copies. What's on your mind today?";
    confidence = 98;
  }
  // Complaints / legal / sensitive
  else if (/\b(complaint|legal|lawyer|sue|harass|threat)\b/.test(query)) {
    intent = "complaint";
    reply =
      "I'm sorry to hear you're having this experience. For any complaints or sensitive issues, please email us directly at support@bookleafpub.com. One of our team members will get back to you within 24 hours.";
    confidence = 40;
  }
  // ── STRICT: Unmatched query → escalate (never hallucinate) ──
  else {
    intent = "unmatched";
    reply =
      "I'm not able to verify this request right now, so I've shared this with our support team. They'll review it and get back to you shortly. You can also reach us at support@bookleafpub.com.";
    confidence = 30;
    source = "none";
  }

  escalated = confidence < 80;

  await logQueryToSupabase(data.message, intent, activeEmail, reply, confidence, escalated);

  return { reply, confidence, escalated, intent, matchedEmail: activeEmail, source, authorFound };
}

// ─── Helpers ─────────────────────────────────────────────────────────
function normalizeSource(s: unknown): "database" | "knowledge_base" | "none" {
  const v = String(s ?? "none");
  if (v === "database" || v === "supabase_live") return "database";
  if (v === "knowledge_base") return "knowledge_base";
  return "none";
}

// ─── Exported server function ────────────────────────────────────────
export const sendChat = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    // 1. If message is ONLY an email or invalid single-word email, route directly to built-in KB to ensure correct verification & zero latency
    const trimmed = data.message.trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const isEmailOnly = emailRegex.test(trimmed);
    const hasAtButInvalid =
      trimmed.includes("@") && !isEmailOnly && trimmed.split(/\s+/).length === 1;

    if (isEmailOnly || hasAtButInvalid) {
      console.log(`[sendChat] Routing email-only / invalid metadata directly to built-in KB.`);
      return sendViaBuiltinKB(data);
    }

    // 2. Scan history to find if we already have a verified author email to preserve session
    let matchedEmail: string | null = null;
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    // Search history for a verified author
    for (const msg of data.history) {
      if (msg.role !== "user") continue;
      const matches = msg.content.match(emailRe) ?? [];
      for (const e of matches) {
        if (isValidAuthorEmail(e)) {
          const author = await lookupAuthor(e);
          if (author) {
            matchedEmail = e.toLowerCase();
            break;
          }
        }
      }
      if (matchedEmail) break;
    }

    const strategies: Array<{ name: string; fn: () => Promise<ChatResult> }> = [];
    if (process.env.N8N_WEBHOOK_URL || process.env.VITE_N8N_WEBHOOK_URL)
      strategies.push({
        name: "n8n-webhook",
        fn: () => sendViaN8nWebhook(data, matchedEmail),
      });
    if (process.env.N8N_MCP_BEARER_TOKEN)
      strategies.push({ name: "n8n-mcp", fn: () => sendViaN8nMcp(data, matchedEmail) });
    strategies.push({ name: "built-in-kb", fn: () => sendViaBuiltinKB(data) });

    let lastError: any;
    for (const { name, fn } of strategies) {
      try {
        console.log(`[sendChat] Trying ${name}...`);
        const result = await fn();

        // Add protection against empty or invalid responses
        if (result && result.reply && result.reply.trim().length > 0) {
          console.log(`[sendChat] ${name} succeeded (confidence: ${result.confidence}%)`);
          // Preserve matched email in result if not set
          if (!result.matchedEmail && matchedEmail) {
            result.matchedEmail = matchedEmail;
          }
          return result;
        } else {
          console.warn(`[sendChat] ${name} returned empty or invalid response payload.`);
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[sendChat] ${name} failed:`, err?.message ?? err);
      }
    }

    // Graceful fallback if everything fails
    const fallbackResponse =
      "I’m having trouble processing this request right now. Please try again in a moment.";
    await logQueryToSupabase(
      data.message,
      "error_fallback",
      matchedEmail,
      fallbackResponse,
      0,
      true,
    );

    return {
      reply: fallbackResponse,
      confidence: 0,
      escalated: true,
      intent: "error",
      matchedEmail,
      source: "none" as const,
      authorFound: !!matchedEmail,
    };
  });
