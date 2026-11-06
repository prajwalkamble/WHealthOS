import {
  Caveat,
  Geist,
  Hedvig_Letters_Serif,
  Inter,
  Kumbh_Sans,
  Montserrat,
  Outfit,
  Overpass_Mono,
  Plus_Jakarta_Sans,
  Poppins,
  PT_Sans,
  Roboto,
} from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { PreferencesProvider } from "@/components/preferences-provider";
import { siteUrl } from "@/lib/site";
import { OG_IMAGE } from "@/lib/brand/identity.mjs";
import PreferencesScript from "@/components/preferences-script";

// Every family the Font and Display Font settings offer, each exposed as a
// CSS variable that globals.css picks through --font-body / --font-display.
// Declaring a family does not download it: browsers fetch a webfont only when
// something on the page is actually set in it.
//
// Each call is written out in full on purpose: next/font reads these options
// at build time, so they have to be literals -- a shared object spread into
// them fails to compile.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
// No `weight` array, deliberately. Google published Roboto v51 as a VARIABLE
// font, and asking a variable family for three static weights makes the font
// service answer with its subset form -- a "/l/font?kit=...&skey=..." path
// whose URL carries more than one query entry. Turbopack's next/font replacer
// rejects that outright ("next/font/google queries have exactly one entry")
// and the dev server fails to compile this file.
//
// The host is deliberately not written out here: tests/cookie-policy.test.js
// greps every file under app/ and components/ for it, to keep the cookie
// policy's "no third-party webfonts" claim honest. next/font downloads these
// at build time and self-hosts them, so nothing is fetched from Google at
// runtime -- but the guard is a blunt string match and is more valuable blunt
// than clever.
//
// Omitting it takes the variable axis instead, which covers 100-900: strictly
// more weights than the three that were pinned here, from one file.
//
// Poppins, PT Sans and Hedvig below are still static families, so their
// weight arrays are correct and are left alone.
const roboto = Roboto({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});
const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", variable: "--font-montserrat" });
const ptSans = PT_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-pt-sans",
});
const overpassMono = Overpass_Mono({ subsets: ["latin"], display: "swap", variable: "--font-overpass-mono" });
const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-jakarta" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-outfit" });
const kumbh = Kumbh_Sans({ subsets: ["latin"], display: "swap", variable: "--font-kumbh" });
// Only used for the handwritten aside on the pricing page. Declaring a family
// does not download it -- the browser fetches a webfont only when something is
// actually set in it.
const caveat = Caveat({ subsets: ["latin"], display: "swap", variable: "--font-caveat" });
const hedvig = Hedvig_Letters_Serif({
  subsets: ["latin"],
  display: "swap",
  weight: ["400"],
  variable: "--font-hedvig",
});

const fontVariables = [
  inter,
  roboto,
  poppins,
  montserrat,
  ptSans,
  overpassMono,
  geist,
  jakarta,
  outfit,
  kumbh,
  hedvig,
  caveat,
]
  .map((font) => font.variable)
  .join(" ");

// metadataBase is what turns a relative Open Graph image into the absolute
// URL that Slack, WhatsApp and X require -- without it Next warns at build
// time and a shared link renders bare. The title template means a page that
// sets only its own name still gets the product on the end of it.
export const metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "WHealthOS",
    template: "%s · WHealthOS",
  },
  description:
    "Understand your money and make smarter decisions with WHealthOS.",
  applicationName: "WHealthOS",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "WHealthOS",
    url: "/",
    title: "WHealthOS",
    description:
      "Understand your money and make smarter decisions with WHealthOS.",
    // The card declared no image at all, while twitter.card below asked for
    // `summary_large_image` -- so every link to the product rendered bare in
    // Slack, WhatsApp and X. Relative on purpose: metadataBase above turns it
    // into the absolute URL those scrapers require. Generated from the brand
    // identity by scripts/build-brand-assets.mjs.
    images: [
      { url: `/${OG_IMAGE.path}`, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: "WHealthOS" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WHealthOS",
    description:
      "Understand your money and make smarter decisions with WHealthOS.",
    images: [`/${OG_IMAGE.path}`],
  },
  // The signed-in app is disallowed in robots.txt; this is the same statement
  // for a crawler that followed a link straight into it.
  robots: { index: true, follow: true },
};

// Providers only. The header and footer belong to (marketing); the signed-in
// app has its own shell in (main).
//
// No ClerkProvider here. It used to wrap everything, which meant the landing
// page, the calculators and the legal pages all loaded Clerk's JavaScript,
// set its cookies and wrote to its localStorage for visitors with nothing to
// sign in to. It now lives in the layouts that actually need it: (auth) and
// (main) always, and (marketing) only for someone already signed in. The
// demo mounts none at all.
export default function RootLayout({ children }) {
  return (
    <>
      {/* suppressHydrationWarning: next-themes sets the theme class on <html>
          before React hydrates, which the server cannot predict. */}
      {/* The font variables belong on <html>: --font-body and --font-display
          are composed on :root, and a var() inside a custom property resolves
          where it is declared. On <body> the families were invisible to that
          declaration, so no font ever applied. */}
      <html lang="en" className={fontVariables} suppressHydrationWarning>
        <head>
          <PreferencesScript />
        </head>
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <PreferencesProvider>
              {children}
              <Toaster richColors />
            </PreferencesProvider>
          </ThemeProvider>
        </body>
      </html>
    </>
  );
}
