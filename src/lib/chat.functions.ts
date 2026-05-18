import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SYSTEM_PROMPT = `You are BookLeaf Publishing's customer support assistant. You help authors with questions about their book publishing journey.

You have access to an authors database with fields: email, book_title, final_submission_date, book_live_date, royalty_status, isbn, add_on_services, publishing_stage.

Guidelines:
- If the user shares their email, use the lookup_author tool to find their record before answering.
- Be friendly, concise, and specific. Quote dates/values directly from the record when available.
- For royalty payment questions: paid = already disbursed, pending = being processed, unpaid = not yet due.
- Publishing stages flow: Manuscript Review → In Production → Final Proofing → Published.
- If you cannot confidently answer (missing data, account-specific issue, complaint, refund, legal), set confidence low so we can escalate to a human.

After answering, ALWAYS call the record_response tool with:
- intent: short category (e.g. "royalty_status", "publishing_stage", "isbn_lookup", "submission_date", "general_info", "complaint", "other")
- confidence: 0.0-1.0 (use < 0.6 when you're not sure or it needs a human)
- matched_email: the email you looked up, or null`;

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
              confidence: { type: "number" },
              matched_email: { type: ["string", "null"] },
            },
            required: ["intent", "confidence", "matched_email"],
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
    let confidence = 0.5;
    let assistantText = "";

    // up to 4 tool-call rounds
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
          throw new Error("Rate limit exceeded. Please try again shortly.");
        if (res.status === 402)
          throw new Error("AI credits exhausted. Please add credits.");
        throw new Error(`AI gateway error: ${res.status}`);
      }

      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error("Empty AI response");

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
            toolResult = { found: true, author };
          } else {
            toolResult = { found: false };
          }
        } else if (name === "record_response") {
          intent = String(args.intent ?? "other");
          confidence = Number(args.confidence ?? 0.5);
          if (args.matched_email) matchedEmail = String(args.matched_email);
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

      // If record_response was called and we already have text, we can stop.
      if (assistantText && toolCalls.some((t: any) => t.function?.name === "record_response")) {
        break;
      }
    }

    if (!assistantText) {
      assistantText =
        "I'm not sure how to help with that — let me hand you off to a human teammate.";
      confidence = 0.2;
    }

    const escalated = confidence < 0.6;

    await supabaseAdmin.from("query_logs").insert({
      user_query: data.message,
      detected_intent: intent,
      matched_email: matchedEmail,
      bot_response: assistantText,
      confidence_score: confidence,
      escalated,
    });

    return {
      reply: assistantText,
      confidence,
      escalated,
      intent,
      matchedEmail,
    };
  });
