// Where a "come back here afterwards" parameter is allowed to point.
//
// A destination that arrives in a URL is attacker-controlled: anybody can
// send a link to /sign-in?redirect_url=https://not-us.example and the sign-in
// page would, if it believed it, bounce a freshly authenticated person
// straight off the site. That is an open redirect, and it is worth more to a
// phisher than it looks -- the link genuinely starts on our domain.
//
// So: same-site, path-only, and nothing clever.
//
//   "/pricing?plan=pro"   allowed
//   "//evil.example"      refused -- a protocol-relative URL
//   "https://evil..."     refused
//   "/\\evil.example"     refused -- some parsers read a backslash as a slash
//   "pricing"             refused -- relative to wherever it is used
export function safeRedirect(value, fallback = null) {
  if (typeof value !== "string") return fallback;

  const path = value.trim();
  if (!path.startsWith("/")) return fallback;
  // "//host" and "/\host" are both ways of leaving the site.
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
  // A control character or a newline has no business in a path and is how a
  // header or a parser gets confused.
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;

  return path;
}
