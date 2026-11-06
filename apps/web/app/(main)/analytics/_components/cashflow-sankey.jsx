"use client";

// Cashflow, as a Sankey.
//
// The money maths is in lib/analytics.js (`cashflowSummary`) and runs on the
// server with the rows; this file only draws what it is handed. The split is
// deliberate -- nothing here adds, subtracts or reclassifies an amount.
//
// Read the note above `cashflowSummary` before changing the shape: the middle
// node exists because the ledger cannot say which income paid which expense,
// and drawing a ribbon straight from Salary to Housing would be an invention.
// Everything in flows into one pool and everything out flows from it.
//
// Recharts rather than a new dependency: it is already the app's chart library
// and it ships a real Sankey with a cubic-Bézier link shape, so there was
// nothing to add.
//
// Hovering is contextual focus, not selection: the hovered element and the
// ones the graph actually connects it to stay as they were, everything else
// fades back. Nothing moves, nothing resizes and no ribbon changes thickness
// -- the only property that animates is opacity. What counts as connected is
// read off the links in `cashflowDiagram`'s output (see `cashflowAdjacency`),
// never off a category name.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PrefetchLink from "@/components/navigation/prefetch-link";
import { Layer, Rectangle, Sankey } from "recharts";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartContainer } from "@/components/ui/chart";
import { categoryColors, defaultCategories } from "@/data/categories";
import {
  CASHFLOW_RANGES,
  DRAWN_FROM_BALANCES,
  POOL,
  SURPLUS,
  UNCATEGORIZED,
  cashflowDiagram,
} from "@/lib/analytics";
import { useCurrency } from "@/components/currency-provider";
import { formatCompactCurrency as defaultCompact } from "@/lib/currency/format";
import { cn } from "@/lib/utils";

const CATEGORY_NAME = new Map(defaultCategories.map((c) => [c.id, c.name]));

// Emerald for money that stayed, neutral for anything the ledger could not
// name. Both are CSS variables rather than hexes so they follow the theme;
// the category colours are data/categories.js's own, which is what the rest
// of the app already draws those categories in.
const POOL_COLOR = "hsl(160 84% 39%)";
const NEUTRAL_COLOR = "hsl(var(--muted-foreground))";

const labelFor = (key) => {
  if (key === POOL) return "Cash Flow";
  if (key === SURPLUS) return "Surplus";
  if (key === DRAWN_FROM_BALANCES) return "From balances";
  if (key === UNCATEGORIZED) return "Uncategorized";
  return CATEGORY_NAME.get(key) ?? key;
};

const colorFor = (key) => {
  if (key === POOL || key === SURPLUS) return POOL_COLOR;
  if (key === DRAWN_FROM_BALANCES || key === UNCATEGORIZED) return NEUTRAL_COLOR;
  return categoryColors[key] ?? NEUTRAL_COLOR;
};

// An element's identity, and the one thing the interaction is keyed on.
//
// Not the array index: the index of a category moves the moment the period
// changes, and a hover held across that change would then land on whatever
// row slid into the slot. Not the category key on its own either -- a category
// with both income and expense rows in the period appears on both sides of the
// pool, so the side has to be part of it.
const nodeId = (node) => `${node.side}:${node.key}`;

// A ribbon's gradient needs an id to be referenced by, and it has to be the
// same id on the server and in the browser -- a useId() value is derived from
// the component's position in the tree and has mismatched here before (see the
// note in components/ui/chart.jsx). This one is the link's own id with the
// characters a URL fragment cannot carry taken out, so it is a function of the
// data and of nothing else.
const gradientId = (id) => `cf-flow-${String(id).replace(/[^a-zA-Z0-9]+/g, "-")}`;

// The drawing's own view of the diagram: the lib's keys turned into the names
// and colours this chart paints them in, plus the ids above. Links carry their
// endpoints' ids and names so the tooltip never has to read an SVG label back
// out of the document to say what a ribbon is.
export function cashflowChartData(summary) {
  const { nodes, links } = cashflowDiagram(summary);
  const painted = nodes.map((node) => ({
    ...node,
    id: nodeId(node),
    name: labelFor(node.key),
    color: colorFor(node.key),
  }));

  return {
    nodes: painted,
    links: links.map((link) => {
      const source = painted[link.source];
      const target = painted[link.target];
      return {
        ...link,
        id: `${source.id}>${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        sourceName: source.name,
        targetName: target.name,
        color: colorFor(link.key),
        sourceColor: source.color,
        targetColor: target.color,
      };
    }),
  };
}

// Who is next to whom, computed once per diagram rather than per pointer move.
//
// One map holding both kinds of element: given the id of whatever is under the
// pointer it answers, in a single lookup, which nodes and which ribbons that
// element touches. A node's entry is itself, every ribbon that starts or ends
// at it, and the node at the far end of each of those. A ribbon's entry is
// itself and its two endpoints. There is no traversal beyond one hop because
// there is no second hop to make: every ribbon in this diagram has the pool at
// one end.
//
// Ids are the keys, so a period change rebuilds the map and any id held from
// before it simply misses.
export function cashflowAdjacency({ nodes, links }) {
  const map = new Map();

  for (const node of nodes) {
    map.set(node.id, { nodes: new Set([node.id]), links: new Set() });
  }

  for (const link of links) {
    const source = map.get(link.sourceId);
    const target = map.get(link.targetId);
    if (!source || !target) continue;

    source.links.add(link.id);
    target.links.add(link.id);
    source.nodes.add(link.targetId);
    target.nodes.add(link.sourceId);

    map.set(link.id, {
      nodes: new Set([link.sourceId, link.targetId]),
      links: new Set([link.id]),
    });
  }

  return map;
}

// What one element should look like, given what is active. "idle" is the
// chart at rest -- no hover anywhere -- and is deliberately distinct from
// "related", so nothing has to be dimmed for the chart to look untouched.
export function focusState(focus, id) {
  if (!focus) return "idle";
  if (focus.id === id) return "active";
  if (focus.nodes.has(id) || focus.links.has(id)) return "related";
  return "muted";
}

// What the tooltip says, taken from the data behind the element.
//
// Every ribbon and every node in this diagram is a share of the same pooled
// total -- in equals out by construction -- so one denominator covers the
// whole chart, and it is named outright rather than left to be guessed at.
// `formatCompact` is passed in rather than imported, because this is a pure
// function shared by the chart and its tests, and the currency it should
// format in is a property of who is looking -- not of this module.
//
// The default is the application default currency, for callers with no viewer
// to ask: the tests, and anything server-side. Every call from the chart
// passes the viewer's own formatter, so the default is never what somebody
// actually reads.
export function cashflowDetail(diagram, active, formatCompact = defaultCompact) {
  if (!active) return null;

  const pooled = diagram.nodes.find((node) => node.side === "pool")?.amount ?? 0;
  const share = (value) => {
    if (!(pooled > 0) || !(value > 0)) return "";
    const percent = (value / pooled) * 100;
    // A ₹200 category against ₹1.4L rounds to zero, and "0% of ₹1.4L pooled"
    // reads as nothing at all rather than as something small.
    const shown = percent < 1 ? "under 1%" : `${Math.round(percent)}%`;
    return `${shown} of ${formatCompact(pooled)} pooled`;
  };

  if (active.type === "link") {
    const link = diagram.links.find((row) => row.id === active.id);
    if (!link) return null;
    return {
      title: `${link.sourceName} → ${link.targetName}`,
      value: link.value,
      meta: share(link.value),
      // The swatch is the ribbon: the same two colours, the same way round.
      color:
        link.sourceColor && link.targetColor
          ? `linear-gradient(90deg, ${link.sourceColor}, ${link.targetColor})`
          : link.color,
    };
  }

  const node = diagram.nodes.find((row) => row.id === active.id);
  if (!node) return null;

  if (node.side === "pool") {
    return {
      title: node.name,
      value: node.amount,
      meta: "Everything in, then everything out",
      color: node.color,
    };
  }

  const context =
    node.key === SURPLUS
      ? "Not spent"
      : node.key === DRAWN_FROM_BALANCES
        ? "Drawn from money already held"
        : node.side === "source"
          ? "Money in"
          : "Money out";

  return {
    title: node.name,
    value: node.amount,
    meta: [context, share(node.amount)].filter(Boolean).join(" · "),
    color: node.color,
  };
}

// A node: its bar, then its name and amount on one line beside it.
//
// One line rather than two because the right-hand column can hold a dozen
// categories: a two-line label collides with its neighbour as soon as a
// category is small, and the small ones are exactly where the collisions
// start.
export const SankeyNode = ({ x, y, width, height, payload, focus }) => {
  // Its own hook call: Recharts constructs this element itself, so there is
  // no parent render here to pass a formatter down from.
  const { formatCompact: formatCompactCurrency } = useCurrency();
  const { side, name, amount, color } = payload;
  const state = focusState(focus, payload.id);
  const middle = y + height / 2;
  const compact = formatCompactCurrency(amount);

  // The bar is 9px wide and a small category's is a couple of pixels tall, so
  // the pointer gets a target rather than a sliver. It paints nothing and it
  // does not move the bar; the label beside it is hoverable in its own right,
  // being inside this group.
  const hitHeight = Math.max(height, 10);

  return (
    <Layer
      data-state={state}
      // Opacity is the only thing that changes, and it carries the label with
      // it: the text is inside this group. Unrelated nodes drop back far
      // enough to read as background without disappearing.
      className={cn(
        "transition-opacity duration-200 ease-out motion-reduce:transition-none",
        "data-[state=muted]:opacity-25 dark:data-[state=muted]:opacity-30"
      )}
    >
      <rect
        x={x - 6}
        y={middle - hitHeight / 2}
        width={width + 12}
        height={hitHeight}
        fill="none"
        pointerEvents="all"
      />
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        radius={[3, 3, 3, 3]}
        fill={color}
        fillOpacity={state === "active" ? 1 : 0.9}
      />
      {side === "pool" ? (
        // Above the bar, not beside it: the pool spans the full height of the
        // chart, so a label at its middle would sit on top of every ribbon
        // crossing the centre.
        <text x={x + width / 2} y={y - 10} textAnchor="middle" fontSize={11}>
          <tspan className="fill-foreground font-medium">{name}</tspan>
          <tspan
            className={state === "active" ? "fill-foreground" : "fill-muted-foreground"}
            dx="6"
          >
            {compact}
          </tspan>
        </text>
      ) : (
        <text
          x={side === "source" ? x - 10 : x + width + 10}
          y={middle}
          textAnchor={side === "source" ? "end" : "start"}
          dominantBaseline="middle"
          fontSize={11}
        >
          <tspan className="fill-foreground font-medium">{name}</tspan>
          <tspan
            className={state === "active" ? "fill-foreground" : "fill-muted-foreground"}
            dx="6"
          >
            {compact}
          </tspan>
        </text>
      )}
    </Layer>
  );
};

// A ribbon. Recharts hands over the Bézier control points it computed for the
// default link, so this is the library's own curve in the app's colours.
export const SankeyLink = ({
  sourceX,
  sourceY,
  sourceControlX,
  targetX,
  targetY,
  targetControlX,
  linkWidth,
  payload,
  focus,
}) => {
  const d = `M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  const state = focusState(focus, payload.id);

  // The ribbon carries the colour of the node it leaves into the colour of the
  // node it arrives at, so a flow reads as the same money changing hands
  // rather than as a category's colour stopping dead at the pool.
  //
  // The axis is horizontal and in user space, from the ribbon's own start to
  // its own end: every ribbon in a column therefore turns over at the same x,
  // which keeps a dozen of them looking like one diagram instead of a dozen
  // separately tinted ones. A ribbon with no endpoint colours -- which is only
  // possible if something hands this renderer data it did not build -- falls
  // back to the flat colour it used to have.
  const gradient =
    payload.sourceColor && payload.targetColor && payload.id
      ? gradientId(payload.id)
      : null;

  return (
    <Layer>
      {gradient && (
        <defs>
          <linearGradient
            id={gradient}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1="0"
            x2={targetX}
            y2="0"
          >
            <stop offset="0%" stopColor={payload.sourceColor} />
            <stop offset="100%" stopColor={payload.targetColor} />
          </linearGradient>
        </defs>
      )}
      <path
        className={cn(
          "cf-ribbon transition-[stroke-opacity] duration-200 ease-out motion-reduce:transition-none",
          // Faint at rest, and the ribbons have to stay well under the node
          // bars: a dozen opaque ones is a blur, not a chart. Dark needs more
          // of them -- the same 18% over a near-black card is a ribbon you
          // have to look for.
          //
          // Under the pointer the hovered ribbon comes forward, the ones
          // sharing a node with it come part of the way, and the rest drop to
          // a trace. Not to nothing: the shape of the whole cashflow should
          // still be legible while one part of it is being read. Every state
          // has a dark pair, so which rule wins is never left to two variants
          // of equal specificity and their order in the stylesheet.
          "[stroke-opacity:0.18] dark:[stroke-opacity:0.3]",
          "data-[state=active]:[stroke-opacity:0.5] dark:data-[state=active]:[stroke-opacity:0.6]",
          "data-[state=related]:[stroke-opacity:0.36] dark:data-[state=related]:[stroke-opacity:0.46]",
          "data-[state=muted]:[stroke-opacity:0.05] dark:data-[state=muted]:[stroke-opacity:0.08]"
        )}
        data-state={state}
        d={d}
        fill="none"
        stroke={gradient ? `url(#${gradient})` : payload.color}
        strokeWidth={Math.max(linkWidth, 1)}
      />
      {/* The pointer target, and nothing else: transparent, drawn over the
          ribbon it belongs to, and never narrower than a pointer can hit. A
          ₹200 category next to a ₹90,000 one is a hairline, and a hairline
          nobody can hover is a tooltip nobody can read. The visible ribbon
          above keeps its own width. */}
      <path
        className="cf-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(linkWidth, 8)}
      />
    </Layer>
  );
};

// Where the tooltip goes. Near the pointer, clamped so it cannot be clipped by
// the card or by the chart's own horizontal scroll: the clamp uses the box's
// full width, so a ribbon at the far right gets a tooltip pulled inwards
// rather than cut off. Above the pointer unless there is no room above, in
// which case below -- which also keeps it off the ribbon it is describing.
const TOOLTIP_WIDTH = 240;

export function placeTooltip({ x, y, width }) {
  const half = TOOLTIP_WIDTH / 2;
  const edge = half + 8;
  const above = y > 96;

  return {
    left: Math.min(Math.max(x, edge), Math.max(edge, width - edge)),
    top: above ? y - 14 : y + 20,
    above,
  };
}

const CashflowSankey = ({ cashflow, range, onRangeChange, busy = false }) => {
  // Bound to the display currency the viewer chose, so this chart, its
  // tooltips and its spoken summary all format in it.
  const { format: formatCurrency, formatCompact: formatCompactCurrency } = useCurrency();

  const { sources, destinations, income, expenses, net, surplus, drawnFromBalances, excluded } =
    cashflow;

  const hasFlow = sources.length > 0 || destinations.length > 0;

  // Both memoised on the period's own figures: the layout recompute and the
  // adjacency map belong to the data, not to the pointer. Hovering changes
  // `active` and nothing else, so neither is rebuilt while the pointer moves.
  const diagram = useMemo(() => cashflowChartData(cashflow), [cashflow]);
  const adjacency = useMemo(() => cashflowAdjacency(diagram), [diagram]);

  // The whole of the interaction state: what is active, and where it was
  // picked up. Hover, tap and the arrow keys all write the same three fields.
  const [active, setActive] = useState(null);
  const frame = useRef(null);

  const focus = useMemo(() => {
    if (!active) return null;
    const related = adjacency.get(active.id);
    return related ? { id: active.id, ...related } : null;
  }, [active, adjacency]);

  const detail = useMemo(
    () => cashflowDetail(diagram, active, formatCompactCurrency),
    [diagram, active, formatCompactCurrency]
  );

  const clear = useCallback(() => setActive(null), []);

  // The tooltip follows the pointer, and it does it by writing two style
  // properties on the one element rather than through React state.
  //
  // A mousemove that went through setState would re-render the Sankey sixty
  // times a second, and recharts rebuilds its whole layout on every render of
  // it -- a few hundred node and ribbon positions recomputed to move a box by
  // four pixels. What is active still lives in state; only where the pointer
  // is does not, and React rewrites both values from the event that activated
  // the element whenever it does render, so the two never disagree.
  const tip = useRef(null);
  const pending = useRef(0);

  const track = useCallback((event) => {
    const { clientX, clientY } = event;
    if (!tip.current || !frame.current || pending.current) return;

    // One write per frame, after the browser has settled the last one.
    pending.current = requestAnimationFrame(() => {
      pending.current = 0;
      if (!tip.current || !frame.current) return;

      const box = frame.current.getBoundingClientRect();
      const spot = placeTooltip({
        x: clientX - box.left,
        y: clientY - box.top,
        width: box.width,
      });

      tip.current.style.left = `${spot.left}px`;
      tip.current.style.top = `${spot.top}px`;
      tip.current.style.transform = spot.above
        ? "translate(-50%, -100%)"
        : "translate(-50%, 0)";
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(pending.current), []);

  const activate = useCallback((element, type, event) => {
    const id = element?.payload?.id;
    if (!id) return;

    const box = frame.current?.getBoundingClientRect();
    const point = {
      x: box && event ? event.clientX - box.left : (box?.width ?? 0) / 2,
      y: box && event ? event.clientY - box.top : 0,
      width: box?.width ?? 0,
    };

    // Re-entering what is already active keeps the state object it has, so
    // moving between a node's bar and its own label is not a re-render and
    // the tooltip does not twitch.
    setActive((prev) =>
      prev && prev.id === id && prev.type === type ? prev : { type, id, ...point }
    );
  }, []);

  const deactivate = useCallback((element) => {
    const id = element?.payload?.id;
    // Only the element that is actually active may clear the state. Leaving
    // one element and entering its neighbour arrives as leave-then-enter, and
    // both land in the same render -- so the highlight moves across without
    // a frame of nothing in between.
    setActive((prev) => (prev && (!id || prev.id === id) ? null : prev));
  }, []);

  // Escape clears, and so does a pointer going down anywhere outside the
  // chart -- which is how a tap on a phone puts the diagram back. Both are
  // only listened for while something is active.
  const isActive = active !== null;
  useEffect(() => {
    if (!isActive) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setActive(null);
    };
    const onPointerDown = (event) => {
      if (!frame.current?.contains(event.target)) setActive(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isActive]);

  // A new period is a new graph, and an id from the old one would either miss
  // or -- worse -- hit a different category. The highlight goes with it.
  useEffect(() => {
    setActive(null);
  }, [diagram]);

  // The keyboard's way in. The figure takes focus and the arrow keys step
  // along the nodes in drawing order, which highlights exactly what a hover
  // would and announces it through the live region below. There is no pointer
  // to anchor to, so the tooltip sits at the top of the chart.
  const stepNode = useCallback(
    (direction) => {
      const list = diagram.nodes;
      if (!list.length) return;

      const at = list.findIndex((node) => node.id === active?.id);
      const next =
        at < 0
          ? list[direction > 0 ? 0 : list.length - 1]
          : list[(at + direction + list.length) % list.length];

      const width = frame.current?.clientWidth ?? 0;
      setActive({ type: "node", id: next.id, x: width / 2, y: 0, width });
    },
    [active, diagram]
  );

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    stepNode(direction);
  };

  // Enough room for the busiest column, so no two labels have to share a line.
  const rows = Math.max(sources.length + (drawnFromBalances > 0 ? 1 : 0), destinations.length + (surplus > 0 ? 1 : 0));
  const chartHeight = Math.max(320, rows * 38 + 64);

  const rangeLabel = CASHFLOW_RANGES[range]?.label ?? "";

  // What a screen reader gets instead of the drawing. The same figures, in the
  // same order, with the sentence the diagram is making said out loud.
  const summary = hasFlow
    ? [
        `Cashflow, ${rangeLabel.toLowerCase()}.`,
        `Income ${formatCurrency(income)} from ${sources.length} ${
          sources.length === 1 ? "category" : "categories"
        }.`,
        `Expenses ${formatCurrency(expenses)} across ${destinations.length} ${
          destinations.length === 1 ? "category" : "categories"
        }.`,
        net >= 0
          ? `Surplus ${formatCurrency(surplus)}.`
          : `${formatCurrency(drawnFromBalances)} more was spent than came in.`,
        sources.length
          ? `Largest source ${labelFor(sources[0].key)}, ${formatCurrency(sources[0].amount)}.`
          : "",
        destinations.length
          ? `Largest expense ${labelFor(destinations[0].key)}, ${formatCurrency(destinations[0].amount)}.`
          : "",
        "Use the left and right arrow keys to read each part in turn.",
      ]
        .filter(Boolean)
        .join(" ")
    : `No cashflow for ${rangeLabel.toLowerCase()}.`;

  const position = active ? placeTooltip(active) : null;

  return (
    <section
      className="rounded-xl border bg-card p-4"
      aria-labelledby="cashflow-heading"
      aria-busy={busy || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="cashflow-heading" className="text-sm font-semibold">
            Cashflow
          </h2>
          <p className="text-xs text-muted-foreground">
            {rangeLabel} · in {formatCurrency(income)}, out {formatCurrency(expenses)}
          </p>
        </div>
        <Select value={range} onValueChange={onRangeChange}>
          <SelectTrigger className="h-8 w-[5.5rem]" aria-label="Cashflow period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {Object.entries(CASHFLOW_RANGES).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>
                {key}
                {/* The trigger has room for "30D" and no more, so the range it
                    actually means is said here for anyone who cannot see the
                    chart change. */}
                <span className="sr-only"> — {label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!hasFlow ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium">No cashflow data for this period</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Nothing was recorded in {rangeLabel.toLowerCase()}. Widen the period,
            or record a transaction and it will appear here.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <PrefetchLink href="/transaction/create">
              <Plus aria-hidden className="mr-1.5 h-4 w-4" />
              Add transaction
            </PrefetchLink>
          </Button>
        </div>
      ) : (
        <>
          {/* The drawing needs a width before the labels start colliding, and
              a phone does not have one. It scrolls sideways inside the card
              rather than squeezing, and the card itself never widens the
              page. */}
          <div
            className={cn(
              "mt-3 w-full overflow-x-auto transition-opacity",
              busy && "opacity-60"
            )}
          >
            {/* The frame the tooltip is positioned inside, and the box the
                pointer's coordinates are measured against. It is the chart's
                own box, so the two agree at any width and through the
                sideways scroll. */}
            <div
              ref={frame}
              className="relative min-w-[46rem]"
              onMouseMove={track}
              onMouseLeave={clear}
            >
              <figure
                role="img"
                aria-label={summary}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onBlur={clear}
                className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <ChartContainer
                  config={{}}
                  className="aspect-auto w-full"
                  style={{ height: chartHeight }}
                >
                  <Sankey
                    data={diagram}
                    node={<SankeyNode focus={focus} />}
                    link={<SankeyLink focus={focus} />}
                    nodeWidth={9}
                    nodePadding={18}
                    linkCurvature={0.5}
                    margin={{ top: 28, right: 168, bottom: 12, left: 150 }}
                    // Recharts binds these per node and per ribbon and hands
                    // back the element it was on, so the graph answers what is
                    // connected -- there is no hit-testing of our own and no
                    // mousemove handler anywhere.
                    onMouseEnter={activate}
                    onMouseLeave={deactivate}
                    onClick={activate}
                  />
                </ChartContainer>
              </figure>

              {/* Decoration for a screen reader -- the same words are in the
                  live region below -- and pointer-events-none so moving onto
                  it is impossible and there is nothing to flicker between. */}
              {detail && position && (
                <div
                  ref={tip}
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute z-10 w-max max-w-[15rem] rounded-lg border bg-popover/95 px-2.5 py-1.5 shadow-md backdrop-blur-sm",
                    // It fades in where it belongs rather than appearing
                    // outright -- the same fade the app's own popovers use --
                    // and from then on it is pinned to the pointer, so there
                    // is nothing to transition between: a duration on left and
                    // top would make it trail the cursor rather than follow
                    // it. The fade goes away under prefers-reduced-motion,
                    // which leaves the tooltip exactly where it would land.
                    "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
                    "motion-reduce:animate-none"
                  )}
                  style={{
                    left: position.left,
                    top: position.top,
                    transform: position.above
                      ? "translate(-50%, -100%)"
                      : "translate(-50%, 0)",
                  }}
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium text-popover-foreground">
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ background: detail.color }}
                    />
                    {detail.title}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-popover-foreground">
                    {formatCurrency(detail.value)}
                  </p>
                  {detail.meta && (
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {detail.meta}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Always in the document, so what it is given is announced rather
              than arriving with the element that holds it. */}
          <div role="status" aria-live="polite" className="sr-only">
            {detail
              ? `${detail.title}, ${formatCurrency(detail.value)}${
                  detail.meta ? `. ${detail.meta}` : ""
                }`
              : ""}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            {net >= 0
              ? `Surplus ${formatCurrency(surplus)} — what came in that was not spent.`
              : `${formatCurrency(drawnFromBalances)} more went out than came in, drawn from money already held.`}{" "}
            Income is pooled before it is spent: the ledger records what was
            earned and what was spent, not which paid for which.
          </p>

          {excluded.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {excluded.length}{" "}
              {excluded.length === 1 ? "category nets" : "categories net"} to zero
              or less over this period and {excluded.length === 1 ? "is" : "are"}{" "}
              not drawn.
            </p>
          )}
        </>
      )}
    </section>
  );
};

export default CashflowSankey;
