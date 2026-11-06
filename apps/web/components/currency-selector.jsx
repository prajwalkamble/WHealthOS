"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrency } from "@/components/currency-provider";
import { CURRENCIES } from "@/lib/currency/registry";
import { cn } from "@/lib/utils";

// Choosing the currency to read in.
//
// A popover with a filter rather than a <select>: thirteen options each
// needing a symbol, a code and a name do not fit a native option list
// legibly, and the symbol is what most people scan for.
//
// Built from the popover and button already in the design system rather than
// adding a combobox dependency. Keyboard behaviour is therefore ours to
// implement and is implemented: type to filter, arrows to move, Enter to
// choose, Escape to close, and focus returns to the trigger afterwards.
//
// Deliberately compact. It sits in the dashboard header beside the account
// menu, where it is a utility and not a feature -- a large currency control
// on a finance dashboard reads as "something is wrong with your currency".

const matches = (currency, query) => {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  return (
    currency.code.toLowerCase().includes(needle) ||
    currency.name.toLowerCase().includes(needle) ||
    currency.symbol.toLowerCase().includes(needle)
  );
};

export default function CurrencySelector({ className, align = "end" }) {
  const { currency, symbol, setCurrency, pending } = useCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  const options = useMemo(
    () => CURRENCIES.filter((item) => item.active && matches(item, query)),
    [query]
  );

  // Reopening should not resume somebody else's half-typed filter.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(Math.max(0, CURRENCIES.findIndex((item) => item.code === currency)));
    }
  }, [open, currency]);

  // Keep the highlighted row in view when the arrow keys walk past the fold.
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (code) => {
    setCurrency(code);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.code);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          // The control's purpose is not obvious from "₹ INR" alone to
          // somebody hearing it rather than seeing it in a toolbar.
          aria-label={`Display currency: ${currency}. Change`}
          disabled={pending}
          className={cn("h-8 gap-1.5 px-2.5 font-medium", className)}
        >
          <span aria-hidden="true" className="text-muted-foreground">{symbol}</span>
          <span className="tabular-nums">{currency}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-64 p-0" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Search currencies"
            aria-label="Search currencies"
            aria-controls={listId}
            className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {options.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No currency matches “{query}”.
            </li>
          ) : (
            options.map((option, index) => {
              const selected = option.code === currency;
              return (
                <li key={option.code}>
                  <button
                    type="button"
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(option.code)}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm",
                      index === active && "bg-accent text-accent-foreground",
                      selected && "font-medium"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="w-6 shrink-0 text-center text-muted-foreground"
                    >
                      {option.symbol}
                    </span>
                    <span className="w-10 shrink-0 tabular-nums">{option.code}</span>
                    <span className="truncate text-muted-foreground">{option.name}</span>
                    <Check
                      aria-hidden="true"
                      className={cn("ml-auto size-4 shrink-0", !selected && "invisible")}
                    />
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
