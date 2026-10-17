import Link from "next/link";
import { ArrowUpRight, KeyRound, Lock, MapPin, ShieldCheck } from "lucide-react";
import { SECURITY, SECURITY_LINK } from "@/lib/legal/security";
import Section, { BODY } from "./section";
import { cn } from "@/lib/utils";

// Four things about handling money that are true, and a link to the page that
// says what is not.
//
// Each entry reads its own flag out of lib/legal/security.js rather than
// restating it, so a claim that stops being true on the Security page stops
// appearing here in the same commit. That file's rule is the strict one --
// nothing in it was written from intent, only from reading the application, the
// database, the provider's documentation or the production response headers --
// and this section inherits it.
//
// What is deliberately absent: certifications, audits, compliance, uptime
// promises, "bank-grade" anything, and any claim that WHealthOS encrypts
// something itself. lib/legal/security.js records why each one is missing under
// notClaimed, and some of the entries there are uncomfortable: there is no MFA
// on the Clerk instance this checkout points at, no CSP, no monitoring and no
// penetration test. A visitor deciding whether to put their balances in is
// entitled to find that out, so the last line sends them to it rather than
// closing on four reassurances.
const ITEMS = [
  SECURITY.passwordsNeverStored && {
    icon: KeyRound,
    title: "Your password never reaches us",
    body: "Clerk holds your credentials. The WHealthOS schema has no password column and no field that could hold one.",
  },
  SECURITY.serverSideOwnershipChecks && {
    icon: ShieldCheck,
    title: "Nobody can read your records but you",
    body: SECURITY.crossAccountTests
      ? "Every read and write is matched against your own user on the server, and cross-account attempts are covered by tests that run against a real database."
      : "Every read and write is matched against your own user on the server, before anything is read or written.",
  },
  SECURITY.noCardNumbersOrBankCredentials && {
    icon: Lock,
    title: "No card numbers, no bank logins",
    body: SECURITY.receiptsNotStored
      ? "There is no column for a card number, a CVV, a PIN or an online banking credential, and no bank aggregator anywhere in the codebase. A photographed receipt is read and then dropped — it is never stored."
      : "There is no column for a card number, a CVV, a PIN or an online banking credential, and no bank aggregator anywhere in the codebase.",
  },
  SECURITY.dataRegion && {
    icon: MapPin,
    title: "Held in India, served over HTTPS",
    body: `Your data sits in ${SECURITY.dataRegion}.${
      SECURITY.httpsEnforced ? " HTTPS is enforced, and the plain-HTTP address redirects to it." : ""
    }`,
  },
].filter(Boolean);

const Trust = () => {
  if (ITEMS.length === 0) return null;

  return (
    <Section
      id="trust"
      eyebrow="Handling your money"
      title="What we can actually tell you about your data"
      lead="A security page is the one place where an unsupported claim is dangerous, because the reader has no way to check it. So this is the verified list, and the gaps are published too."
    >
      <ul className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {ITEMS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon aria-hidden className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
              <p className={cn("mt-2", BODY)}>{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-base text-muted-foreground">
        There is no certification, no independent audit and no penetration test
        behind WHealthOS, and the Security page names those gaps rather than
        leaving them to be inferred.{" "}
        <Link
          href={SECURITY_LINK}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Read it before you decide
          <ArrowUpRight aria-hidden className="h-4 w-4" />
        </Link>
      </p>
    </Section>
  );
};

export default Trust;
