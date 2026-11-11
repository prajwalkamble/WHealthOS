import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import BrandHeader from "./_components/brand-header";
import { INK, INK_MUTED, RAMP, RAMP_END, RAMP_START, RULE } from "../lib/brand/identity.mjs";

// The subscription confirmation email.
//
// Rendered from the model that lib/notifications/subscription-email.js builds
// out of verified records. This file decides how the information looks and
// nothing about what it is: there is no formatting of money here, no date
// arithmetic, no plan names and no feature copy. A field that arrives null is
// a row that is not rendered, which is how "only display information that has
// been verified" is enforced in one place instead of thirteen.
//
// Every value goes through JSX, so React escapes it. There is no
// dangerouslySetInnerHTML in this file and there must not be: the plan name
// and the user's own name are the two values a person can influence, and an
// email body is HTML delivered to a third-party renderer.
//
// Imports are relative, not "@/": these templates are also compiled by the
// react-email preview server (`pnpm email`), which does not read the jsconfig
// path aliases.

// The brand ramp as a CSS gradient, with a solid fallback underneath it.
//
// Outlook's Word renderer ignores background-image entirely and Gmail's
// clients vary, so every gradient here sits on top of a backgroundColor that
// looks deliberate on its own. A gradient that degrades to white is a
// gradient that breaks the design in the client with the largest share.
const rampCss = `linear-gradient(90deg, ${RAMP.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})`;

// One row of the details block.
//
// `last` rather than a :last-child rule, because email clients do not
// reliably support structural selectors -- and because which row is last
// depends on which values were established, not on the order they are
// written in. A rule under the final row with the box's own border below it
// reads as an unfinished table.
const Detail = ({ label, value, last }) => (
  <Row style={last ? styles.detailRowLast : styles.detailRow}>
    <Column style={styles.detailLabel}>
      <Text style={styles.detailLabelText}>{label}</Text>
    </Column>
    <Column style={styles.detailValue}>
      <Text style={styles.detailValueText}>{value}</Text>
    </Column>
  </Row>
);

/**
 * @param {{ model: import("../lib/notifications/subscription-email").ActivationModel }} props
 */
export default function SubscriptionConfirmationEmail({ model = {} }) {
  const {
    kind,
    userName,
    recipientEmail,
    planName,
    statusLabel,
    startDate,
    renewalDate,
    renews,
    billingCycle,
    renewalCadence,
    amount,
    paidOn,
    paymentReference,
    features,
    links = {},
    supportEmail,
  } = model;

  // Whether this is the plan-change letter rather than the activation one.
  // Defaults to the activation wording, so a model written before this field
  // existed -- or one assembled by a test -- reads exactly as it did.
  const planChanged = kind === "plan-change";

  // What this tier adds over the one below it. The inherited features are not
  // listed: a confirmation email that lists all twenty features equally tells
  // somebody nothing about what they just bought.
  const unlocked = features?.added ?? [];

  // Built as a list and filtered, rather than nine conditionals in the
  // markup. A row whose value could not be established is not rendered at
  // all -- §3 of the brief: only information that has been verified -- and
  // filtering first is also what lets the last remaining row know it is last.
  const details = [
    { label: "Plan", value: planName },
    { label: "Status", value: statusLabel },
    {
      label: "Billing cycle",
      value:
        billingCycle && renewalCadence
          ? `${billingCycle} — billed ${renewalCadence}`
          : billingCycle,
    },
    { label: "Started", value: startDate },
    { label: renews ? "Renews on" : "Access until", value: renewalDate },
    { label: "Amount paid", value: amount },
    { label: "Paid on", value: paidOn },
    { label: "Payment reference", value: paymentReference },
    { label: "Account", value: recipientEmail },
  ].filter((row) => Boolean(row.value));

  return (
    <Html>
      <Head />
      {/* The preheader: what a mail client shows beside the subject. Without
          one, clients pull the first text in the body, which would be the
          logo's alt text. */}
      <Preview>
        {planName
          ? `Your WHealthOS ${planName} subscription is now active.`
          : "Your WHealthOS subscription is now active."}
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* The ramp as a hairline across the top of the card. The one place
              a gradient earns its keep in a document that is otherwise
              deliberately plain. */}
          <Section style={styles.rampBar} />

          <Section style={styles.card}>
            <BrandHeader align="left" />

            {/* The only part of this template that differs between the two
                letters it sends. A plan change is reported as something that
                has already happened -- the cycle has turned and the new price
                has been charged -- where an activation is a thank-you. Every
                section below is identical for both, because the questions are
                the same: what plan, what did it cost, when does it renew, and
                what do I now have. */}
            <Heading style={styles.title}>
              {planChanged
                ? planName
                  ? `Your WHealthOS plan is now ${planName}`
                  : "Your WHealthOS plan has changed"
                : "Your WHealthOS subscription is now active!"}
            </Heading>

            <Text style={styles.lede}>
              {planChanged ? (
                <>
                  {userName ? `${userName}, ` : ""}
                  the plan change you scheduled has taken effect at the end of
                  your billing period.{" "}
                  {planName
                    ? `Your subscription continues without interruption, now on ${planName} at the price below.`
                    : "Your subscription continues without interruption, at the plan and price below."}
                </>
              ) : (
                <>
                  {userName
                    ? `Thank you, ${userName}. `
                    : "Thank you for choosing WHealthOS. "}
                  {planName
                    ? `Your ${planName} plan has been activated and everything on it is available right now.`
                    : "Your subscription has been activated and everything on it is available right now."}
                </>
              )}
            </Text>

            <Section style={styles.ctaSection}>
              <Button href={links.dashboard} style={styles.button}>
                Go to WHealthOS Dashboard
              </Button>
            </Section>

            {/* --- What was bought ------------------------------------- */}

            <Section style={styles.details}>
              <Text style={styles.detailsTitle}>Subscription details</Text>
              {details.map((row, index) => (
                <Detail
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  last={index === details.length - 1}
                />
              ))}
            </Section>

            {/* --- What it unlocks ------------------------------------- */}

            {unlocked.length > 0 && (
              <Section style={styles.features}>
                <Text style={styles.detailsTitle}>
                  {planName ? `What ${planName} adds` : "What your plan adds"}
                </Text>
                {unlocked.map((feature) => (
                  <div key={feature.key} style={styles.feature}>
                    <Text style={styles.featureLabel}>{feature.label}</Text>
                    {feature.hint ? (
                      <Text style={styles.featureHint}>{feature.hint}</Text>
                    ) : null}
                  </div>
                ))}
              </Section>
            )}

            {links.manage ? (
              <Text style={styles.manage}>
                You can review or cancel your subscription any time from{" "}
                <Link href={links.manage} style={styles.link}>
                  your account settings
                </Link>
                .
              </Text>
            ) : null}

            <Hr style={styles.rule} />

            {/* --- Footer ---------------------------------------------- */}

            <Text style={styles.footer}>
              {supportEmail ? (
                <>
                  Questions about your billing? Write to{" "}
                  <Link href={`mailto:${supportEmail}`} style={styles.footerLink}>
                    {supportEmail}
                  </Link>
                  .
                </>
              ) : null}
            </Text>
            <Text style={styles.footer}>
              {links.terms ? (
                <Link href={links.terms} style={styles.footerLink}>
                  Terms of Service
                </Link>
              ) : null}
              {links.terms && links.privacy ? " · " : null}
              {links.privacy ? (
                <Link href={links.privacy} style={styles.footerLink}>
                  Privacy Policy
                </Link>
              ) : null}
            </Text>
            <Text style={styles.footerQuiet}>
              WHealthOS — personal finance, kept in one place. This is a
              transactional email about your subscription, sent to the address
              on your account.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: "#f6f9fc",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: "0",
    padding: "24px 0",
  },
  container: {
    margin: "0 auto",
    maxWidth: "600px",
    width: "100%",
  },
  // 4px of brand across the top. backgroundColor first so the client that
  // drops the gradient still gets a brand-coloured bar.
  rampBar: {
    height: "4px",
    lineHeight: "4px",
    fontSize: "0",
    backgroundColor: RAMP_START,
    backgroundImage: rampCss,
    borderRadius: "8px 8px 0 0",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: "32px",
    borderRadius: "0 0 8px 8px",
  },
  title: {
    color: INK,
    fontSize: "24px",
    lineHeight: "32px",
    fontWeight: "700",
    letterSpacing: "-0.01em",
    margin: "8px 0 12px",
  },
  lede: {
    color: INK_MUTED,
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 24px",
  },
  ctaSection: {
    margin: "0 0 28px",
  },
  // Solid first, gradient on top: the same degradation rule as the bar. The
  // explicit padding and display are what make a styled <a> look like a
  // button in clients that do not support padding on inline elements.
  button: {
    backgroundColor: RAMP_END,
    backgroundImage: rampCss,
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "15px",
    fontWeight: "600",
    lineHeight: "20px",
    padding: "13px 24px",
    textDecoration: "none",
    textAlign: "center",
  },
  details: {
    border: `1px solid ${RULE}`,
    borderRadius: "8px",
    padding: "20px",
    margin: "0 0 24px",
  },
  detailsTitle: {
    color: INK,
    fontSize: "13px",
    fontWeight: "700",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    margin: "0 0 12px",
  },
  detailRow: {
    borderBottom: `1px solid ${RULE}`,
  },
  detailRowLast: {
    borderBottom: "0",
  },
  detailLabel: {
    verticalAlign: "top",
    width: "45%",
    paddingRight: "12px",
  },
  detailValue: {
    verticalAlign: "top",
    width: "55%",
    textAlign: "right",
  },
  detailLabelText: {
    color: INK_MUTED,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "10px 0",
  },
  detailValueText: {
    color: INK,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "600",
    margin: "10px 0",
  },
  features: {
    margin: "0 0 24px",
  },
  feature: {
    borderLeft: `3px solid ${RAMP_START}`,
    paddingLeft: "12px",
    margin: "0 0 14px",
  },
  featureLabel: {
    color: INK,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "600",
    margin: "0",
  },
  featureHint: {
    color: INK_MUTED,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "2px 0 0",
  },
  manage: {
    color: INK_MUTED,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "0 0 8px",
  },
  link: {
    color: RAMP_START,
    textDecoration: "underline",
  },
  rule: {
    borderColor: RULE,
    margin: "24px 0 16px",
  },
  footer: {
    color: INK_MUTED,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "0 0 6px",
  },
  footerLink: {
    color: INK_MUTED,
    textDecoration: "underline",
  },
  footerQuiet: {
    color: "#8b90a0",
    fontSize: "12px",
    lineHeight: "18px",
    margin: "10px 0 0",
  },
};
