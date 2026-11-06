import { describe, it, expect } from "vitest";
import {
  LIVE_STATUSES,
  SUBSCRIPTION_STATUS,
  fromUnix,
  grantsAccess,
  isLive,
  normaliseStatus,
} from "@/lib/billing/status";

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("Razorpay's vocabulary maps onto ours", () => {
  it.each([
    ["created", "PENDING"],
    ["authenticated", "PENDING"],
    ["active", "ACTIVE"],
    ["pending", "PAST_DUE"],
    ["halted", "PAST_DUE"],
    ["cancelled", "CANCELLED"],
    ["completed", "COMPLETED"],
    ["expired", "EXPIRED"],
    ["paused", "PAUSED"],
  ])("maps %s to %s", (provider, internal) => {
    expect(normaliseStatus(provider)).toBe(internal);
  });

  it("is not case sensitive about the provider's spelling", () => {
    expect(normaliseStatus("ACTIVE")).toBe("ACTIVE");
  });

  // "pending" means a charge FAILED and is being retried. Reading it as our
  // PENDING -- never charged -- would be the wrong direction entirely, and it
  // is the single most tempting mistake in this mapping.
  it("does not confuse Razorpay's pending with ours", () => {
    expect(normaliseStatus("pending")).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
    expect(normaliseStatus("pending")).not.toBe(SUBSCRIPTION_STATUS.PENDING);
  });

  it("distinguishes a cancellation that has been scheduled", () => {
    expect(normaliseStatus("active", { cancelAtCycleEnd: true })).toBe("CANCEL_SCHEDULED");
    expect(normaliseStatus("active", { cancelAtCycleEnd: false })).toBe("ACTIVE");
  });

  it("only applies the scheduled-cancellation reading to an active one", () => {
    expect(normaliseStatus("halted", { cancelAtCycleEnd: true })).toBe("PAST_DUE");
  });

  it.each([["nonsense"], [""], [null], [undefined], ["ACTIVE "], ["subscribed"]])(
    "returns null for the unrecognised state %s",
    (status) => {
      expect(normaliseStatus(status)).toBeNull();
    }
  );
});

describe("the access policy", () => {
  it("grants an active subscription", () => {
    expect(grantsAccess({ status: "ACTIVE", currentEnd: past })).toBe(true);
  });

  it("never grants a pending one, however recent", () => {
    expect(grantsAccess({ status: "PENDING", currentEnd: future })).toBe(false);
    expect(grantsAccess({ status: "PENDING", currentEnd: null })).toBe(false);
  });

  it("never grants a paused one", () => {
    expect(grantsAccess({ status: "PAUSED", currentEnd: future })).toBe(false);
  });

  it("keeps a scheduled cancellation running to the paid-through date", () => {
    expect(grantsAccess({ status: "CANCEL_SCHEDULED", currentEnd: future })).toBe(true);
    expect(grantsAccess({ status: "CANCEL_SCHEDULED", currentEnd: past })).toBe(false);
  });

  // The documented policy, and the one most likely to be got wrong in either
  // direction: a failed renewal does not end access that was already paid for,
  // and it does not extend it by a single day either. No grace period is
  // invented here because none has been published.
  it.each([["PAST_DUE"], ["CANCELLED"], ["COMPLETED"], ["EXPIRED"]])(
    "grants %s only while the paid period has not ended",
    (status) => {
      expect(grantsAccess({ status, currentEnd: future })).toBe(true);
      expect(grantsAccess({ status, currentEnd: past })).toBe(false);
      expect(grantsAccess({ status, currentEnd: null })).toBe(false);
    }
  );

  it("grants nothing for a missing subscription or an unknown status", () => {
    expect(grantsAccess(null)).toBe(false);
    expect(grantsAccess(undefined)).toBe(false);
    expect(grantsAccess({ status: "SOMETHING_ELSE", currentEnd: future })).toBe(false);
  });

  it("takes the clock as an argument, so the boundary is testable", () => {
    const end = new Date("2026-06-01T00:00:00Z");
    expect(grantsAccess({ status: "CANCELLED", currentEnd: end }, new Date("2026-05-31T23:59:59Z"))).toBe(true);
    expect(grantsAccess({ status: "CANCELLED", currentEnd: end }, new Date("2026-06-01T00:00:01Z"))).toBe(false);
  });
});

describe("the one-live-subscription slot", () => {
  // Must match the partial unique index in the billing migration. If the two
  // disagree, either the service refuses a legitimate purchase or the database
  // refuses one the service allowed -- and both look like a bug in checkout.
  it("matches the states the migration's partial index names", () => {
    expect([...LIVE_STATUSES].sort()).toEqual(
      ["ACTIVE", "CANCEL_SCHEDULED", "PAST_DUE", "PAUSED", "PENDING"].sort()
    );
  });

  it("excludes the ended states, so somebody can subscribe again", () => {
    for (const status of ["CANCELLED", "COMPLETED", "EXPIRED"]) {
      expect(isLive(status)).toBe(false);
    }
  });
});

describe("provider timestamps", () => {
  it("reads seconds, not milliseconds", () => {
    expect(fromUnix(1_767_225_600)).toEqual(new Date(1_767_225_600_000));
  });

  it("treats a missing or zero timestamp as nothing rather than 1970", () => {
    expect(fromUnix(0)).toBeNull();
    expect(fromUnix(null)).toBeNull();
    expect(fromUnix(undefined)).toBeNull();
    expect(fromUnix("nonsense")).toBeNull();
  });
});
