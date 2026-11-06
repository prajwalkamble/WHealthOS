import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { siteUrl, isCanonicalHost, absoluteUrl } from "@/lib/site";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { publishedPosts } from "@/lib/blog/posts";
import { TOOL_SLUGS } from "@/lib/tools/registry";

const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

const ENV_KEYS = ["SITE_URL", "NEXT_PUBLIC_SITE_URL", "NODE_ENV"];
const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restore = () => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
};

describe("the canonical origin", () => {
  afterEach(restore);

  it("falls back to localhost rather than guessing a production domain", () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("accepts a bare host and normalises a trailing slash", () => {
    process.env.SITE_URL = "whealthos.example/";
    expect(siteUrl()).toBe("https://whealthos.example");
    process.env.SITE_URL = "https://whealthos.example///";
    expect(siteUrl()).toBe("https://whealthos.example");
  });

  it("ignores a value it cannot parse instead of emitting a broken URL", () => {
    process.env.SITE_URL = "not a url at all";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => new URL(siteUrl())).not.toThrow();
  });

  it("builds absolute URLs for Open Graph", () => {
    process.env.SITE_URL = "https://whealthos.example";
    expect(absoluteUrl("/pricing")).toBe("https://whealthos.example/pricing");
  });

  it("is read on the server, not inlined into the browser bundle", () => {
    // NEXT_PUBLIC_ variables are replaced at BUILD time. A public one here
    // would be baked from the build machine, so a single image promoted to
    // production would serve the builder's value -- "Disallow: /" and a
    // sitemap of localhost URLs, with a 200 and no error.
    const source = read("lib/site.js");
    expect(source).toContain("process.env.SITE_URL");
    expect(source).toMatch(/NOT NEXT_PUBLIC_SITE_URL/i);
  });
});

describe("robots.txt", () => {
  afterEach(restore);

  const asProduction = (url) => {
    process.env.NODE_ENV = "production";
    if (url) process.env.SITE_URL = url;
    else {
      delete process.env.SITE_URL;
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
    return robots();
  };

  it("keeps a staging or preview copy out of the index entirely", () => {
    const result = asProduction(null);
    expect(result.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(result.sitemap).toBeUndefined();
  });

  it("allows the real site and points at its sitemap", () => {
    const result = asProduction("https://whealthos.example");
    expect(result.rules[0].allow).toBe("/");
    expect(result.sitemap).toBe("https://whealthos.example/sitemap.xml");
  });

  it("disallows every signed-in area", () => {
    const { rules } = asProduction("https://whealthos.example");
    const disallowed = rules[0].disallow;
    for (const route of [
      "/api/",
      "/dashboard",
      "/transactions",
      "/accounts",
      "/cards",
      "/budgets",
      "/goals",
      "/analytics",
      "/settings",
      "/billing",
      "/welcome",
    ]) {
      expect(disallowed, `${route} must not be crawlable`).toContain(route);
    }
  });

  it("is computed per request, not baked at build time", () => {
    expect(read("app/robots.js")).toContain('export const dynamic = "force-dynamic"');
    expect(read("app/sitemap.js")).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("sitemap.xml", () => {
  afterEach(restore);

  const build = () => {
    process.env.SITE_URL = "https://whealthos.example";
    return sitemap();
  };

  it("lists every published post and every tool, from their own registries", () => {
    const urls = build().map((entry) => entry.url);
    for (const post of publishedPosts()) {
      expect(urls).toContain(`https://whealthos.example/blog/${post.slug}`);
    }
    for (const slug of TOOL_SLUGS) {
      expect(urls).toContain(`https://whealthos.example/tools/${slug}`);
    }
  });

  it("never advertises a route that needs a session", () => {
    const urls = build().map((entry) => entry.url);
    for (const url of urls) {
      expect(
        /\/(dashboard|settings|transactions|accounts|cards|budgets|goals|analytics|billing|welcome|api|sign-in|sign-up)(\/|$)/.test(url),
        `${url} requires a session and must not be in the sitemap`
      ).toBe(false);
    }
  });

  it("does not advertise the demo, which has nothing stable to index", () => {
    expect(build().map((e) => e.url)).not.toContain("https://whealthos.example/demo");
  });

  it("every entry is an absolute URL on the configured host", () => {
    for (const entry of build()) {
      expect(() => new URL(entry.url)).not.toThrow();
      expect(entry.url.startsWith("https://whealthos.example")).toBe(true);
    }
  });

  it("dates a post from the post, not from the build", () => {
    const [post] = publishedPosts();
    const entry = build().find((e) => e.url.endsWith(`/blog/${post.slug}`));
    expect(entry.lastModified.toISOString().slice(0, 10)).toBe(post.date);
  });
});

describe("social previews can resolve an image", () => {
  it("the root layout sets metadataBase", () => {
    const layout = read("app/layout.js");
    expect(layout).toContain("metadataBase: new URL(siteUrl())");
    expect(layout).toContain("openGraph");
    expect(layout).toContain("twitter");
  });
});
