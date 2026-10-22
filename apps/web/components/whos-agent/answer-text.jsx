"use client";

import { Fragment } from "react";

// The small amount of Markdown the assistant is asked to produce, rendered as
// React elements.
//
// Not a Markdown library, and not dangerouslySetInnerHTML. This is text from a
// language model, which is to say text partly shaped by whatever the person
// typed, and the one thing it must never be able to do is put markup into the
// page. Everything below produces elements and text nodes, so there is no
// parse step that could emit HTML and nothing to sanitise.
//
// The supported set is exactly what lib/ai/prompt.js asks for: paragraphs,
// '-' bullets, numbered lists, bold, inline code, and a small heading.
// Anything else is shown as the literal characters the model wrote, which is
// honest -- a stray pipe is better than a silently swallowed sentence.

// **bold**, `code`, and *emphasis*, in one pass so a nested pair cannot
// double-render. The capture groups stay in the split so the delimiters can be
// told apart by shape.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

const Inline = ({ text }) => (
  <>
    {text.split(INLINE).map((piece, index) => {
      if (!piece) return null;
      const key = `${index}-${piece.length}`;

      if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
        return (
          <strong key={key} className="font-semibold text-foreground">
            {piece.slice(2, -2)}
          </strong>
        );
      }
      if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {piece.slice(1, -1)}
          </code>
        );
      }
      if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) {
        return <em key={key}>{piece.slice(1, -1)}</em>;
      }
      return <Fragment key={key}>{piece}</Fragment>;
    })}
  </>
);

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

// Consecutive lines of the same kind become one list; everything else is its
// own paragraph. Blank lines separate blocks, and a single newline inside a
// paragraph is kept as a line break rather than collapsed, because the model
// uses one to lay out a short set of figures.
const blocksOf = (text) => {
  const blocks = [];
  let list = null;

  for (const raw of String(text).split("\n")) {
    const lineIsBullet = BULLET.test(raw);
    const lineIsNumber = !lineIsBullet && NUMBERED.test(raw);
    const kind = lineIsBullet ? "ul" : lineIsNumber ? "ol" : null;

    if (kind) {
      const item = raw.replace(lineIsBullet ? BULLET : NUMBERED, "");
      if (list?.kind === kind) list.items.push(item);
      else {
        list = { kind, items: [item] };
        blocks.push(list);
      }
      continue;
    }

    list = null;

    if (!raw.trim()) {
      blocks.push({ kind: "gap" });
      continue;
    }
    if (HEADING.test(raw)) {
      blocks.push({ kind: "h", text: raw.replace(HEADING, "") });
      continue;
    }

    const previous = blocks[blocks.length - 1];
    // A newline that is not a blank line continues the paragraph above it.
    if (previous?.kind === "p") previous.lines.push(raw);
    else blocks.push({ kind: "p", lines: [raw] });
  }

  return blocks.filter((block) => block.kind !== "gap");
};

const AnswerText = ({ text }) => {
  const blocks = blocksOf(text);

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;

        if (block.kind === "h") {
          return (
            <h4 key={key} className="pt-1 text-sm font-semibold text-foreground">
              <Inline text={block.text} />
            </h4>
          );
        }
        if (block.kind === "ul" || block.kind === "ol") {
          const List = block.kind === "ul" ? "ul" : "ol";
          return (
            <List
              key={key}
              className={
                block.kind === "ul"
                  ? "list-outside list-disc space-y-1 pl-4 marker:text-muted-foreground"
                  : "list-outside list-decimal space-y-1 pl-4 marker:text-muted-foreground"
              }
            >
              {block.items.map((item, i) => (
                <li key={i}>
                  <Inline text={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((lineText, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                <Inline text={lineText} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};

export default AnswerText;
