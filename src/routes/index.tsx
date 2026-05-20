import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Send, UserRound, Bot, AlertTriangle } from "lucide-react";
import { sendChat } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "BookLeaf Publishing — Author Support" },
      {
        name: "description",
        content:
          "Chat with BookLeaf Publishing's author support assistant for help with royalties, publishing stages, ISBNs and more.",
      },
    ],
  }),
});

type Msg = {
  role: "user" | "assistant";
  content: string;
  confidence?: number;
  escalated?: boolean;
  timestamp: number;
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChatPage() {
  const send = useServerFn(sendChat);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm BookLeaf's author support assistant. Please share your registered email and ask me about royalties, your book's status, ISBNs, author copies, or submission dates. You can also ask any general publishing questions.",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    let id = localStorage.getItem("bookleaf_chat_session_id");
    if (!id) {
      id = "session-" + Math.random().toString(36).substring(2, 15) + "-" + Date.now();
      localStorage.setItem("bookleaf_chat_session_id", id);
    }
    setSessionId(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text, timestamp: Date.now() }];
    setMessages(next);
    setLoading(true);

    // 25s safety timeout — n8n / AI gateway sometimes hang
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const res = await send({
        data: {
          message: text,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          sessionId: sessionId,
        },
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.reply,
          confidence: res.confidence,
          escalated: res.escalated,
          timestamp: Date.now(),
        },
      ]);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: isAbort
            ? "That took a bit longer than expected. I've shared your request with our support team so they can look into it."
            : "I'm not able to connect to the assistant right now. I've shared your request with our support team and they'll get back to you.",
          confidence: 0,
          escalated: true,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">BookLeaf Publishing</h1>
            <p className="text-xs text-muted-foreground">Author Support</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-3 sm:px-4">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4 sm:py-6">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {loading && (
            <div className="flex items-start gap-3">
              <Avatar role="assistant" />
              <div className="rounded-2xl rounded-tl-sm bg-background px-4 py-3 shadow-sm">
                <div className="flex items-center gap-1" aria-label="Assistant is typing">
                  <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
                </div>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="sticky bottom-0 border-t bg-background/95 py-3 sm:py-4 backdrop-blur"
        >
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your book, royalties, ISBN…"
              disabled={loading}
              autoFocus
              aria-label="Type your message"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            If I can't answer your question, our support team will step in to help.
          </p>
        </form>
      </main>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar role={msg.role} />
      <div
        className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[80%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm bg-background text-foreground"
          }`}
        >
          {msg.content}
        </div>
        <div
          className={`flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground ${
            isUser ? "flex-row-reverse" : ""
          }`}
        >
          <span>{formatTime(msg.timestamp)}</span>
          {msg.escalated && (
            <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px] shrink-0">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Escalated to Human
            </Badge>
          )}
          {!isUser &&
            typeof msg.confidence === "number" &&
            msg.confidence > 0 &&
            !msg.escalated && (
              <span className="text-muted-foreground/70 shrink-0">
                {msg.confidence}% confidence
              </span>
            )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  const isUser = role === "user";
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        isUser ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground"
      }`}
    >
      {isUser ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
    </div>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60"
      style={{ animationDelay: delay }}
    />
  );
}
