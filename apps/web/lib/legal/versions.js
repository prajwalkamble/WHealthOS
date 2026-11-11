// The published versions of the legal documents, and where they live.
//
// One authoritative place. A version string is written into a user's consent
// record as the answer to "what did this person actually agree to", so it must
// never be computed -- not from the current date, not from a file mtime, not
// from a build id. Two users accepting the same document must store the same
// string, forever, and a record written last year must still name the document
// as it read last year.
//
// Each value is therefore a literal, dated the day that version of the
// document was published. Bump it only when the document changes materially,
// and leave the old string alone: records naming it are the evidence that
// those users accepted that text.
//
// Both documents were published on 2026-10-08, so both start at that date.
// TERMS moved to 2026-10-11 when the Terms were rebuilt against a fresh audit:
// recorded acceptance, the account-closure gap and what the monthly summary
// sends to Google all changed materially, and a consent record is only worth
// anything if the string in it still names the text that was accepted.
// PRIVACY moved the same day: its deletion section said there was no way to
// delete an account from inside the app, which read as reassurance while
// Clerk's profile screen could in fact delete the sign-in and strand the data.
// Later the same day, section 10 of the Terms was corrected: it said there was
// no setting that turned the monthly AI commentary off, and by then there was
// one. The string was left at 2026-10-11 rather than suffixed, because the
// correction only names a control that did not exist when the sentence was
// written and takes nothing away from anyone. Whether that deserved its own
// version is a judgement for the operator; if it does, bump TERMS and leave
// the old string in place for the records that name it.
//
// Both moved to 2026-10-23 when a Razorpay checkout was integrated. This is
// material in both documents and in opposite directions, which is why neither
// could be left alone:
//
//   TERMS section 6 said "there is no checkout, no payment processor
//   connected". That is now false. It is replaced by a statement that the
//   checkout exists, that no plan is on sale through it, that paying unlocks
//   nothing, and that a payment taken for nothing will be refunded. Someone
//   who accepted the old text accepted a promise that we could not take their
//   money, and they are entitled to have their record still name that text.
//
//   PRIVACY section 9 gained a processor. Razorpay receives an email address,
//   the amount and the plan chosen, and takes card or UPI details directly on
//   its own screen. A processor list that is out of date is exactly the thing
//   this document exists to get right.
//
// The 2026-10-11 strings are left described above, because the consent records
// that name them are the evidence of what those users agreed to.
// TERMS moved to 2026-11-01 in anticipation of BILLING_ENFORCEMENT being
// switched on. It was not switched on until 2026-11-10 -- see the entry
// below, which is the correction of this one.
//
// This is the change section 6 promised to make before it happened. The
// 2026-10-23 text said, in the strongest words on the page, that WHealthOS
// was free, that no paid feature was held back, that paying unlocked nothing
// and that anyone who paid expecting features would be refunded in full. It
// also undertook to publish new terms, with a new version, BEFORE any plan
// limit was applied to an account -- and said those terms would not apply
// retrospectively to use of the free service.
//
// Enforcement makes every one of those sentences false, so the document could
// not carry them a day longer. The old string is left named here because the
// consent records pointing at it are the evidence of what those users
// accepted, and what they accepted was the free promise.
//
// PRIVACY is NOT bumped. Enforcement changes what an account may do; it adds
// no processor, no new category of data and no new transfer. Razorpay was
// already named on 2026-10-23.
//
// TERMS moved to 2026-11-10 because BILLING_ENFORCEMENT was set to "on", which
// is the day the 2026-11-01 text became true.
//
// The sequence is worth keeping, because the middle step is the kind of fault
// no test caught and no reader could see:
//
//   2026-11-01  the document announced enforcement in the strongest words on
//               the page -- "the difference between them is now applied to
//               your account" -- and bumped its version to say so. The
//               variable was never set in any environment, so
//               requireEntitlement() logged ENTITLEMENT_WOULD_DENY and
//               returned, and every paid feature stayed open to every
//               account. For nine days the published terms overstated what was
//               withheld.
//   2026-11-10  the subscription audit (docs/testing/) found it, and found
//               that the tripwire written to prevent exactly this could not
//               fire: it was guarded on the variable being defined, and unset
//               was the state. The check moved to boot time --
//               billingPolicyContradictions() in lib/security/required-config.js
//               -- where it compares the shipped document against the live
//               configuration and names the variable.
//   2026-11-10  a draft was written to withdraw the claim and restore the
//               2026-10-23 position. The operator chose the other resolution:
//               set the flag. That draft never shipped, so no account ever saw
//               it, and the 2026-11-01 text returns nearly unchanged under
//               today's version.
//
// What the bump achieves, and what it does not:
//
//   It gives the notice section 6 promised. The 2026-11-01 version already
//   announced this change, so nobody reading the published terms since then
//   was told their free account kept features it is about to lose. Today's
//   version is the one whose date matches the switch, and the callout
//   interpolates TERMS.version rather than naming a date in prose, so it
//   cannot drift out of step again.
//
//   It does NOT reach existing accounts. app/(main)/layout.js gates on whether
//   a WHealthOS row exists, not on which version its consent record names, so
//   only accounts created from here on will record 2026-11-10. Enforcement
//   therefore starts for accounts whose consent record names an older string.
//   That is the existing design and this change does not alter it; it is
//   written down because "we published the notice" and "the people it affects
//   have read it" are two different statements, and only the first is true.
//
//   It does NOT apply the per-day transaction allowances. Those are a separate
//   switch, BILLING_QUOTA_ENFORCEMENT, still off, and section 6 stays silent
//   about them -- see perDayTransactionLimitEnforced in lib/legal/terms.js.
//
// The 2026-11-01 and earlier strings are left described here because the
// consent records that name them are the evidence of what those users
// accepted.
//
// TERMS moved to 2026-11-11 because a one-step upgrade between paid plans now
// exists, and section 6 said in as many words that it did not.
//
// The withdrawn sentence: "There is no way to move from one paid plan to
// another in a single step: cancel the one you have, keep it to the end of the
// period you paid for, and subscribe to the other once it ends."
//
// That was true when it was written and is the reason it was written -- it
// replaced an earlier sentence promising a change of plan that had no route,
// no action and no control, which is finding S3 of the subscription audit. The
// capability now exists in one direction only, so the replacement says which
// direction and under what terms rather than simply deleting the restriction.
//
// What is bumped, and why it is a bump at all:
//
//   The document described a limitation of the product. Removing a limitation
//   is not obviously material -- nobody is worse off -- but section 6 is the
//   section a subscriber reads to find out what can happen to their money, and
//   it now describes a way for the price they pay to change without a new
//   checkout. Somebody who accepted the old text accepted a document saying
//   their plan could only change by cancelling, which is a statement about
//   what this application can do to a live mandate. That deserves its own
//   string.
//
// What is NOT changed, and this is the part that keeps the bump honest:
//
//   Proration. Still not calculated, still said so in the same paragraph, and
//   prorationCalculated in lib/legal/terms.js is still false. The upgrade is
//   applied at the end of the period already paid for, so no part period is
//   charged, credited or refunded. This is the same commitment as before; only
//   the route between plans is new.
//
//   Downgrades. Still cancel-and-resubscribe, because moving down mid-period
//   is the case that WOULD require a proration policy, and there is none. The
//   new paragraph says so explicitly rather than leaving a reader to infer a
//   symmetry that is not there.
//
//   PRIVACY is NOT bumped. No processor, no new category of data and no new
//   transfer: the upgrade is a call to Razorpay about a subscription Razorpay
//   already holds.
//
//   It does NOT reach existing accounts, for the same reason the 2026-11-10
//   bump did not -- app/(main)/layout.js gates on whether a WHealthOS row
//   exists, not on which version its consent record names. An existing
//   subscriber will be offered the upgrade while their consent record names an
//   older string. Unlike the enforcement bump this takes nothing away from
//   them, so the gap is a smaller one; it is written down because it is the
//   same gap, and it is still open.
//
// PRIVACY is NOT bumped, for the same reason as on 2026-11-01: enforcement
// changes what an account may do, and adds no processor, no category of data
// and no transfer.
export const LEGAL_VERSIONS = Object.freeze({
  TERMS: "2026-11-11",
  PRIVACY: "2026-10-23",
});

// The canonical routes, so the consent checkbox, the footer and the tests all
// point at the same two pages and a move cannot leave one of them behind.
// tests/legal-consent.test.js asserts a page actually exists at each.
export const LEGAL_LINKS = Object.freeze({
  terms: "/terms",
  privacy: "/privacy",
});
