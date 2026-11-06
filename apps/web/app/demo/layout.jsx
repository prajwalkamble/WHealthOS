import { DemoProvider } from "./_components/demo-provider";
import DemoShell from "./_components/demo-shell";
import { CurrencyProvider } from "@/components/currency-provider";
import { currentCurrency } from "@/lib/currency/server";
import { DEMO_CURRENCY } from "@/lib/demo/data";
import { rateTable } from "@/lib/currency/rates/store";

export const metadata = {
  title: "Demo · WHealthOS",
  description: "Explore WHealthOS with sample data, no account needed.",
};

// Outside the (main) group on purpose: these pages are public, and everything
// they show is computed in the browser, so none of the tenant machinery that
// wraps the signed-in app applies here.
// Async, and therefore rendered per request rather than prerendered. That is
// the cost of detecting a visitor's country at all, and it is the point: a
// guest in Tokyo who is shown rupees has been told this is an Indian product.
export default async function DemoLayout({ children }) {
  const currency = await currentCurrency();

  // The sample figures are written in INR, and they stay that way. The rate
  // table goes to the browser with the page, and CurrencyProvider converts
  // for display -- so a guest switching currency changes local state and
  // nothing else. No request, no re-render of this layout, no round trip.
  //
  // Relabelling is still impossible: with no rate for the chosen currency the
  // provider refuses and formats in INR, and the shell says why.
  let rates = { base: "EUR", rates: {}, asOf: null, stale: true };
  try {
    rates = await rateTable();
  } catch {
    // A rate lookup must never take down the public demo.
  }

  return (
    <CurrencyProvider initial={currency} ledger={[DEMO_CURRENCY]} rates={rates}>
      <DemoProvider>
        <DemoShell>{children}</DemoShell>
      </DemoProvider>
    </CurrencyProvider>
  );
}
