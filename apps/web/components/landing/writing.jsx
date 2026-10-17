import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { COMPANY_LINKS } from "@/lib/company/links";
import { formatPostDate, publishedPosts } from "@/lib/blog/posts";
import Section, { BODY, CARD } from "./section";

// What has actually been published.
//
// Read from lib/blog/posts.js through publishedPosts(), which filters on
// `status` -- so a draft can never reach this section, and neither can a post
// with no date. There are no placeholder cards here and no invented
// publication dates: if nothing is published, the section does not render at
// all rather than showing three grey rectangles.
//
// Two posts is two cards. A third slot filled with a draft, or with a link to
// something that does not exist yet, would be exactly the thing the posts file
// was written to prevent.
const Writing = () => {
  const posts = publishedPosts();
  if (posts.length === 0) return null;

  return (
    <Section
      id="writing"
      eyebrow="Writing"
      title="How it is built, in the open"
      lead="Notes on the decisions behind WHealthOS — what the code does and why, written from the repository rather than around it."
    >
      <ul className="mt-12 grid gap-5 md:grid-cols-2">
        {posts.map((post) => (
          <li key={post.slug}>
            <article className={`group relative flex h-full flex-col ${CARD} p-7 transition-colors hover:border-foreground/25`}>
              <p className="text-sm text-muted-foreground">
                <time dateTime={post.date}>{formatPostDate(post.date)}</time>
              </p>

              <h3 className="mt-3 text-balance text-xl font-semibold leading-snug tracking-tight">
                {/* The whole card is the target through the pseudo-element,
                    while the accessible name stays the title alone. */}
                <Link
                  href={`${COMPANY_LINKS.blog}/${post.slug}`}
                  className="after:absolute after:inset-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {post.title}
                </Link>
              </h3>

              <p className={`mt-3 ${BODY}`}>{post.description}</p>
            </article>
          </li>
        ))}
      </ul>

      <p className="mt-7 text-base text-muted-foreground">
        <Link
          href={COMPANY_LINKS.blog}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Everything published so far
          <ArrowUpRight aria-hidden className="h-4 w-4" />
        </Link>
      </p>
    </Section>
  );
};

export default Writing;
