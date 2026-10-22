"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The conversation, and the one request that drives it.
//
// Not useFetch: that hook is built around server actions, which return a value
// once. This reads a stream and has to show the answer as it arrives, keep a
// handle on it so the stop button can abort it, and survive the person closing
// the panel mid-answer.
//
// History lives here and nowhere else. It is deliberately not persisted: the
// conversation is this person's financial position in plain text, and there is
// no column, no cookie and no localStorage entry holding it. Closing the tab
// is the end of it -- a real limitation, and the safer default of the two.

const ENDPOINT = "/api/ai/chat";

// What travels back to the server as context for a follow-up. The server caps
// this again; sending fewer turns than it allows just means a cheaper request.
const HISTORY_TURNS = 8;

let seq = 0;
const nextId = () => `m${++seq}`;

export function useAgentChat() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | streaming
  const abort = useRef(null);
  // The last question, so Retry re-asks it rather than needing it retyped.
  const lastAsk = useRef(null);
  const conversationId = useRef(null);

  // Generated after mount, never during render: it is an id, and this project
  // has been bitten by ids that differ between the server and the client.
  useEffect(() => {
    if (conversationId.current) return;
    conversationId.current =
      globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 32) ??
      `c${Date.now().toString(36)}`;
  }, []);

  // An answer in flight when the component goes away is abandoned, not left
  // writing into state that no longer exists.
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id, changes) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, ...(typeof changes === "function" ? changes(message) : changes) }
          : message
      )
    );
  }, []);

  const run = useCallback(
    async (question, history) => {
      const controller = new AbortController();
      abort.current = controller;
      setStatus("streaming");

      const replyId = nextId();
      setMessages((current) => [
        ...current,
        { id: replyId, role: "assistant", content: "", pending: true },
      ]);

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: question,
            history,
            ...(conversationId.current ? { conversationId: conversationId.current } : {}),
          }),
          signal: controller.signal,
        });

        // A refusal before the stream opened carries a real status and a JSON
        // body. 429 and 503 are worth retrying; 400 and 401 are not, and the
        // button is not offered for them.
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null);
          patch(replyId, {
            pending: false,
            error:
              body?.error ??
              "WHOS - Financial Intelligence could not answer that just now. Please try again.",
            retryable: response.status >= 500 || response.status === 429,
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // NDJSON: one event per line, and a chunk can split a line anywhere,
        // so the tail is held back until its newline arrives.
        const consume = (line) => {
          if (!line.trim()) return;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (event.type === "meta") {
            patch(replyId, { meta: event });
          } else if (event.type === "delta") {
            patch(replyId, (message) => ({
              pending: false,
              content: message.content + event.text,
            }));
          } else if (event.type === "done") {
            patch(replyId, {
              pending: false,
              citations: event.citations ?? [],
              note: event.note ?? null,
              truncated: Boolean(event.truncated),
            });
          } else if (event.type === "error") {
            patch(replyId, (message) => ({
              pending: false,
              // Text already streamed is kept: a half answer plus "that
              // failed" is more use than losing what arrived.
              error: event.message,
              retryable: message.content.length === 0,
            }));
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) consume(line);
        }
        consume(buffer);

        // The stream closed with nothing in it. Rare, and silent otherwise.
        patch(replyId, (message) =>
          message.content || message.error
            ? { pending: false }
            : {
                pending: false,
                error: "WHOS did not answer. Please try again.",
                retryable: true,
              }
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          // Stopped on purpose. Whatever arrived stays on screen, marked.
          patch(replyId, (message) => ({
            pending: false,
            stopped: true,
            ...(message.content ? {} : { error: "Stopped before it answered." }),
          }));
          return;
        }
        patch(replyId, {
          pending: false,
          error: "Could not reach WHealthOS. Check your connection and try again.",
          retryable: true,
        });
      } finally {
        abort.current = null;
        setStatus("idle");
      }
    },
    [patch]
  );

  // Turns the visible conversation into the history the server accepts.
  // Failed and stopped turns are left out: resending an error as context
  // teaches the next answer nothing and costs tokens.
  const historyFrom = useCallback(
    (list) =>
      list
        .filter((message) => message.content && !message.error)
        .slice(-HISTORY_TURNS)
        .map((message) => ({ role: message.role, content: message.content })),
    []
  );

  const ask = useCallback(
    (text) => {
      const question = String(text ?? "").trim();
      if (!question || status === "streaming") return;

      lastAsk.current = question;
      let history = [];
      setMessages((current) => {
        history = historyFrom(current);
        return [...current, { id: nextId(), role: "user", content: question }];
      });
      // Reads the history captured above rather than state, which has not
      // committed yet at this point.
      void run(question, history);
    },
    [historyFrom, run, status]
  );

  // Re-asks the last question, replacing the failed answer rather than
  // stacking a second one under it.
  const retry = useCallback(() => {
    const question = lastAsk.current;
    if (!question || status === "streaming") return;

    let history = [];
    setMessages((current) => {
      const trimmed = [...current];
      while (trimmed.length && trimmed[trimmed.length - 1].role === "assistant") {
        trimmed.pop();
      }
      history = historyFrom(trimmed.slice(0, -1));
      return trimmed;
    });
    void run(question, history);
  }, [historyFrom, run, status]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    abort.current?.abort();
    lastAsk.current = null;
    setMessages([]);
  }, []);

  return {
    messages,
    status,
    streaming: status === "streaming",
    ask,
    retry,
    stop,
    reset,
    canRetry: Boolean(lastAsk.current),
  };
}
