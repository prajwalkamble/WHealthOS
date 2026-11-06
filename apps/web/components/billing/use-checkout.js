"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// Opening Razorpay Checkout.
//
// One caller: the pay button on /billing. It used to be two -- the pricing
// page and the Plan card in Settings each opened their own -- and that is why
// this is a hook rather than a component: the logic was worth sharing, the
// presentation was not. Both of those screens now link to /billing instead,
// so there is exactly one place in this application that can open a payment
// window, which is also the only place that has to get any of this right.
//
// What it reports back is a PHASE, not a boolean. A payment has more states
// than "busy", the differences between them are what somebody staring at the
// screen needs to know, and a toast is the wrong place for most of them --
// toasts are dismissible, unannounced to a screen reader by default, and gone
// by the time anyone looks for the retry. So the phase drives inline copy and
// the toast is kept for the one message that has to survive a navigation.
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export const PHASES = {
  // Nothing has happened yet, or the last attempt was reset.
  IDLE: "idle",
  // Asking our own server to open a subscription.
  CREATING: "creating",
  // Fetching Razorpay's script and opening the modal.
  OPENING: "opening",
  // The modal is up and the person is paying. Nothing for us to do.
  AWAITING: "awaiting",
  // They paid; we are asking our server to confirm it.
  VERIFYING: "verifying",
  // They closed the window. Not an error.
  DISMISSED: "dismissed",
  // Razorpay refused the payment, or our server refused to start one.
  FAILED: "failed",
};

// The script is loaded on the first click rather than with the page. Three
// reasons, in order of how much they matter: nobody who is not buying
// anything should have a payment provider's script running in their browser,
// nothing on checkout.razorpay.com is contacted (and no cookie of theirs is
// set) until someone deliberately starts a purchase, and a page does not pay
// for 60 kB it will almost never use.
let loading = null;

const loadCheckout = () => {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();

  loading ??= new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      // Cleared so a retry can try again. A blocked script is the common case
      // -- plenty of content blockers list payment providers -- and that is a
      // situation a second click should be allowed to attempt.
      loading = null;
      script.remove();
      reject(new Error("Razorpay checkout could not be loaded"));
    });

    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return loading;
};

const asJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

// How long to wait on our own endpoints before calling it a timeout.
//
// A create call that is still open after this may well have reached Razorpay,
// so the message says so and the retry is safe: the attempt row on the server
// is reconciled before a second subscription is ever opened.
const REQUEST_TIMEOUT_MS = 20_000;

const withTimeout = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export function useRazorpayCheckout({ email = null, contact = null } = {}) {
  const [phase, setPhase] = useState(PHASES.IDLE);
  // { message, detail } -- never a provider payload, never a stack.
  const [error, setError] = useState(null);
  const router = useRouter();

  // The modal outlives a render and its callbacks fire whenever the person
  // gets round to paying. Writing state from one after the component has gone
  // is a React warning and, worse, a toast on a page that has moved on.
  const live = useRef(true);
  useEffect(() => () => {
    live.current = false;
  }, []);

  const settle = useCallback((next, failure = null) => {
    if (!live.current) return;
    setPhase(next);
    setError(failure);
  }, []);

  const reset = useCallback(() => settle(PHASES.IDLE, null), [settle]);

  // Hands the callback to the server and goes to the page that reads the real
  // state. Nothing here decides whether the subscription is active: the
  // browser cannot be trusted to, and the server does not take its word.
  const verify = useCallback(
    async (response) => {
      settle(PHASES.VERIFYING);
      try {
        const verified = await withTimeout("/api/billing/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });

        const body = await asJson(verified);

        if (!verified.ok || !body?.verified) {
          // Deliberately not "payment failed". The money may well have left
          // their account; what failed is this application's confirmation of
          // it, and telling someone their payment failed when it did not is
          // the worse of the two mistakes.
          //
          // A toast rather than inline copy, because the next line navigates:
          // the confirmation page is where they are about to be, and it will
          // go on saying "we are confirming this" until the webhook settles
          // it either way.
          toast.error(
            body?.error ??
              "We could not confirm that payment. If you were charged, your plan will update shortly — nothing needs paying again."
          );
        }
      } catch {
        toast.error(
          "We could not reach WHealthOS to confirm that payment. If you were charged, your plan will still update."
        );
      } finally {
        // Either way the confirmation page is the right destination: it reads
        // the subscription from the database, which is the only account of
        // what happened that matters.
        router.push("/billing/success");
      }
    },
    [router, settle]
  );

  // Opens checkout for a plan. `interval` is the internal vocabulary
  // ("monthly" / "yearly"); the URL calls the same thing `duration`.
  //
  // No amount, no currency and no Razorpay plan id is sent. The server prices
  // the plan from its own catalogue, which is the only reason a hand-edited
  // request cannot buy Intelligent for a rupee.
  const start = useCallback(
    async ({ planId, interval, label }) => {
      const key = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!key) {
        // Inlined at build time, so this is the same for every visitor and no
        // retry will fix it. It is also the one failure the server never sees
        // -- we give up before asking it -- which is why the message has to
        // carry its own diagnosis rather than deferring to a 503.
        //
        // Outside production the person clicking the button is the person who
        // can fix it, so they get the variable name. In production they get
        // the sentence, and the console carries the rest.
        console.error({
          code: "RAZORPAY_PUBLIC_KEY_MISSING",
          details: { variable: "NEXT_PUBLIC_RAZORPAY_KEY_ID" },
        });
        settle(PHASES.FAILED, {
          message: "Payments are not available just now.",
          detail:
            process.env.NODE_ENV === "production"
              ? null
              : "NEXT_PUBLIC_RAZORPAY_KEY_ID is not set in apps/web/.env. Add it and restart the dev server — it is inlined at build time.",
          retryable: false,
        });
        return { opened: false, reason: "not-configured" };
      }

      settle(PHASES.CREATING);

      let checkout;
      try {
        // The subscription first, so a failure happens before a modal opens
        // over the page.
        const created = await withTimeout("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, interval }),
        });

        checkout = await asJson(created);

        if (!created.ok || !checkout?.subscriptionId) {
          // 409 means the account already has something: a subscription, or a
          // checkout being prepared in another tab. Not an error to apologise
          // for, and not one a second click fixes -- refreshing shows the
          // real state, which is why that is what is offered.
          settle(PHASES.FAILED, {
            message: checkout?.error ?? "Could not start the payment. Please try again.",
            // `detail` is only ever present outside production, and names the
            // configuration that is missing. Showing it is the difference
            // between a dead end and a fix.
            detail: checkout?.detail ?? null,
            retryable: created.status !== 409,
            refresh: created.status === 409,
          });
          return { opened: false, reason: checkout?.code ?? "refused" };
        }
      } catch (failure) {
        const aborted = failure?.name === "AbortError";
        settle(PHASES.FAILED, {
          message: aborted
            ? "Setting up the payment is taking longer than expected."
            : "We could not reach WHealthOS to set up the payment.",
          // The honest version of "try again". The server reconciles its own
          // attempt against Razorpay before opening a second subscription, so
          // a retry here cannot produce two.
          detail: "Nothing has been charged. Trying again will not charge you twice.",
          retryable: true,
        });
        return { opened: false, reason: aborted ? "timeout" : "network" };
      }

      settle(PHASES.OPENING);

      try {
        await loadCheckout();

        const razorpay = new window.Razorpay({
          key,
          // A subscription, not an order. Razorpay signs the callback with the
          // payment id and THIS id, in that order.
          subscription_id: checkout.subscriptionId,
          name: "WHealthOS",
          description: label,
          // Only what Razorpay needs to send a receipt. No name: this
          // application does not put the account holder's name in front of
          // anybody, and a payment provider does not need one to take a card.
          prefill: {
            ...(email ? { email } : {}),
            ...(contact ? { contact } : {}),
          },
          // No theme colour. The accent here is a CSS variable the person can
          // change in Appearance, and Razorpay wants a literal hex -- a
          // hardcoded one would be wrong for every theme but the default.
          handler: verify,
          modal: {
            ondismiss: () => {
              // Closing the modal is a decision, not an error. The attempt
              // stays resumable, nothing is charged, and clicking the button
              // again reopens the SAME subscription rather than opening a
              // second one.
              settle(PHASES.DISMISSED, null);
            },
          },
        });

        razorpay.on("payment.failed", (event) => {
          const reason = event?.error?.description;
          settle(PHASES.FAILED, {
            message: "That payment did not go through.",
            // Razorpay's description is written for the payer -- "card
            // declined by issuing bank" and the like -- so it is worth
            // showing. Anything else is kept generic.
            detail:
              typeof reason === "string"
                ? reason
                : "Please try again, or use a different payment method.",
            retryable: true,
          });
        });

        razorpay.open();
        settle(PHASES.AWAITING);
        return { opened: true };
      } catch {
        settle(PHASES.FAILED, {
          message: "The payment window could not be opened.",
          detail:
            "A content blocker or extension may be stopping checkout.razorpay.com. Nothing has been charged.",
          retryable: true,
        });
        return { opened: false, reason: "script-blocked" };
      }
    },
    [contact, email, settle, verify]
  );

  return {
    start,
    reset,
    phase,
    error,
    // Kept for the button's disabled state: every phase in which a second
    // click would be wrong.
    busy:
      phase === PHASES.CREATING ||
      phase === PHASES.OPENING ||
      phase === PHASES.AWAITING ||
      phase === PHASES.VERIFYING,
  };
}
