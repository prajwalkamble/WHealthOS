// One place for money formatting, so every screen shows the same thing.
//
// This file used to BE the implementation: one Intl.NumberFormat hard-wired
// to en-IN and INR, which is why ninety-odd call sites across the app pass an
// amount and nothing else. The implementation now lives in
// lib/currency/format.js and knows about every supported currency; this stays
// as the name those call sites already import, with the same signature.
//
// The second argument is what makes a screen multi-currency. Omitting it
// means the application default, which is what every existing record is in,
// so a call site that has not been given a currency yet renders exactly as it
// did before. Nothing broke the day this changed; screens became
// currency-aware one at a time as each was given a currency to pass.
export {
  formatAmount,
  formatCompactCurrency,
  formatCurrency,
  formatMinorUnits,
  formatMoney,
} from "./currency/format";
