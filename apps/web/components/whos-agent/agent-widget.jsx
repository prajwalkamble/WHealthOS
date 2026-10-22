"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  ExternalLink,
  MessageSquarePlus,
  RotateCcw,
  SendHorizonal,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import AnswerText from "./answer-text";
import WhosMark from "./whos-mark";
import { useAgentChat } from "./use-agent-chat";

// WHOS's entry point and its panel.
//
// Why a panel on the shell rather than a page at /agent
// -----------------------------------------------------
// Two things decided it. The comment in components/feedback-widget.jsx leaves
// the bottom of the viewport clear "so an assistant button can live below it
// later", which is the pattern this app already chose for a shell-level
// control -- a second competing floating button is exactly what the brief
// warns against, and this is the same rail. And a question about money is
// nearly always asked while looking at it: a panel keeps the dashboard,
// budget or analytics screen behind it, where a route change would replace
// the thing being asked about.
//
// The cost of that choice: the conversation lives in this component, so it
// ends when the tab is closed, and there is no shareable URL for a
// conversation. Both are recorded as limitations rather than hidden.

// The launcher floats clear of both edges rather than being docked to the
// right one, and the panel is anchored to the same corner so it grows out of
// where the button was.
//
// Measured against the feedback tab, which is docked at right-0 bottom-28
// (7rem) and is about 2.75rem tall. The button is 3.5rem tall sitting 1.5rem
// up, so it occupies 1.5rem to 5rem and leaves a 2rem gap below that tab.
// These are the only two fixed controls on the shell and they must not
// collide at any viewport size.
const ANCHOR = "bottom-6 right-5";

// Offered on the empty panel. Deliberately generic: each one is a question,
// not a finding. Nothing here states a figure, because a welcome screen that
// printed a balance would be printing it before anything had been read.
const SUGGESTIONS = [
  "Analyse my spending this month",
  "Summarise my financial position",
  "Review my budgets",
  "Which categories increased the most?",
  "How much could I save or invest each month?",
];

const timeOf = (iso) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
};

// Copy, with the confirmation that makes it obvious it worked.
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission refused, or an insecure origin. The button
      // simply does not confirm; inventing a success would be a lie.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Answer copied" : "Copy answer"}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
};

// What an answer was based on. Stated from the server's own account of what it
// read, not from the answer's wording.
const Provenance = ({ meta }) => {
  if (!meta) return null;

  const at = timeOf(meta.dataReadAt);

  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
      <Database className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {meta.usedRecords ? (
          <>
            Read from your own records{meta.period ? ` for ${meta.period}` : ""}
            {at ? ` at ${at}` : ""}. Figures are calculated by WHealthOS, not by
            the AI.
          </>
        ) : (
          <>General answer. None of your financial records were used.</>
        )}
      </span>
    </p>
  );
};

const Unverified = () => (
  <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
    <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
    <span>
      WHOS cannot check live information in this deployment, so anything
      time-sensitive here is unverified. Check an official source for a current
      figure.
    </span>
  </p>
);

const Citations = ({ citations }) => {
  if (!citations?.length) return null;
  return (
    <div className="space-y-1 border-t pt-2">
      <p className="text-[11px] font-medium text-muted-foreground">Sources</p>
      <ul className="space-y-0.5">
        {citations.map((source) => (
          <li key={source.uri}>
            <a
              href={source.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="break-all">{source.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Thinking = () => (
  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
    <span className="flex gap-1" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none"
        />
      ))}
    </span>
    Reading your records…
  </span>
);

const Bubble = ({ message, onRetry, streaming }) => {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </li>
    );
  }

  const waiting = message.pending && !message.content && !message.error;

  return (
    <li className="space-y-1.5">
      <div className="max-w-full space-y-2 rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2">
        {waiting ? (
          <Thinking />
        ) : (
          <>
            {message.meta?.liveInfoUnavailable && <Unverified />}
            {message.content && <AnswerText text={message.content} />}
            {message.stopped && message.content && (
              <p className="text-[11px] text-muted-foreground">Stopped.</p>
            )}
            {message.note && (
              <p className="text-[11px] text-muted-foreground">{message.note}</p>
            )}
            <Citations citations={message.citations} />
            {message.error && (
              <div className="space-y-2">
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{message.error}</span>
                </p>
                {message.retryable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRetry}
                    disabled={streaming}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Try again
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Only under an answer. "Read from your own records" beneath a failed
          turn is true and useless: there is no answer for it to describe. */}
      {message.content ? (
        <div className="flex items-center gap-2 px-1">
          <Provenance meta={message.meta} />
          {!message.pending && <CopyButton text={message.content} />}
        </div>
      ) : null}
    </li>
  );
};

const AgentPanel = ({ onClose, panelRef }) => {
  const { messages, streaming, ask, retry, stop, reset } = useAgentChat();
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const scroller = useRef(null);
  const endRef = useRef(null);

  // Follows the answer as it streams, but only while the person is already at
  // the bottom: scrolling up to re-read something must not be yanked back.
  const pinned = useRef(true);
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  };

  useLayoutEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = (event) => {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || streaming) return;
    ask(question);
    setDraft("");
    // Height is set inline by the autosize below, so it is cleared the same way.
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const onKeyDown = (event) => {
    // Enter sends, Shift+Enter is a newline. A composition in progress (an IME
    // choosing a candidate) uses Enter for itself and must not send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  // Grows with the text to a ceiling, rather than scrolling a two-line box.
  const autosize = (element) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  };

  const askSuggestion = useCallback(
    (text) => {
      ask(text);
      inputRef.current?.focus();
    },
    [ask]
  );

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="WHOS - Financial Intelligence"
      tabIndex={-1}
      className={cn(
        // 26rem, but never wider than the screen less the gutter on both
        // sides. The underscores are Tailwind's spelling for the spaces in
        // `calc(100vw - 2.5rem)`; it normalises the unspaced form too, but
        // this is the spelling the documentation uses and the one that says
        // what it means.
        "fixed z-[70] flex w-[26rem] max-w-[calc(100vw_-_2.5rem)] flex-col",
        ANCHOR,
        "max-h-[min(38rem,80vh)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl",
        "origin-bottom-right animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200",
        "motion-reduce:animate-none focus-visible:outline-none"
      )}
    >
      <div className="flex items-start gap-2 border-b px-4 py-3">
        {/* The mark identifies the panel; the name beside it is the label,
            so the symbol itself is decoration here and stays unannounced. */}
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <WhosMark className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">WHOS - Financial Intelligence</p>
          {/* The product name wraps to two lines on a phone, and a strapline
              under it takes two more. Hidden below sm, where the header is
              competing for the same space as the conversation. */}
          <p className="hidden text-xs text-muted-foreground sm:block">
            Asks your records, explains the answer
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              reset();
              setDraft("");
              inputRef.current?.focus();
            }}
            aria-label="Start a new conversation"
            title="New conversation"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close WHOS - Financial Intelligence"
          className="-mr-1 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask about money you have already recorded in WHealthOS, or about a
              financial idea you want explained. Every figure is calculated by
              the app — the assistant explains it, it does not work it out.
            </p>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Try one of these
              </p>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => askSuggestion(suggestion)}
                  className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Answers can be wrong, and WHOS is not financial advice. It
              cannot change anything in your account. This conversation is not
              saved and ends when you close the tab.
            </p>
          </div>
        ) : (
          // role="log" with a polite live region: a screen reader hears each
          // answer once it settles, instead of every streamed fragment.
          <ul role="log" aria-live="polite" aria-atomic="false" className="space-y-4">
            {messages.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                onRetry={retry}
                streaming={streaming}
              />
            ))}
            <li ref={endRef} aria-hidden="true" />
          </ul>
        )}
      </div>

      <form onSubmit={submit} className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              autosize(event.target);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about your finances…"
            aria-label="Your question for WHOS"
            aria-describedby="agent-input-hint"
            maxLength={1000}
            className="min-h-9 resize-none py-2"
          />

          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={stop}
              aria-label="Stop generating"
              className="h-9 w-9 shrink-0"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim()}
              aria-label="Send question"
              className="h-9 w-9 shrink-0"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p id="agent-input-hint" className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {streaming
            ? "Stopping hides the rest of the answer; it does not undo the request."
            : "Enter to send, Shift+Enter for a new line."}
        </p>
      </form>
    </div>
  );
};

const AgentWidget = () => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const tabRef = useRef(null);

  // Fixed to the viewport with no server-rendered equivalent, so it waits for
  // mount rather than risking a hydration mismatch -- the same reason the
  // feedback widget does.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes, and a press outside closes. The tab is excluded from
  // "outside" so its own click does not close and immediately reopen.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (tabRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  // Focus into the panel on open and back to the tab on close. wasOpen guards
  // the first run, which would otherwise pull focus on every page load.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) panelRef.current?.focus();
    else if (wasOpen.current) tabRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  if (!mounted) return null;

  // Portalled to the body so no ancestor's stacking context or overflow can
  // put page content in front of it.
  return createPortal(
    <>
      <button
        ref={tabRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open WHOS - Financial Intelligence"
        aria-expanded={open}
        tabIndex={open ? -1 : undefined}
        className={cn(
          "group fixed z-[60] flex h-14 w-14 items-center justify-center",
          ANCHOR,
          "rounded-full border bg-primary text-primary-foreground shadow-lg",
          "transition-[opacity,transform,box-shadow] duration-200",
          "hover:scale-105 hover:shadow-xl",
          // The lift is the only thing that moves, so it is the only thing
          // reduced motion has to switch off.
          "motion-reduce:transition-none motion-reduce:hover:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          open && "pointer-events-none scale-90 opacity-0"
        )}
      >
        <WhosMark className="h-8 w-8 shrink-0" />

        {/* The name, beside the button rather than inside it.
            Absolutely positioned, so revealing it cannot stretch the circle
            into a pill: the button's width is fixed and the label hangs off
            its left edge. pointer-events-none so it can never swallow a click
            meant for the button underneath it. */}
        <span
          className={cn(
            "pointer-events-none absolute right-full mr-3 whitespace-nowrap",
            "rounded-md border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md",
            "opacity-0 transition-opacity duration-200 motion-reduce:transition-none",
            "group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
        >
          WHOS - Financial Intelligence
        </span>
      </button>

      {open && <AgentPanel panelRef={panelRef} onClose={() => setOpen(false)} />}
    </>,
    document.body
  );
};

export default AgentWidget;
