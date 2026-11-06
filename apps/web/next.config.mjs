/** @type {import('next').NextConfig} */
const nextConfig = {
  // A build and `next dev` cannot share .next -- building over a running dev
  // server corrupts it, and the failures afterwards point anywhere but here.
  // Setting NEXT_DIST_DIR lets a verification build run beside a dev server
  // someone is using: `NEXT_DIST_DIR=.next-build pnpm build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "randomuser.me",
      },
    ],
  },

  // pdfkit reads its standard-font metrics (.afm) from its own package
  // directory at runtime, and exceljs ships prebuilt CommonJS. Bundling
  // either into the server output breaks those file lookups, so both stay
  // external and are required from node_modules.
  serverExternalPackages: ["pdfkit", "exceljs"],

  eslint: {
    // `next lint` cannot read a flat eslint.config.mjs in Next 15 -- it fails
    // with "Cannot serialize key \"parse\" in \"parser\"" and is removed in
    // Next 16 regardless. Linting runs as its own step: `pnpm lint`.
    ignoreDuringBuilds: true,
  },

  // Response headers applied to every route.
  //
  // No Content-Security-Policy. A real one here has to allow Clerk's script,
  // its frames and its XHR hosts, the Inngest endpoint and Next's own inline
  // bootstrap, and a CSP that is wrong does not degrade -- it blanks the app
  // for everyone. It is worth doing properly and separately, with a
  // report-only rollout, rather than guessed at here. X-Frame-Options covers
  // the clickjacking case in the meantime.
  async headers() {
    const headers = [
      // Stops the browser second-guessing a declared Content-Type, which is
      // what turns an uploaded file into an executed script.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // No framing at all. Nothing here is meant to be embedded.
      { key: "X-Frame-Options", value: "DENY" },
      // Send the origin cross-site, the full path same-site. Account pages
      // carry record ids in the path and those should not leak in a Referer.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Features this app does not use. camera stays allowed for ourselves:
      // the receipt input offers "take a photo" on a phone.
      //
      // payment is delegated to Razorpay's checkout origin rather than being
      // denied outright. Razorpay Standard Checkout runs in an iframe it
      // injects itself, and the Payment Request API behind its UPI and
      // Google Pay options is gated on this header -- with `payment=()` those
      // methods disappear from the modal and nothing explains why. `self` is
      // listed because the injected frame is same-origin until it navigates.
      {
        key: "Permissions-Policy",
        value:
          'camera=(self), microphone=(), geolocation=(), ' +
          'payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com"), ' +
          "usb=(), interest-cohort=()",
      },
    ];

    // HSTS only where there is TLS to insist on. Sending it from a local dev
    // server pins http://localhost to https for the browser's whole profile.
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      });
    }

    return [{ source: "/:path*", headers }];
  },

  experimental: {
    serverActions: {
      // Vercel caps request bodies at 4.5 MB whatever this says; the receipt
      // scanner shrinks images to stay under 4 MB before uploading.
      bodySizeLimit: "4.5mb",
    },

    // How long a navigation will reuse an already-fetched page from the
    // client Router Cache instead of asking the server again. This is what
    // makes the hover prefetch in components/navigation worth doing: Next 15
    // defaults `dynamic` to 0, which marks a dynamic page stale the instant
    // it arrives, so a payload fetched on hover would be thrown away and
    // refetched on the click a moment later.
    //
    // 30s is the Next 14 default, restored deliberately rather than raised
    // further. Every page under (main) shows money, and the figure somebody
    // reads has to be the figure in the database -- so the window is long
    // enough to cover hover-then-click and a glance back at a page just
    // visited, and short enough that nothing goes visibly out of date.
    //
    // Mutations do not wait for it to expire: the server actions in actions/
    // call revalidatePath on every write, which drops the matching entries
    // immediately. The risk this leaves is narrow -- a write from somewhere
    // else, another tab or a webhook, within the window.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
