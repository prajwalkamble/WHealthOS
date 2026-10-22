import { AgentError, runAgentTurn } from "@/lib/ai/agent";
import { AGENT_LIMITS } from "@/lib/ai/agent-config";
import { agentChatSchema } from "@/app/lib/schema";
import { enforceRateLimit } from "@/lib/arcjet";
import { requireClerkUserId } from "@/lib/session";

// WHOS's one endpoint.
//
// A route handler rather than a server action, for the same reason the export
// is one: the response is a stream with its own content type, which an action
// cannot express. An action also cannot be aborted part way through, and the
// stop button depends on exactly that.
//
// Prisma and the Google SDK both need Node rather than edge.
export const runtime = "nodejs";

// Newline-delimited JSON rather than Server-Sent Events. The payload is only
// ever read by our own client, NDJSON needs no `data:` framing or event-name
// parsing, and a half-received line is detectable instead of silently
// becoming a different event.
const CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

// The body ceiling, derived from the limits rather than guessed, with room
// for JSON overhead and multi-byte characters. Enforced before parsing, so a
// large body is refused without being read into memory as an object.
const MAX_BODY_BYTES =
  (AGENT_LIMITS.maxMessageChars + AGENT_LIMITS.maxHistoryChars) * 4 + 4096;

const fail = (message, status, code) =>
  Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request) {
  // 1. Who is asking. From the verified Clerk session only; the body is never
  //    consulted for identity, and carries no field that could be.
  let clerkUserId;
  try {
    clerkUserId = await requireClerkUserId();
  } catch {
    return fail("Sign in to use WHOS - Financial Intelligence.", 401, "UNAUTHORIZED");
  }

  // 2. May they, right now. Before the body is read and long before a token
  //    is spent, because this is the control that bounds the bill.
  try {
    await enforceRateLimit("aiChat", clerkUserId);
  } catch {
    return fail(
      "You have asked WHOS a lot of questions in a short time. Please wait a little and try again.",
      429,
      "RATE_LIMITED"
    );
  }

  // 3. Is the body a sane size and shape.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail("That message is too long.", 413, "TOO_LARGE");
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return fail("Could not read the request.", 400, "UNREADABLE");
  }
  // Checked again: content-length is a claim, not a measurement.
  if (raw.length > MAX_BODY_BYTES) {
    return fail("That message is too long.", 413, "TOO_LARGE");
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Could not read the request.", 400, "MALFORMED");
  }

  const parsed = agentChatSchema.safeParse(body);
  if (!parsed.success) {
    // The schema's messages are written for a person and contain nothing
    // internal, so the first one is safe to show.
    return fail(
      parsed.error.issues[0]?.message ?? "That question could not be read.",
      400,
      "INVALID"
    );
  }

  const { message, history, conversationId } = parsed.data;

  // The browser going away -- navigation, or the stop button -- aborts the
  // provider call rather than leaving it running with nobody listening.
  // Google's SDK notes that this does not stop the work being billed, which
  // is why the UI says it stops the answer rather than the cost.
  const signal = request.signal;

  const encoder = new TextEncoder();
  const send = (controller, event) =>
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgentTurn({
          message,
          history,
          userId: clerkUserId,
          signal,
        })) {
          if (signal?.aborted) break;
          send(controller, event);
        }
      } catch (error) {
        if (signal?.aborted) {
          // Nobody is listening. Closing quietly is the whole response.
        } else if (error instanceof AgentError) {
          send(controller, { type: "error", message: error.message, code: error.code });
        } else {
          // An unexpected failure. Logged here, where the stack is, and
          // reported to the browser without it. No prompt, no figures, no key.
          console.error({
            code: "WHOS_AGENT_FAILED",
            details: { conversationId: conversationId ?? null },
            error,
          });
          send(controller, {
            type: "error",
            message: "WHOS - Financial Intelligence could not answer that just now. Please try again.",
            code: "UNEXPECTED",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  // 200 with an error event inside is deliberate for a failure that happens
  // after the stream opens: the status line is long gone by then. Failures
  // before it -- everything above -- get a real status code.
  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPE,
      // Financial information. Never stored by a proxy or the browser.
      "Cache-Control": "no-store, private",
      // Stops a buffering reverse proxy from holding the whole answer back
      // and defeating the streaming entirely.
      "X-Accel-Buffering": "no",
    },
  });
}
