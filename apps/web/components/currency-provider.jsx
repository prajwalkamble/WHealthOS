"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatCompactCurrency, formatCurrency } from "@/lib/currency/format";
import {
  DEFAULT_CURRENCY,
  coerceCurrency,
  currencyOf,
} from "@/lib/currency/registry";
import {
  CURRENCY_COOKIE,
  CURRENCY_SOURCE,
  encodePreference,
} from "@/lib/currency/resolve";
import {
  convertWithRate,
  invertRate,
  presentationFor,
} from "@/lib/currency/convert-client";

// The display currency, for every client component.
//
// Changing it is a local state update and nothing else. No navigation, no
// route refresh, no server action on the critical path, and no request for a
// rate -- because the rate table came down with the page and the arithmetic
// is the browser's to do.
//
// That is the whole design. Previously the conversion scalar was computed on
// the SERVER and handed over as a prop, so the client could not convert
// without asking; the ask was a server action, and the server action called
// revalidatePath("/", "layout"), which re-rendered the entire signed-in tree.
// One click cost a round trip and a full re-render, and lost scroll position
// with it. Giving the client the rates removed the reason for all three.
//
// Seeded from the server so the first paint is already correct and hydration
// matches: the same pure function runs in both places over the same data.

const CurrencyContext = createContext(null);

// How long to wait before telling the account about a change.
//
// Clicking through four currencies to compare them should cost one write, not
// four. The cookie is written immediately and synchronously, so nothing about
// the user's experience waits on this.
const SYNC_DELAY_MS = 800;

const writeCookie = (currency) => {
  try {
    const year = 60 * 60 * 24 * 365;
    document.cookie =
      `${CURRENCY_COOKIE}=${encodePreference(currency, CURRENCY_SOURCE.MANUAL)}` +
      `; path=/; max-age=${year}; samesite=lax` +
      (window.location.protocol === "https:" ? "; secure" : "");
  } catch {
    // Blocked cookies. The choice still applies for this page; not
    // remembering it is not worth failing over.
  }
};

export function CurrencyProvider({
  children,
  initial,
  ledger = null,
  rates = null,
  // Whether there is an account to remember this on. False for the guest
  // demo, which then makes no request at all -- its cookie is the whole of
  // its persistence.
  sync = false,
}) {
  const resolved = useMemo(
    () => ({
      currency: coerceCurrency(initial?.currency, DEFAULT_CURRENCY),
      source: initial?.source ?? CURRENCY_SOURCE.DEFAULT,
      country: initial?.country ?? null,
      detected: Boolean(initial?.detected),
    }),
    [initial?.currency, initial?.source, initial?.country, initial?.detected]
  );

  // Plain state. Not useOptimistic, which tied the displayed currency to a
  // pending server action and snapped back when one was slow.
  const [selected, setSelected] = useState(resolved.currency);

  // The server's answer wins on navigation -- it reflects the cookie and the
  // account -- but must not fight a choice made since this tree mounted.
  const chosen = useRef(false);
  useEffect(() => {
    if (!chosen.current) setSelected(resolved.currency);
  }, [resolved.currency]);

  // The account write, debounced and fire-and-forget. A failure leaves the
  // local choice alone: the cookie already holds it, and reverting the UI
  // because a background write failed would be the worst of both.
  const timer = useRef(null);
  const syncing = useRef(null);

  // What the account is already known to hold.
  //
  // Seeded from the server's own resolution: if it resolved from the account,
  // the account holds exactly that. Choosing it again is then a write of a
  // value that is already there, and the cheapest request is the one not
  // made -- which matters most for the common case of clicking through a few
  // currencies to compare and settling back on the original.
  const persisted = useRef(
    initial?.source === CURRENCY_SOURCE.ACCOUNT ? resolved.currency : null
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const select = useCallback((code) => {
    const next = coerceCurrency(code, null);
    if (!next) return;

    chosen.current = true;
    // 1. React state, synchronously. Every figure re-formats this render.
    setSelected(next);
    // 2. The cookie, synchronously. The next server render already agrees,
    //    so a navigation does not flicker back to the old currency.
    writeCookie(next);

    // 3. The account, eventually, and only when there is one.
    //
    // A plain fetch to a route handler -- NOT a Server Action. Next
    // re-renders the current route's server components after any action
    // resolves, so doing this through one re-rendered the whole signed-in
    // tree a moment after each change and looked exactly like a page reload.
    // A route handler returns JSON and nothing re-renders.
    //
    // keepalive so a change made just before navigating still lands.
    if (!sync) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Already there, or already in flight. Either way, nothing to send.
      if (persisted.current === next || syncing.current === next) return;
      syncing.current = next;
      fetch("/api/currency", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currency: next }),
        keepalive: true,
      })
        .then((response) => {
          if (response.ok) persisted.current = next;
        })
        .catch(() => {
          // Nothing is waiting on this and the cookie already holds the
          // choice. Clearing the marker lets a later attempt retry.
          syncing.current = null;
        });
    }, SYNC_DELAY_MS);
  }, [sync]);

  // The presentation decision, recomputed only when the currency or the data
  // behind it changes -- not on every render of every consumer.
  const decision = useMemo(
    () =>
      presentationFor({
        ledger,
        target: selected,
        rates: rates?.rates,
        base: rates?.base,
        asOf: rates?.asOf,
        stale: rates?.stale,
      }),
    [ledger, selected, rates]
  );

  const value = useMemo(() => {
    const code = decision.currency;
    const meta = currencyOf(code) ?? currencyOf(DEFAULT_CURRENCY);
    const convert = (amount) =>
      decision.applies && !decision.exact
        ? convertWithRate(amount, decision.rate, decision.from, code)
        : Number(amount);

    return {
      currency: code,
      selected,
      locked: !decision.applies && decision.target !== code,
      lockedTo: decision.applies ? null : decision.currency,
      converted: decision.applies && !decision.exact,
      conversionReason: decision.reason,
      ledger: decision.ledger,
      rateAsOf: decision.asOf,
      rateStale: decision.stale,
      symbol: meta.symbol,
      name: meta.name,
      locale: meta.locale,
      fractionDigits: meta.fractionDigits,
      convertible: meta.convertible,
      country: resolved.country,
      source: chosen.current ? CURRENCY_SOURCE.MANUAL : resolved.source,
      // Nothing is ever pending: the change is local.
      pending: false,
      setCurrency: select,
      convert,
      // The other direction: a figure typed in the currency being READ,
      // turned back into the currency the records are held in. The guest
      // demo needs it when somebody adds a transaction while viewing in yen.
      toLedger: (amount) =>
        decision.applies && !decision.exact
          ? convertWithRate(amount, invertRate(decision.rate), code, decision.from)
          : Number(amount),
      format: (amount) => formatCurrency(convert(amount), code),
      formatCompact: (amount) => formatCompactCurrency(convert(amount), code),
    };
  }, [decision, selected, resolved.country, resolved.source, select]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * The display currency and the helpers bound to it.
 *
 * Returns a working default outside a provider rather than throwing: the
 * marketing calculators and previews render without one, and a thrown error
 * there would take down a page over a formatting detail.
 */
export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context) return context;

  const meta = currencyOf(DEFAULT_CURRENCY);
  return {
    currency: DEFAULT_CURRENCY,
    selected: DEFAULT_CURRENCY,
    locked: false,
    lockedTo: null,
    converted: false,
    conversionReason: null,
    ledger: null,
    rateAsOf: null,
    rateStale: false,
    symbol: meta.symbol,
    name: meta.name,
    locale: meta.locale,
    fractionDigits: meta.fractionDigits,
    convertible: meta.convertible,
    country: null,
    source: CURRENCY_SOURCE.DEFAULT,
    pending: false,
    setCurrency: () => {},
    convert: (amount) => Number(amount),
    toLedger: (amount) => Number(amount),
    format: (amount) => formatCurrency(amount, DEFAULT_CURRENCY),
    formatCompact: (amount) => formatCompactCurrency(amount, DEFAULT_CURRENCY),
  };
}
