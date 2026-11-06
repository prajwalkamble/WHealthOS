"use client";

import { useCurrency } from "@/components/currency-provider";

// The one-line summary above the account grid.
//
// A client component for a reason that is not cosmetic: it was server
// rendered, and server-rendered text does not change when the currency does.
// Once switching became a local state update, this was the only figure on the
// page that would have kept the old currency until the next navigation --
// visibly disagreeing with every account card beside it.
export default function AccountsTotal({ count, total }) {
  const { format } = useCurrency();

  if (count === 0) return <>No accounts yet.</>;

  return (
    <>
      {count} account{count > 1 ? "s" : ""}, {format(total)} in total.
    </>
  );
}
