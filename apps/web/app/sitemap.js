import { siteUrl } from "@/lib/site";
import { publishedPosts } from "@/lib/blog/posts";
import { TOOL_SLUGS } from "@/lib/tools/registry";

// Computed per request, not prerendered.
//
// Next treats both of these as static by default and bakes them at build
// time -- which reads SITE_URL from the build machine, not the running one.
// A single image promoted from staging to production would then keep
// whatever the builder saw: in practice "Disallow: /" and a sitemap full of
// localhost URLs, served with a 200 and no error anywhere. Per request they
// read the environment they are actually running in.
export const dynamic = "force-dynamic";


// The public map of the site.
//
// Built from the same sources the pages themselves render from -- the blog
// registry and the tool registry -- rather than a hand-kept list. A sitemap
// that is a second copy of the routes is a sitemap that quietly starts
// advertising a page that no longer exists, and a 404 in a sitemap costs
// ranking on the pages that do.
//
// Only what a signed-out visitor can actually reach. Everything behind the
// auth middleware is absent, as is /demo: guest mode is a product tour that
// computes itself in the browser and has nothing stable for a crawler to
// index.
const STATIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.8, changeFrequency: "weekly" },
  { path: "/tools", priority: 0.8, changeFrequency: "monthly" },
  { path: "/open-source", priority: 0.6, changeFrequency: "monthly" },
  { path: "/careers", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/security", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.4, changeFrequency: "yearly" },
  { path: "/cookie-policy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/ai-usage", priority: 0.4, changeFrequency: "yearly" },
];

export default function sitemap() {
  const base = siteUrl();
  const now = new Date();

  const posts = publishedPosts().map((post) => ({
    url: `${base}/blog/${post.slug}`,
    // The post's own date, so a crawler is not told that everything changed
    // today every time the site is rebuilt.
    lastModified: new Date(`${post.date}T00:00:00Z`),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  const tools = TOOL_SLUGS.map((slug) => ({
    url: `${base}/tools/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    ...STATIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
      url: `${base}${path === "/" ? "" : path}`,
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...posts,
    ...tools,
  ];
}
