import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SYSTEM_PROMPT = `You are BookLeaf Publishing's customer support assistant. You help authors with their publishing journey.

You can answer two kinds of questions:

1) ACCOUNT-SPECIFIC questions — require the author's email. Use the lookup_author tool to fetch their record from the authors database (fields: email, book_title, final_submission_date, book_live_date, royalty_status, isbn, add_on_services, publishing_stage). If the user asks about their royalty / ISBN / book live date / add-ons but hasn't shared their email, politely ask for it first.

2) GENERAL KNOWLEDGE-BASE questions — answer directly from the knowledge below; no lookup needed.

KNOWLEDGE BASE:
- Publishing timeline: Manuscript Review (1–2 weeks) → In Production (3–4 weeks: editing, typesetting, cover design) → Final Proofing (1 week with author) → Published (live on Amazon, Flipkart and bookleafpub.com within 7 days).
- Royalty process: Royalties are calculated monthly and disbursed by the 28th of the following month via bank transfer. Status meanings — paid: already disbursed; pending: being processed this cycle; unpaid: not yet due.
- ISBN: BookLeaf assigns a free ISBN during the In Production stage. It appears on the back cover and on all retailer listings.
- Author copies: Every author receives 2 complimentary paperback copies once the book is Published. Additional copies can be ordered at author price via the dashboard.
- Add-on services: Editing, premium cover design, marketing pack, audiobook production, translation. Available to add until the book enters Final Proofing.

Style:
- Be friendly, concise (2–4 sentences), and specific. Quote dates and values directly from the record when available.
- If you cannot confidently answer (missing data, account-specific dispute, complaint, refund, legal, anything outside the knowledge base), keep your reply short and set confidence below 80 so we escalate to a human.

After EVERY reply you MUST call the record_response tool exactly once with:
- intent: short category (e.g. "royalty_status", "publishing_stage", "isbn_lookup", "submission_date", "author_copies", "add_on_services", "general_info", "complaint", "other")
- confidence: integer 0–100 (use < 80 when unsure or when it needs a human)
- matched_email: the email you looked up, or null
- source: "database" if the answer used author record data, "knowledge_base" if it came from the knowledge above, "none" if neither.`;

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(20)
    .default([]),
});

export const sendChat = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const tools = [
      {
        type: "function",
        function: {
          name: "lookup_author",
          description: "Look up an author record by email address.",
          parameters: {
            type: "object",
            properties: { email: { type: "string" } },
            required: ["email"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "record_response",
          description:
            "Record metadata about your final answer. Call this exactly once after producing your reply.",
          parameters: {
            type: "object",
            properties: {
              intent: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 100 },
              matched_email: { type: ["string", "null"] },
              source: { type: "string", enum: ["database", "knowledge_base", "none"] },
            },
            required: ["intent", "confidence", "matched_email", "source"],
            additionalProperties: false,
          },
        },
      },
    ];

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...data.history,
      { role: "user", content: data.message },
    ];

    let matchedEmail: string | null = null;
    let intent = "other";
    let confidence = 50;
    let source: "database" | "knowledge_base" | "none" = "none";
    let assistantText = "";
    let authorFoundThisTurn = false;

    try {
      for (let i = 0; i < 4; i++) {
        const res = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages,
              tools,
            }),
          },
        );

        if (!res.ok) {
          if (res.status === 429)
            throw new Error("RATE_LIMIT");
          if (res.status === 402)
            throw new Error("CREDITS");
          throw new Error(`GATEWAY_${res.status}`);
        }

        const json = await res.json();
        const msg = json.choices?.[0]?.message;
        if (!msg) throw new Error("EMPTY");

        messages.push(msg);

        const toolCalls = msg.tool_calls ?? [];
        if (toolCalls.length === 0) {
          assistantText = msg.content ?? "";
          break;
        }

        for (const tc of toolCalls) {
          const name = tc.function?.name;
          let args: any = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? "{}");
          } catch {}

          let toolResult: any = {};
          if (name === "lookup_author") {
            const email = String(args.email ?? "").toLowerCase().trim();
            const { data: author } = await supabaseAdmin
              .from("authors")
              .select("*")
              .ilike("email", email)
              .maybeSingle();
            if (author) {
              matchedEmail = author.email;
              authorFoundThisTurn = true;
              toolResult = { found: true, author };
            } else {
              toolResult = {
                found: false,
                note: "No author with that email exists. Apologise briefly, ask the user to double-check the email, and set confidence below 80.",
              };
            }
          } else if (name === "record_response") {
            intent = String(args.intent ?? "other");
            // accept either 0-1 or 0-100; normalise to 0-100
            const raw = Number(args.confidence ?? 50);
            confidence = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
            if (args.matched_email) matchedEmail = String(args.matched_email);
            const s = String(args.source ?? "none");
            source = s === "database" || s === "knowledge_base" ? s : "none";
            toolResult = { ok: true };
            if (msg.content) assistantText = msg.content;
          } else {
            toolResult = { error: "unknown tool" };
          }

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }

        if (
          assistantText &&
          toolCalls.some((t: any) => t.function?.name === "record_response")
        ) {
          break;
        }
      }
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "RATE_LIMIT") {
        assistantText =
          "We're getting a lot of questions right now — please try again in a moment. Meanwhile, I've flagged this for a human teammate.";
      } else if (code === "CREDITS") {
        assistantText =
          "Our assistant is temporarily unavailable. Your message has been forwarded to a human support agent.";
      } else {
        assistantText =
          "Something went wrong on our side. Your request has been escalated to a human support agent.";
      }
      confidence = 0;
    }

    if (!assistantText.trim()) {
      assistantText =
        "I couldn't find a confident answer for that. Your request has been escalated to a human support agent.";
      confidence = Math.min(confidence, 40);
    }

    // Confidence below 80 ⇒ escalate per assignment spec.
    const escalated = confidence < 80;

    // Best-effort logging — never break the response if logging fails.
    try {
      await supabaseAdmin.from("query_logs").insert({
        user_query: data.message,
        detected_intent: intent,
        matched_email: matchedEmail,
        bot_response: assistantText,
        confidence_score: confidence,
        escalated,
      });
    } catch (logErr) {
      console.error("query_logs insert failed:", logErr);
    }

    return {
      reply: assistantText,
      confidence,
      escalated,
      intent,
      matchedEmail,
      source,
      authorFound: authorFoundThisTurn,
    };
  });
