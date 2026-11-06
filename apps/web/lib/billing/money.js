// Formatting an amount that came from the payment provider.
//
// Everything in this directory works in MINOR UNITS -- paise, cents -- as
// Razorpay does, and carries the currency alongside as a code. Both facts are
// handled by lib/currency/format.js, which divides by the currency's own
// minor-unit exponent rather than by a hard-coded hundred, so a yen amount is
// not understated by a factor of a hundred.
//
// Re-exported rather than reimplemented: this module existed first, billing
// code imports it by name, and a second implementation of minor-unit
// arithmetic is exactly the drift the currency registry exists to prevent.
export { formatMinorUnits } from "../currency/format";
