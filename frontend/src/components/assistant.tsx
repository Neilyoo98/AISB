"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, MessageCircle, ShieldAlert, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import { ToolIcon } from "@/lib/tool-icons";

type ToolCard = { id: string; name: string; line: string; price: number; category: string; url: string };
type Msg = { role: "user" | "assistant"; content: string; tools?: ToolCard[]; followUps?: string[]; template?: boolean };
type Reply = { answer: string; tools: ToolCard[]; follow_ups: string[]; mode: "ai" | "template"; page: string };

const EASE = [0.23, 1, 0.32, 1] as const;
const HIDDEN = [/^\/$/, /^\/login/, /^\/join/];

const PAGES: [string, string, string[]][] = [
  ["/dashboard", "Dashboard", ["What should I do this week?", "How much will this save me?", "Which task should I start with?"]],
  ["/war-room", "War Room", ["What are these advisors doing?", "Why was this tool recommended?", "What happens when I approve?"]],
  ["/agents", "Agents", ["How are these agents linked?", "What does the message log mean?", "How do my tools work together?"]],
  ["/tools/", "Tool details", ["Is this tool right for me?", "What does Trust & risk mean?", "How long does setup take?"]],
  ["/tools", "Discover", ["Which tool answers my phone?", "What's a cheap way to get more reviews?", "How do I compare tools?"]],
  ["/compare", "Compare", ["Which of these should I pick?", "What does the overall score mean?", "Why is total cost higher than the price?"]],
  ["/team", "Collaboration", ["How do I add an employee?", "How do tool requests work?", "What is the spend cap?"]],
  ["/profile", "Profile", ["What happens when I save?", "Which details matter most?", "Should I re-run the analysis?"]],
  ["/onboard", "Describe your business", ["What should I write here?", "What happens after I submit?", "Is my information private?"]],
];

function pageInfo(path: string): { name: string; starters: string[] } {
  const hit = PAGES.find(([p]) => path.startsWith(p));
  return hit ? { name: hit[1], starters: hit[2] } : { name: "StackSmith", starters: ["What can StackSmith do for me?", "Where do I start?", "How do I adopt a tool?"] };
}

/** Floating, page-aware helper. Reads what's on screen (never passwords) and answers in plain language. */
export function Assistant() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const identity = useRef<string | null | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hidden = HIDDEN.some((r) => r.test(pathname));
  const page = pageInfo(pathname);

  // Conversation is cleared when the user logs out (lands on / or /login) or a different account signs in.
  useEffect(() => {
    if (hidden) {
      setMsgs([]);
      setOpen(false);
      identity.current = undefined;
    }
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        const id = m?.user?.id ?? null;
        if (identity.current !== undefined && identity.current !== id) setMsgs([]);
        identity.current = id;
      })
      .catch(() => {});
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const send = async (text: string) => {
    const q = text.trim().slice(0, 500);
    if (!q || busy) return;
    setErr(null);
    setInput("");
    const history = msgs.slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 900) }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    const main = document.querySelector("main") as HTMLElement | null;
    const context = { path: pathname, page_title: document.title, visible_text: (main?.innerText || "").replace(/\s+\n/g, "\n").slice(0, 2500) };
    try {
      const r = await api<Reply>("/assistant/chat", { method: "POST", json: { message: q, history, context } });
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, tools: r.tools, followUps: r.follow_ups, template: r.mode === "template" }]);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  if (hidden) return null;

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            ref={buttonRef}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={() => setOpen(true)}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-stone-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            aria-haspopup="dialog"
          >
            <MessageCircle size={18} /> Ask StackSmith
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Ask StackSmith"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed inset-x-3 bottom-3 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:w-[400px]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-3">
              <div>
                <div className="font-semibold">Ask StackSmith</div>
                <div className="text-xs text-stone-500" aria-live="polite">
                  Looking at: <span className="font-medium text-stone-700">{page.name}</span>
                </div>
              </div>
              <button onClick={close} className="btn-ghost px-2 py-1.5" aria-label="Close helper">
                <X size={18} />
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
              {msgs.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-stone-600">I can explain this page, answer questions about your plan, and suggest tools from the verified catalog.</p>
                  <div className="flex flex-col items-start gap-1.5">
                    {page.starters.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-left text-sm text-stone-800 hover:border-stone-400">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-sm text-white">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="mr-4 space-y-2">
                    <div className="whitespace-pre-line rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2.5 text-sm leading-relaxed text-stone-900">{m.content}</div>
                    {m.template && <div className="text-[11px] text-stone-400">Built-in answer</div>}
                    {m.tools?.map((t) => (
                      <Link key={t.id} href={`/tools/${t.id}`} className="flex items-center gap-3 rounded-xl border border-stone-200 p-2.5 hover:border-emerald-300">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                          <ToolIcon category={t.category} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{t.name}</span>
                          <span className="block truncate text-xs text-stone-500">{t.line}</span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-stone-600">{t.price === 0 ? "Free" : `${money(t.price)}/mo`}</span>
                      </Link>
                    ))}
                    {i === msgs.length - 1 && !!m.followUps?.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.followUps.map((f) => (
                          <button key={f} onClick={() => send(f)} className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-700 hover:border-stone-400">
                            {f}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
              {busy && (
                <div className="flex gap-1 px-1" aria-label="Thinking">
                  {[0, 1, 2].map((k) => (
                    <span key={k} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${k * 120}ms` }} />
                  ))}
                </div>
              )}
              {err && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  {err}
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-stone-100 p-3"
            >
              <div className="flex items-end gap-2">
                <label htmlFor="assistant-input" className="sr-only">
                  Your question
                </label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  rows={1}
                  maxLength={500}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder={`Ask about ${page.name === "StackSmith" ? "StackSmith" : `the ${page.name} page`}…`}
                  className="input max-h-28 min-h-[42px] resize-none"
                />
                <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-[42px] w-[42px] shrink-0 p-0" aria-label="Send">
                  <ArrowUp size={18} />
                </button>
              </div>
              <p className={cn("mt-1.5 flex items-center gap-1 text-[11px] text-stone-400")}>
                <ShieldAlert size={11} /> Don&apos;t share passwords or card numbers.
              </p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
