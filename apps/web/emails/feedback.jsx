import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import BrandHeader from "./_components/brand-header";
import { APP_TIME_ZONE } from "../lib/time";

// Dates in the application's timezone, not the server's. This is rendered by a
// background job on a UTC clock, and formatting without a zone puts an evening
// submission on the previous day for the people who sent it.
const dateLabel = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(date);
};

// Feedback sent from the widget in the app. Plain on purpose: this one is read
// by the maintainer, not by a user, so what matters is who wrote it, what kind
// of report it is, and the message itself, unaltered.
export default function FeedbackEmail({
  label = "Feedback",
  message = "",
  from = "A WHealthOS user",
  replyTo = null,
  // The stored row's id and the moment it was submitted. Both optional, so a
  // model assembled before feedback had a table -- or by a test -- renders
  // exactly as it did. The id is what makes a reply about a specific piece of
  // feedback possible: it is the row to look up, and it is in no other copy of
  // this message.
  feedbackId = null,
  submittedAt = null,
}) {
  const submitted = submittedAt ? dateLabel(submittedAt) : null;

  return (
    <Html>
      <Head />
      <Preview>
        {label} from {from}
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <BrandHeader />
          <Heading style={styles.title}>{label}</Heading>

          <Section>
            <Text style={styles.meta}>
              From: {from}
              {replyTo ? ` (${replyTo})` : " (no email address on file)"}
            </Text>
            {submitted ? (
              <Text style={styles.meta}>Submitted: {submitted}</Text>
            ) : null}
            {feedbackId ? (
              // Deliberately the last line and in the quiet style: it is for
              // whoever needs to find the row, not for reading.
              <Text style={styles.meta}>Reference: {feedbackId}</Text>
            ) : null}
          </Section>

          <Hr style={styles.rule} />

          {/* pre-wrap: the message is kept exactly as it was typed, including
              blank lines, rather than collapsed into one paragraph. */}
          <Text style={styles.message}>{message}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: "#f6f9fc",
    fontFamily: "-apple-system, sans-serif",
  },
  container: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "24px",
    borderRadius: "8px",
    maxWidth: "600px",
  },
  title: {
    color: "#1f2937",
    fontSize: "20px",
    margin: "0 0 4px",
  },
  meta: {
    color: "#6b7280",
    fontSize: "13px",
    margin: "0",
  },
  rule: {
    borderColor: "#e5e7eb",
    margin: "16px 0",
  },
  message: {
    color: "#1f2937",
    fontSize: "15px",
    lineHeight: "1.6",
    whiteSpace: "pre-wrap",
    margin: "0",
  },
};
