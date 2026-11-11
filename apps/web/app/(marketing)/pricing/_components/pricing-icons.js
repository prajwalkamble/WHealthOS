// The icons the pricing table renders, named one by one.
//
// data/pricing.js names its icons as strings so the content file stays free of
// imports. Something still has to turn a string into a component, and how it
// does that matters more than it looks: the obvious
// `import * as icons from "lucide-react"` pulls in the whole library, because
// a namespace import needs the entire object at runtime and so survives
// tree-shaking and Next's optimizePackageImports alike.
//
// So the mapping is explicit. The cost of that is this file: add a feature
// with a new icon and it must be added here too. tests/pricing-icons.test.js
// fails if one is missing, rather than letting it quietly render as a circle.
import {
  BarChart3,
  Brain,
  CalendarClock,
  ChartPie,
  CreditCard,
  Download,
  FileBarChart,
  FileText,
  Globe,
  Headphones,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  MessageSquare,
  Paintbrush,
  Palette,
  PiggyBank,
  ScanLine,
  Sparkles,
  Target,
  Wallet,
  Wand2,
} from "lucide-react";

export const PRICING_ICONS = {
  BarChart3,
  Brain,
  CalendarClock,
  ChartPie,
  CreditCard,
  Download,
  FileBarChart,
  FileText,
  Globe,
  Headphones,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  MessageSquare,
  Paintbrush,
  Palette,
  PiggyBank,
  ScanLine,
  Sparkles,
  Target,
  Wallet,
  Wand2,
};
