import { detectCurrency } from "./detect.js";
import { DEFAULT_CURRENCY, isSupported } from "./registry.js";

// Which currency to show, and why.
//
// Deliberately pure: headers and a couple of stored values go in, a decision
// comes out. No database, no cookies API, no React. That is what makes the
// precedence rules testable without standing up a request, and it is also
// what lets the same decision be made on the server (for the first paint) and
// in the browser (after a change) and be guaranteed to agree -- a disagreement
// between those two is a hydration mismatch showing a visitor dollars for one
// frame and rupees for the next.
//
// Precedence, highest first:
//
//   manual     the person chose this currency. Nothing outranks a choice.
//   account    a signed-in user's saved preference.
//   workspace  a workspace's reporting currency. Always absent today: there
//              are no workspaces in WHealthOS. The branch exists because the
//              brief specifies the position, and leaving the slot visible is
//              more honest than silently renumbering around it.
//   geo        suggested from the country the edge placed the request in.
//   default    the application default.
//
// The rule that matters most is the first one. Somebody who picked dollars in
// Mumbai and opens the app from Frankfurt still sees dollars: geolocation is
// a suggestion for a visitor who has expressed no preference, and it never
// gets to overwrite one that exists.

export const CURRENCY_SOURCE = {
  MANUAL: "manual",
  ACCOUNT: "account",
  WORKSPACE: "workspace",
  GEO: "geo",
  DEFAULT: "default",
};

// What the preference cookie holds: a code, and whether it was chosen or
// merely suggested. Two fields rather than one, because "USD because you
// clicked USD" and "USD because you appear to be in America" behave
// differently the moment either the account preference or the country
// changes.
export const CURRENCY_COOKIE = "whealth-currency";

const SEPARATOR = ":";

export const encodePreference = (currency, source) =>
  `${currency}${SEPARATOR}${source === CURRENCY_SOURCE.MANUAL ? "m" : "g"}`;

/**
 * Reads the cookie back. Anything unparseable, or naming a currency this
 * deployment does not support, is treated as absent rather than as an error:
 * a cookie written by an older version must never be able to break a page.
 */
export function decodePreference(raw) {
  if (!raw || typeof raw !== "string") return null;
  const [code, flag] = raw.split(SEPARATOR);
  if (!isSupported(code)) return null;
  return {
    currency: code.toUpperCase(),
    source: flag === "m" ? CURRENCY_SOURCE.MANUAL : CURRENCY_SOURCE.GEO,
  };
}

/**
 * The display currency for one request.
 *
 * @param {object} input
 * @param {string} [input.cookie]     Raw value of the preference cookie.
 * @param {string} [input.account]    A signed-in user's saved currency.
 * @param {string} [input.workspace]  A workspace reporting currency. Unused today.
 * @param {Headers} [input.headers]   Request headers, for geolocation.
 */
export function resolveCurrency({
  cookie = null,
  account = null,
  workspace = null,
  headers = null,
} = {}) {
  const geo = detectCurrency(headers);
  const stored = decodePreference(cookie);

  // 1. An explicit choice. Including one made before signing in -- a guest
  //    who picked yen and then created an account keeps yen, and the account
  //    adopts it rather than the other way round.
  if (stored?.source === CURRENCY_SOURCE.MANUAL) {
    return { ...base(geo), currency: stored.currency, source: CURRENCY_SOURCE.MANUAL };
  }

  // 2. What this account chose last time, on any device.
  if (isSupported(account)) {
    return { ...base(geo), currency: String(account).toUpperCase(), source: CURRENCY_SOURCE.ACCOUNT };
  }

  // 3. A workspace's reporting currency. Never reached today.
  if (isSupported(workspace)) {
    return { ...base(geo), currency: String(workspace).toUpperCase(), source: CURRENCY_SOURCE.WORKSPACE };
  }

  // 4. The country the request appears to come from. Only when it was
  //    actually recognised -- `detected` is false for an unmapped country and
  //    for a request with no geolocation header at all, and neither is a
  //    reason to claim a suggestion was made.
  if (geo.detected) {
    return { ...base(geo), currency: geo.currency, source: CURRENCY_SOURCE.GEO };
  }

  // 5. The default. Also what a previously stored geo suggestion falls back
  //    to being, since it was never a choice.
  if (stored) {
    return { ...base(geo), currency: stored.currency, source: CURRENCY_SOURCE.GEO };
  }

  return { ...base(geo), currency: DEFAULT_CURRENCY, source: CURRENCY_SOURCE.DEFAULT };
}

const base = (geo) => ({
  country: geo.country,
  detected: geo.detected,
  detectionReason: geo.reason,
});

/** Whether a resolution should be written back to the cookie. */
export const shouldPersist = (resolution, cookie) =>
  decodePreference(cookie)?.currency !== resolution.currency ||
  decodePreference(cookie)?.source !== resolution.source;
