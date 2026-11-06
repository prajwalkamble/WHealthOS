import { describe, it, expect } from "vitest";
import { FEATURE_GROUPS } from "@/data/pricing";
import { ENTITLEMENT_KEYS } from "@/lib/billing/entitlements";
import {
  DEFAULT_PREFERENCES,
  SETTING_ENTITLEMENTS,
  SETTING_KEYS,
  changedSettings,
  normalise,
} from "@/lib/preferences";

const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features);
const plansFor = (key) => FEATURES.find((feature) => feature.key === key)?.plans ?? [];

describe("every setting declares which side of the paywall it is on", () => {
  it("covers every setting, and invents none", () => {
    // A new setting has to say. Without this a tenth control could ship with
    // no entry, fall through the filter and be free by accident.
    expect(Object.keys(SETTING_ENTITLEMENTS).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("names real entitlements", () => {
    for (const [setting, key] of Object.entries(SETTING_ENTITLEMENTS)) {
      if (key === null) continue;
      expect(ENTITLEMENT_KEYS, `${setting} -> ${key}`).toContain(key);
    }
  });

  it("only charges for settings the pricing page charges for", () => {
    for (const [setting, key] of Object.entries(SETTING_ENTITLEMENTS)) {
      if (key === null) continue;
      expect(
        plansFor(key),
        `${setting} is gated on ${key}, which the free plan includes`
      ).not.toContain("free");
    }
  });

  it("leaves the light/dark switch free, because the matrix does", () => {
    // theme.toggle is a Free row. The switch lives in the same card as nine
    // paid controls and the same action saves all ten, so this is the one
    // that must not be gated -- gating the action wholesale would take it
    // away from every free account.
    expect(SETTING_ENTITLEMENTS.colorSchema).toBeNull();
    expect(plansFor("theme.toggle")).toContain("free");
  });

  it("puts the paid controls behind the two rows that are sold", () => {
    expect(SETTING_ENTITLEMENTS.themeColor).toBe("appearance.customize");
    expect(SETTING_ENTITLEMENTS.font).toBe("appearance.customize");
    expect(SETTING_ENTITLEMENTS.sidebarVariant).toBe("dashboard.customize");
    expect(SETTING_ENTITLEMENTS.contentLayout).toBe("dashboard.customize");
  });
});

describe("gating follows what is changing, not what was posted", () => {
  it("sees nothing when nothing moved", () => {
    // The browser posts all ten settings on every save. If presence were the
    // test, a free account toggling dark mode would be refused because the
    // same body also carried an unchanged font.
    expect(changedSettings(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES })).toEqual([]);
  });

  it("sees only the setting that moved", () => {
    const after = { ...DEFAULT_PREFERENCES, colorSchema: "dark" };
    expect(changedSettings(DEFAULT_PREFERENCES, after)).toEqual(["colorSchema"]);
  });

  it("asks for nothing when only the free switch moved", () => {
    const after = { ...DEFAULT_PREFERENCES, colorSchema: "dark" };
    const needed = changedSettings(DEFAULT_PREFERENCES, after)
      .map((key) => SETTING_ENTITLEMENTS[key])
      .filter(Boolean);
    expect(needed).toEqual([]);
  });

  it("asks once for several settings behind one entitlement", () => {
    const after = { ...DEFAULT_PREFERENCES, themeColor: "blue", font: "mono" };
    const needed = new Set(
      changedSettings(DEFAULT_PREFERENCES, after)
        .map((key) => SETTING_ENTITLEMENTS[key])
        .filter(Boolean)
    );
    expect([...needed]).toEqual(["appearance.customize"]);
  });

  it("does not strip what an account already has", () => {
    // Somebody who set a paid option while enforcement was off keeps it. The
    // diff is against their stored preferences, so resending the same value
    // asks for nothing -- taking it back would be removing a feature without
    // the notice section 6 of the Terms promises.
    const stored = normalise({ ...DEFAULT_PREFERENCES, themeColor: "blue" });
    const resent = normalise({ ...stored, colorSchema: "dark" });
    expect(changedSettings(stored, resent)).toEqual(["colorSchema"]);
  });

  it("treats a missing value as the default rather than a change", () => {
    const partial = normalise({ colorSchema: "dark" });
    expect(partial.themeColor).toBe(DEFAULT_PREFERENCES.themeColor);
    expect(changedSettings(DEFAULT_PREFERENCES, partial)).toEqual(["colorSchema"]);
  });
});
