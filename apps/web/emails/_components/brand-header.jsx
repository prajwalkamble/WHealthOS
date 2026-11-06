import { Img, Section, Text } from "@react-email/components";
import * as React from "react";
import { BRAND_NAME, EMAIL_LOGO, INK } from "../../lib/brand/identity.mjs";
import { siteUrl } from "../../lib/site";

// The WHealthOS logo at the top of every email we send.
//
// A bitmap, and the only surface that gets one. Email clients cannot render
// inline SVG -- Gmail strips the element entirely and Outlook's Word-based
// renderer ignores it -- so the lockup is served as the PNG that
// scripts/build-brand-assets.mjs generates from the same identity file the
// application, the PDF export and the favicon read. It is drawn at three times
// its displayed size so it stays sharp on a retina display, and the width and
// height attributes are explicit because Outlook does not size an image from
// CSS alone.
//
// Imports are relative, not "@/": these templates are also compiled by the
// react-email preview server (`pnpm email`), which does not read the jsconfig
// path aliases.

// Only a real, public origin.
//
// siteUrl() falls back to http://localhost:3000 when SITE_URL is unset, and a
// localhost image in a sent email is a broken image in somebody's inbox -- a
// grey box with a torn-corner icon where the brand should be. Worse, it is
// invisible in development, because locally the URL resolves. So the logo is
// used only when the deployment knows its own public address, and the wordmark
// is typeset otherwise.
export const logoSrc = () => {
  const origin = siteUrl();
  if (!/^https:\/\//i.test(origin)) return null;
  if (/\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(origin)) return null;
  return `${origin}/${EMAIL_LOGO.path}`;
};

/**
 * @param {{ align?: "left" | "center" }} props
 *   Follows the template it sits in. The report emails centre their heading,
 *   so a left-aligned logo above one reads as a mistake; the maintainer-facing
 *   templates are left-aligned throughout and keep the letterhead.
 */
export default function BrandHeader({ align = "left" }) {
  const src = logoSrc();
  const centred = align === "center";

  return (
    <Section style={{ ...styles.header, textAlign: align }}>
      {src ? (
        // alt carries the name for the many clients that block images by
        // default, and for a screen reader.
        <Img
          src={src}
          alt={BRAND_NAME}
          width={EMAIL_LOGO.width}
          height={EMAIL_LOGO.height}
          // `display:block` with auto side margins is how an image is centred
          // in mail: text-align on the parent does not reach a block-level
          // image, and Outlook ignores flexbox entirely.
          style={centred ? { ...styles.logo, margin: "0 auto" } : styles.logo}
        />
      ) : (
        <Text style={{ ...styles.wordmark, textAlign: align }}>{BRAND_NAME}</Text>
      )}
    </Section>
  );
}

const styles = {
  header: {
    padding: "0 0 20px",
  },
  logo: {
    display: "block",
    border: "0",
    outline: "none",
    textDecoration: "none",
  },
  wordmark: {
    margin: "0",
    fontSize: "20px",
    fontWeight: "600",
    letterSpacing: "-0.02em",
    color: INK,
  },
};
