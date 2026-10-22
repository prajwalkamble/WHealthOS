// The Sankey actually draws, and what it does under a pointer.
//
// The maths is covered in analytics.test.js; this is the other half -- that
// the renderers hand recharts something it can lay out, that what comes back
// is a real Sankey rather than an empty <svg>, and that the hover highlighting
// follows the graph's own links. It renders the chart to static markup, which
// is as close to looking at it as a node environment gets: the Analytics page
// is behind Clerk, so there is no unauthenticated route that shows this chart
// in a browser.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sankey } from "recharts";

const { cashflowSummary, POOL, SURPLUS, DRAWN_FROM_BALANCES } = await import(
  "@/lib/analytics"
);
const {
  SankeyNode,
  SankeyLink,
  cashflowChartData,
  cashflowAdjacency,
  cashflowDetail,
  focusState,
  placeTooltip,
} = await import("@/app/(main)/analytics/_components/cashflow-sankey");
const { defaultCategories } = await import("@/data/categories");

const KNOWN = new Set(defaultCategories.map((c) => c.id));
const tx = (type, amount, category, date) => ({
  type,
  amount,
  category,
  date: new Date(date),
});

const diagramOf = (rows) =>
  cashflowChartData(cashflowSummary(rows, { knownCategories: KNOWN }));

const draw = (rows, focus = null) => {
  const diagram = diagramOf(rows);
  return renderToStaticMarkup(
    React.createElement(Sankey, {
      width: 900,
      height: 420,
      data: diagram,
      node: React.createElement(SankeyNode, { focus }),
      link: React.createElement(SankeyLink, { focus }),
      nodeWidth: 9,
      nodePadding: 18,
      margin: { top: 28, right: 168, bottom: 12, left: 150 },
    })
  );
};

// What the component does between a pointer landing on an element and the
// renderers being handed a focus: one map lookup, by id.
const focusOn = (diagram, type, id) => {
  const related = cashflowAdjacency(diagram).get(id);
  return related ? { id, type, ...related } : null;
};

const states = (html) =>
  (html.match(/data-state="(\w+)"/g) || []).reduce((tally, match) => {
    const state = match.slice(12, -1);
    tally[state] = (tally[state] ?? 0) + 1;
    return tally;
  }, {});

const ROWS = [
  tx("INCOME", 90000, "salary", "2026-10-05"),
  tx("INCOME", 24000, "freelance", "2026-10-06"),
  tx("EXPENSE", 30000, "housing", "2026-10-08"),
  tx("EXPENSE", 12000, "food", "2026-10-09"),
  tx("EXPENSE", 6000, "transportation", "2026-10-10"),
];

const SALARY = "source:salary";
const POOL_ID = `pool:${POOL}`;
const HOUSING = `destination:housing`;

describe("cashflow chart", () => {
  it("draws one label per node and one ribbon per link", () => {
    const html = draw(ROWS);
    // 2 sources + pool + 3 destinations + surplus
    expect((html.match(/<text/g) || []).length).toBe(7);
    // Cubic curves, which is what makes it a Sankey and not a bar chart.
    const curves = html.match(/C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+/g) || [];
    // One visible ribbon and one transparent hit path per link.
    expect(curves.length).toBe(12);
    expect((html.match(/cf-ribbon/g) || []).length).toBe(6);
    expect((html.match(/cf-hit/g) || []).length).toBe(6);
  });

  it("puts an amount beside every label", () => {
    const html = draw(ROWS);
    expect(html).toContain("₹90.0K");
    expect(html).toContain("₹30.0K");
    // 114000 in, 48000 out, so 66000 of it was not spent.
    expect(html).toContain("₹66.0K");
  });

  // A NaN in a path's `d` is how a Sankey fails: no error, nothing drawn.
  it("emits no NaN geometry, including for a deficit", () => {
    for (const rows of [
      ROWS,
      [tx("INCOME", 1000, "salary", "2026-10-05"), tx("EXPENSE", 9000, "housing", "2026-10-08")],
      [tx("INCOME", 5000, "salary", "2026-10-05")],
      [tx("EXPENSE", 5000, "housing", "2026-10-08")],
    ]) {
      const html = draw(rows);
      expect(html).toContain("<svg");
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  it("gives the pointer a target on a ribbon too thin to hit", () => {
    const html = draw([
      tx("INCOME", 90000, "salary", "2026-10-05"),
      tx("EXPENSE", 200, "food", "2026-10-09"),
    ]);
    const widthsOf = (pattern) =>
      [...html.matchAll(pattern)].map((match) => Number(match[1]));
    const hit = widthsOf(/class="cf-hit"[^>]*stroke-width="([\d.]+)"/g);
    const ribbons = widthsOf(/class="cf-ribbon[^"]*"[^>]*stroke-width="([\d.]+)"/g);

    // Every ribbon has a target a pointer can land on ...
    expect(hit.length).toBe(3);
    expect(Math.min(...hit)).toBeGreaterThanOrEqual(8);
    // ... and nothing is hidden by rounding a hairline up: the visible ribbon
    // keeps its own width, which for ₹200 out of ₹90,000 is under a pixel.
    expect(ribbons.length).toBe(3);
    expect(Math.min(...ribbons)).toBeLessThan(1.5);
  });
});

describe("cashflow ribbon colour", () => {
  it("runs each ribbon from its source's colour to its target's", () => {
    const diagram = diagramOf(ROWS);
    const html = draw(ROWS);

    const salary = diagram.nodes.find((n) => n.id === SALARY);
    const pool = diagram.nodes.find((n) => n.id === POOL_ID);
    const housing = diagram.nodes.find((n) => n.id === HOUSING);

    // In: the category's colour on the left, the pool's on the right.
    expect(html).toContain(
      `<stop offset="0%" stop-color="${salary.color}"></stop><stop offset="100%" stop-color="${pool.color}"></stop>`
    );
    // Out: the other way round.
    expect(html).toContain(
      `<stop offset="0%" stop-color="${pool.color}"></stop><stop offset="100%" stop-color="${housing.color}"></stop>`
    );
  });

  it("gives every ribbon its own gradient, and paints with it", () => {
    const diagram = diagramOf(ROWS);
    const html = draw(ROWS);

    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(diagram.links.length);
    expect(new Set(ids).size).toBe(ids.length);
    // No colon or angle bracket survives into a URL fragment.
    for (const id of ids) expect(id).toMatch(/^cf-flow-[A-Za-z0-9-]+$/);

    const strokes = [...html.matchAll(/class="cf-ribbon[^"]*"[^>]*stroke="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(strokes.sort()).toEqual(ids.map((id) => `url(#${id})`).sort());
  });

  it("gradients the tooltip swatch the same way as the ribbon", () => {
    const diagram = diagramOf(ROWS);
    const detail = cashflowDetail(diagram, { type: "link", id: `${POOL_ID}>${HOUSING}` });
    const pool = diagram.nodes.find((n) => n.id === POOL_ID);
    const housing = diagram.nodes.find((n) => n.id === HOUSING);
    expect(detail.color).toBe(`linear-gradient(90deg, ${pool.color}, ${housing.color})`);
  });
});

describe("cashflow ids", () => {
  it("tells apart a category that is both income and expense", () => {
    // A refund banked as income against the category it came back from: the
    // same key on both sides of the pool, which is why the side is in the id.
    const diagram = diagramOf([
      tx("INCOME", 5000, "shopping", "2026-10-05"),
      tx("EXPENSE", 2000, "shopping", "2026-10-08"),
    ]);
    const ids = diagram.nodes.map((node) => node.id);
    expect(ids).toContain("source:shopping");
    expect(ids).toContain("destination:shopping");
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(diagram.links.map((l) => l.id)).size).toBe(diagram.links.length);
  });

  it("keeps an id stable when the rest of the period changes", () => {
    const one = diagramOf(ROWS);
    const two = diagramOf([...ROWS, tx("EXPENSE", 99000, "shopping", "2026-10-11")]);
    expect(one.nodes.some((n) => n.id === HOUSING)).toBe(true);
    expect(two.nodes.some((n) => n.id === HOUSING)).toBe(true);
    // The index did move -- which is why the id is not the index.
    expect(one.nodes.findIndex((n) => n.id === HOUSING)).not.toBe(
      two.nodes.findIndex((n) => n.id === HOUSING)
    );
  });
});

describe("cashflow adjacency", () => {
  const diagram = diagramOf(ROWS);
  const map = cashflowAdjacency(diagram);

  it("connects a source to the pool and to nothing else", () => {
    const { nodes, links } = map.get(SALARY);
    expect([...nodes].sort()).toEqual([POOL_ID, SALARY].sort());
    expect([...links]).toEqual([`${SALARY}>${POOL_ID}`]);
  });

  it("connects an expense to the pool and to nothing else", () => {
    const { nodes, links } = map.get(HOUSING);
    expect([...nodes].sort()).toEqual([HOUSING, POOL_ID].sort());
    expect([...links]).toEqual([`${POOL_ID}>${HOUSING}`]);
  });

  it("gives the pool every link in the diagram, because it has them", () => {
    const { nodes, links } = map.get(POOL_ID);
    expect(links.size).toBe(diagram.links.length);
    expect(nodes.size).toBe(diagram.nodes.length);
  });

  it("gives a ribbon its two endpoints and itself", () => {
    const { nodes, links } = map.get(`${POOL_ID}>${HOUSING}`);
    expect([...nodes].sort()).toEqual([HOUSING, POOL_ID].sort());
    expect([...links]).toEqual([`${POOL_ID}>${HOUSING}`]);
  });

  it("has nothing to say about an id from another period", () => {
    expect(map.get("destination:shopping")).toBeUndefined();
    expect(focusOn(diagram, "node", "destination:shopping")).toBeNull();
  });
});

describe("cashflow focus state", () => {
  const diagram = diagramOf(ROWS);

  it("leaves everything alone when nothing is active", () => {
    expect(focusState(null, SALARY)).toBe("idle");
    const tally = states(draw(ROWS));
    expect(tally.idle).toBeGreaterThan(0);
    expect(tally.muted).toBeUndefined();
    expect(tally.active).toBeUndefined();
  });

  it("highlights a source's own ribbon and dims the rest", () => {
    const focus = focusOn(diagram, "node", SALARY);
    expect(focusState(focus, SALARY)).toBe("active");
    expect(focusState(focus, POOL_ID)).toBe("related");
    expect(focusState(focus, `${SALARY}>${POOL_ID}`)).toBe("related");
    expect(focusState(focus, HOUSING)).toBe("muted");
    expect(focusState(focus, `${POOL_ID}>${HOUSING}`)).toBe("muted");

    const tally = states(draw(ROWS, focus));
    // 7 nodes + 6 ribbons = 13 elements carrying a state.
    expect(tally.active).toBe(1);
    expect(tally.related).toBe(2);
    expect(tally.muted).toBe(10);
  });

  it("highlights an expense's incoming ribbon", () => {
    const focus = focusOn(diagram, "node", HOUSING);
    expect(focusState(focus, `${POOL_ID}>${HOUSING}`)).toBe("related");
    expect(focusState(focus, `${SALARY}>${POOL_ID}`)).toBe("muted");
    expect(focusState(focus, POOL_ID)).toBe("related");
  });

  it("highlights the pool's real connections, which are all of them", () => {
    const focus = focusOn(diagram, "node", POOL_ID);
    const tally = states(draw(ROWS, focus));
    expect(tally.active).toBe(1);
    expect(tally.related).toBe(12);
    expect(tally.muted).toBeUndefined();
  });

  it("highlights surplus the same way as any other expense", () => {
    const surplus = `destination:${SURPLUS}`;
    const focus = focusOn(diagram, "node", surplus);
    expect(focusState(focus, surplus)).toBe("active");
    expect(focusState(focus, `${POOL_ID}>${surplus}`)).toBe("related");
    expect(focusState(focus, HOUSING)).toBe("muted");
  });

  it("highlights a hovered ribbon and both its ends", () => {
    const id = `${POOL_ID}>${HOUSING}`;
    const focus = focusOn(diagram, "link", id);
    expect(focusState(focus, id)).toBe("active");
    expect(focusState(focus, HOUSING)).toBe("related");
    expect(focusState(focus, POOL_ID)).toBe("related");
    expect(focusState(focus, SALARY)).toBe("muted");

    const tally = states(draw(ROWS, focus));
    expect(tally.active).toBe(1);
    expect(tally.related).toBe(2);
    expect(tally.muted).toBe(10);
  });

  it("works on a deficit, where the extra inflow is drawn from balances", () => {
    const rows = [
      tx("INCOME", 1000, "salary", "2026-10-05"),
      tx("EXPENSE", 9000, "housing", "2026-10-08"),
    ];
    const deficit = diagramOf(rows);
    const drawn = `source:${DRAWN_FROM_BALANCES}`;
    const focus = focusOn(deficit, "node", drawn);
    expect(focus).not.toBeNull();
    expect(focusState(focus, `${drawn}>${POOL_ID}`)).toBe("related");
    expect(focusState(focus, SALARY)).toBe("muted");
  });
});

describe("cashflow tooltip", () => {
  const diagram = diagramOf(ROWS);

  it("describes a node from the data, with the denominator named", () => {
    const detail = cashflowDetail(diagram, { type: "node", id: SALARY });
    expect(detail.title).toBe("Salary");
    expect(detail.value).toBe(90000);
    // 90000 of the 114000 pooled.
    expect(detail.meta).toBe("Money in · 79% of ₹1.1L pooled");
  });

  it("describes a ribbon by its source and destination", () => {
    const detail = cashflowDetail(diagram, {
      type: "link",
      id: `${POOL_ID}>${HOUSING}`,
    });
    expect(detail.title).toBe("Cash Flow → Housing");
    expect(detail.value).toBe(30000);
    expect(detail.meta).toBe("26% of ₹1.1L pooled");
  });

  it("names what surplus and the pool are", () => {
    expect(cashflowDetail(diagram, { type: "node", id: POOL_ID })).toMatchObject({
      title: "Cash Flow",
      value: 114000,
      meta: "Everything in, then everything out",
    });
    expect(
      cashflowDetail(diagram, { type: "node", id: `destination:${SURPLUS}` }).meta
    ).toBe("Not spent · 58% of ₹1.1L pooled");
  });

  it("does not round a small category down to nothing", () => {
    const rows = [
      tx("INCOME", 90000, "salary", "2026-10-05"),
      tx("EXPENSE", 200, "gifts", "2026-10-09"),
    ];
    const small = diagramOf(rows);
    const detail = cashflowDetail(small, { type: "node", id: "destination:gifts" });
    // 200 of 90,000 is 0.2%, and "0%" would read as none of it.
    expect(detail.meta).toBe("Money out · under 1% of ₹90.0K pooled");
  });

  it("says nothing about an element that is not in the diagram", () => {
    expect(cashflowDetail(diagram, null)).toBeNull();
    expect(cashflowDetail(diagram, { type: "node", id: "source:nope" })).toBeNull();
    expect(cashflowDetail(diagram, { type: "link", id: "a>b" })).toBeNull();
  });
});

describe("cashflow tooltip placement", () => {
  it("stays inside the chart at either edge", () => {
    const left = placeTooltip({ x: 4, y: 200, width: 900 });
    const right = placeTooltip({ x: 896, y: 200, width: 900 });
    expect(left.left).toBe(128);
    expect(right.left).toBe(772);
    expect(left.left - 128).toBeGreaterThanOrEqual(0);
    expect(right.left + 128).toBeLessThanOrEqual(900);
  });

  it("flips below the pointer when there is no room above", () => {
    expect(placeTooltip({ x: 400, y: 200, width: 900 }).above).toBe(true);
    expect(placeTooltip({ x: 400, y: 20, width: 900 })).toMatchObject({
      above: false,
      top: 40,
    });
  });

  it("does not place a tooltip outside a box narrower than itself", () => {
    const { left } = placeTooltip({ x: 300, y: 200, width: 200 });
    expect(left).toBe(128);
  });
});
