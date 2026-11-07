"use client";

import { useCurrency } from "@/components/currency-provider";

// The balance figure at the top of an account page.
//
// A client component for the same reason AccountsTotal is one: the page
// around it is server rendered, and server-rendered text does not change
// when the viewer switches currency. This figure printed a hardcoded "₹"
// against a raw toFixed(2) until now, so it both showed rupees to someone
// reading in dollars and dropped the digit grouping -- a balance of ninety-two
// thousand came out as "92000.00".
export default function AccountBalance({ balance }) {
  const { format } = useCurrency();

  return (
    <div className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
      {format(parseFloat(balance))}
    </div>
  );
}
