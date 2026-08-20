"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  role: "OWNER" | "TRADER";
  content: string;
  actions: Array<{ label: string; href: string }>;
  proactive: boolean;
  created_at: string;
};

export function TraderAssistant() {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [aiAvailable, setAiAvailable] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/trader", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setMessages(payload.messages ?? []);
    setAiAvailable(Boolean(payload.aiAvailable));
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/trader", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "MESSAGE", message }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setInput("");
      await load();
    } catch {
      setError("Trader could not load verified system context.");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={`trader-assistant ${open ? "open" : ""}`}>
      {open && (
        <section className="trader-panel" aria-label="Trader assistant">
          <header>
            <div>
              <b>TRADER</b>
              <small>
                {aiAvailable
                  ? "AI + VERIFIED SYSTEM DATA"
                  : "AI UNAVAILABLE · DETERMINISTIC DATA"}
              </small>
            </div>
            <button aria-label="Close Trader" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="trader-safety">
            READ-ONLY · PAPER DATA · LIVE LOCKED · NO CHAT ORDER EXECUTION
          </div>
          <div className="trader-messages" aria-live="polite">
            {!messages.length && (
              <p className="trader-empty">
                Ask about Portfolio, risk, Auto Trader, Big Money, strategies,
                or system health.
              </p>
            )}
            {messages.map((message) => (
              <article className={message.role.toLowerCase()} key={message.id}>
                <b>{message.role === "TRADER" ? "Trader" : "You"}</b>
                <p>{message.content}</p>
                {message.actions?.length > 0 && (
                  <div className="trader-actions">
                    {message.actions.map((action) => (
                      <a key={action.href} href={action.href}>
                        {action.label}
                      </a>
                    ))}
                  </div>
                )}
                {message.proactive && <small>PROACTIVE · VERIFIED EVENT</small>}
              </article>
            ))}
          </div>
          {error && <div className="broker-error">{error}</div>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Trader about verified PAPER state…"
              maxLength={2000}
            />
            <button disabled={sending || !input.trim()}>
              {sending ? "…" : "SEND"}
            </button>
          </form>
        </section>
      )}
      <button
        className="trader-launcher"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        TRADER
        {messages.some((message) => message.proactive) && (
          <span aria-label="Proactive Trader messages available" />
        )}
      </button>
    </div>
  );
}
