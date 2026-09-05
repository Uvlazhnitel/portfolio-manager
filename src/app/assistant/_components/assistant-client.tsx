"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, Bot, ChevronRight, LoaderCircle, MessageSquarePlus, RotateCcw, Send, Settings, Sparkles, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AssistantPageModel } from "@/features/assistant/read-model";
import { cn } from "@/lib/utils";

const suggestions = [
  "What changed since yesterday?",
  "What should I do with my next $1,000?",
  "What happens if I buy $500 of BTC?",
  "Where is my biggest portfolio risk?",
];

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  status: "PENDING" | "COMPLETED" | "FAILED";
  content: string;
  retryable?: boolean;
};

export function AssistantClient({ model }: { model: AssistantPageModel }) {
  if (!model.isConfigured) return <SetupState model={model.model} />;
  return <ConfiguredChat model={model} />;
}

function ConfiguredChat({ model }: { model: AssistantPageModel }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(model.selectedConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(model.messages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, toolStatus]);

  async function sendMessage(text = draft, retryMessageId: string | null = null) {
    const message = text.trim();
    if (!message || isSending) return;
    const userId = retryMessageId ?? `user-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;
    let activeUserId = userId;
    let persisted = retryMessageId !== null;
    setMessages((current) => retryMessageId
      ? [...current.map((item) => item.id === retryMessageId ? { ...item, status: "PENDING" as const, retryable: false } : item), { id: assistantId, role: "ASSISTANT", content: "", status: "PENDING" }]
      : [...current, { id: userId, role: "USER", content: message, status: "PENDING" }, { id: assistantId, role: "ASSISTANT", content: "", status: "PENDING" }]);
    if (!retryMessageId) setDraft("");
    setError(""); setToolStatus("Reviewing your portfolio…"); setIsSending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, retryMessageId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Assistant request failed.");
      }
      if (!response.body) throw new Error("Assistant stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "conversation") {
            persisted = true;
            const previousUserId = activeUserId;
            activeUserId = event.userMessageId;
            setConversationId(event.conversationId);
            setMessages((current) => current.map((item) => item.id === previousUserId ? { ...item, id: event.userMessageId } : item));
            window.history.replaceState(null, "", `/assistant?conversation=${encodeURIComponent(event.conversationId)}`);
          }
          if (event.type === "tool") setToolStatus(toolLabel(event.name));
          if (event.type === "delta") {
            setToolStatus("");
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.text } : item));
          }
          if (event.type === "error") streamError = event.message;
        }
        if (done) break;
      }
      if (streamError) throw new Error(streamError);
      setMessages((current) => current.map((item) => item.id === assistantId || item.id === activeUserId
        ? { ...item, status: "COMPLETED", retryable: false }
        : item));
      router.refresh();
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Assistant request failed.";
      setError(messageText);
      setMessages((current) => current
        .filter((item) => item.id !== assistantId && (persisted || item.id !== activeUserId))
        .map((item) => item.id === activeUserId ? { ...item, status: "FAILED", retryable: true } : item));
      if (!retryMessageId && !persisted) setDraft(message);
    } finally {
      setIsSending(false); setToolStatus("");
    }
  }

  function startNewChat() {
    if (isSending) return;
    setConversationId(null); setMessages([]); setDraft(""); setError(""); setToolStatus("");
    router.push("/assistant?new=1");
  }

  async function deleteConversation(id: string) {
    if (isSending || deletingId || !window.confirm("Delete this conversation and all of its messages?")) return;
    setDeletingId(id); setError("");
    try {
      const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Conversation could not be deleted.");
      }
      if (id === conversationId) {
        setConversationId(null); setMessages([]); setDraft("");
        router.replace("/assistant?new=1");
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversation could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }

  return (
    <div className="grid min-h-0 gap-4 xl:min-h-[calc(100dvh-12rem)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="hidden h-fit xl:block">
        <button type="button" onClick={startNewChat} disabled={isSending} className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:opacity-50"><MessageSquarePlus className="mr-2 h-4 w-4" />New chat</button>
        <ConversationList conversations={model.conversations} selectedId={conversationId} deletingId={deletingId} disabled={isSending} onDelete={(id) => void deleteConversation(id)} />
      </Card>

      <div className="flex h-[calc(100dvh-12rem-env(safe-area-inset-bottom))] min-h-96 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm shadow-black/10 md:h-auto md:min-h-[70vh]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Bot className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">Portfolio Assistant</p><p className="text-xs text-muted">Grounded in current portfolio data</p></div></div>
          <button type="button" onClick={startNewChat} disabled={isSending} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-xs text-muted hover:text-foreground disabled:opacity-50 xl:hidden"><MessageSquarePlus className="mr-2 h-4 w-4" />New</button>
        </div>

        {model.conversations.length > 0 ? <div className="flex gap-2 border-b border-border p-3 xl:hidden"><select value={conversationId ?? ""} onChange={(event) => { if (event.target.value) router.push(`/assistant?conversation=${encodeURIComponent(event.target.value)}`); }} className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"><option value="" disabled>New conversation</option>{model.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select>{conversationId ? <Button type="button" variant="ghost" onClick={() => void deleteConversation(conversationId)} disabled={isSending || deletingId !== null} className="h-11 w-11 shrink-0 px-0" aria-label="Delete current conversation">{deletingId === conversationId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button> : null}</div> : null}

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 ? <Welcome onSuggestion={(suggestion) => void sendMessage(suggestion)} /> : <div className="mx-auto max-w-3xl space-y-5">{messages.map((message) => <MessageBubble key={message.id} message={message} isSending={isSending} onRetry={(item) => void sendMessage(item.content, item.id)} />)}{toolStatus ? <ToolStatus text={toolStatus} /> : null}{error ? <ErrorNotice message={error} /> : null}<div ref={endRef} /></div>}
        </div>

        <div className="border-t border-border bg-card p-3 sm:p-4">
          <div className="mx-auto max-w-3xl"><div className="flex min-w-0 items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-primary/60"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} disabled={isSending} rows={1} maxLength={4000} placeholder="Ask about your portfolio or test an investment idea…" className="max-h-36 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted" /><Button type="button" onClick={() => void sendMessage()} disabled={isSending || !draft.trim()} className="h-11 w-11 shrink-0 px-0" aria-label="Send message">{isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div><p className="mt-2 text-center text-[11px] text-muted">Decision support, not guaranteed investment outcomes.</p></div>
        </div>
      </div>
    </div>
  );
}

function SetupState({ model }: { model: string }) {
  return <Card className="mx-auto max-w-2xl border-primary/25 bg-gradient-to-br from-card to-primary/5"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary"><Settings className="h-6 w-6" /></div><h2 className="mt-5 text-xl font-semibold">Configure the Assistant</h2><p className="mt-2 text-sm leading-6 text-muted">The portfolio remains fully available, but AI chat needs an OpenAI API key.</p><div className="mt-5 rounded-lg border border-border bg-surface p-4 text-sm"><p className="font-medium text-foreground">Current model</p><p className="mt-2 font-mono text-muted">{model}</p></div><p className="mt-4 text-xs leading-5 text-muted">Add the key in Settings. It is encrypted server-side and never returned to the browser.</p><Link href="/settings" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90">Open Settings</Link><Badge className="ml-3 mt-5">Assistant unavailable · portfolio tools unaffected</Badge></Card>;
}

function ConversationList({ conversations, selectedId, deletingId, disabled, onDelete }: { conversations: AssistantPageModel["conversations"]; selectedId: string | null; deletingId: string | null; disabled: boolean; onDelete: (id: string) => void }) { return <div className="mt-5 space-y-1"><p className="mb-2 px-2 text-xs uppercase tracking-wide text-muted">Recent conversations</p>{conversations.length ? conversations.map((conversation) => <div key={conversation.id} className={cn("group flex items-center rounded-lg", conversation.id === selectedId ? "bg-primary/12 text-foreground" : "text-muted hover:bg-surface hover:text-foreground")}><Link href={`/assistant?conversation=${encodeURIComponent(conversation.id)}`} className="min-w-0 flex-1 px-3 py-2.5 text-sm"><p className="truncate">{conversation.title}</p><p className="mt-1 text-[11px] text-muted">{conversation.messageCount} messages</p></Link><button type="button" onClick={() => onDelete(conversation.id)} disabled={disabled || deletingId !== null} className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted opacity-70 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 xl:opacity-0 xl:group-hover:opacity-100 xl:focus-visible:opacity-100" aria-label={`Delete ${conversation.title}`}>{deletingId === conversation.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div>) : <p className="px-2 py-4 text-xs text-muted">No conversations yet.</p>}</div>; }
function Welcome({ onSuggestion }: { onSuggestion: (suggestion: string) => void }) { return <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-10 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Sparkles className="h-7 w-7" /></span><h2 className="mt-5 text-xl font-semibold">What would you like to understand?</h2><p className="mt-2 max-w-lg text-sm leading-6 text-muted">Ask about strategy alignment, contribution planning, portfolio risks, or simulate a transaction.</p><div className="mt-7 grid w-full gap-2 sm:grid-cols-2">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => onSuggestion(suggestion)} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-left text-sm hover:border-primary/40"><span>{suggestion}</span><ChevronRight className="h-4 w-4 shrink-0 text-primary" /></button>)}</div></div>; }
function MessageBubble({ message, isSending, onRetry }: { message: ChatMessage; isSending: boolean; onRetry: (message: ChatMessage) => void }) { const assistant = message.role === "ASSISTANT"; return <div className={cn("flex min-w-0 gap-2 sm:gap-3", !assistant && "flex-row-reverse")}><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", assistant ? "bg-primary/15 text-primary" : "bg-surface-strong text-muted")}>{assistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}</span><div className="min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-[85%]"><div className={cn("[overflow-wrap:anywhere] rounded-xl px-3 py-3 text-sm leading-6 whitespace-pre-wrap sm:px-4", assistant ? "border border-border bg-surface" : message.status === "FAILED" ? "border border-destructive/30 bg-destructive/10 text-foreground" : "bg-primary text-white")}>{message.content || (message.status === "PENDING" ? <span className="inline-flex items-center gap-2 text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Thinking…</span> : null)}</div>{!assistant && message.status !== "COMPLETED" ? <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted"><span>{message.status === "FAILED" ? "Response failed" : "Sending…"}</span>{message.retryable ? <button type="button" onClick={() => onRetry(message)} disabled={isSending} className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 disabled:opacity-50"><RotateCcw className="h-3 w-3" />Retry</button> : null}</div> : null}</div></div>; }
function ToolStatus({ text }: { text: string }) { return <div className="flex items-center gap-2 pl-11 text-xs text-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />{text}</div>; }
function ErrorNotice({ message }: { message: string }) { return <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p>{message}</p><p className="mt-1 text-xs opacity-80">Your message remains in the draft so you can try again.</p></div></div>; }
function toolLabel(name: string) {
  if (name === "simulate_scenario") return "Running the deterministic scenario…";
  if (name === "explain_contribution_plan") return "Running the contribution planner…";
  if (name === "get_daily_brief") return "Reading the portfolio review…";
  if (name === "get_risk_snapshot") return "Reading the risk snapshot…";
  if (name === "get_performance_summary") return "Reading performance calculations…";
  if (name === "get_strategy") return "Reading your strategy…";
  return "Reviewing portfolio calculations…";
}

type StreamEvent =
  | { type: "conversation"; conversationId: string; userMessageId: string }
  | { type: "tool"; name: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
