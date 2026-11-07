"use client";

import { bulkDeleteTransactions } from '@/actions/accounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { categoryColors } from '@/data/categories';
import { useCurrency } from '@/components/currency-provider';
import { cn } from '@/lib/utils';
import useFetch from '@/hooks/use-fetch';
import { format } from 'date-fns';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MoreHorizontal, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react'
import { BarLoader } from 'react-spinners';
import { toast } from 'sonner';

const ITEMS_PER_PAGE = 10;

const RECURRING_INTERVALS = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

// The same three sort fields the table header offers, spelled out for the
// small-screen Select, which has no header to click.
const SORT_OPTIONS = [
  { value: "date:desc", label: "Newest first" },
  { value: "date:asc", label: "Oldest first" },
  { value: "amount:desc", label: "Largest first" },
  { value: "amount:asc", label: "Smallest first" },
  { value: "category:asc", label: "Category A\u2013Z" },
  { value: "category:desc", label: "Category Z\u2013A" },
];

// A Checkbox draws at 16px, which is under the 24px WCAG 2.5.8 asks of a
// target -- and these sit in a list built for thumbs. The pseudo-element
// widens what you can hit to 32px without moving or resizing the box itself,
// so nothing about the layout shifts.
const HIT_AREA =
  "relative before:absolute before:-inset-2 before:content-['']";

// The hue that identifies a category, as a dot rather than a filled chip --
// see the note on the table cell below for why it stopped being a background.
const CategoryDot = ({ category }) => (
  <span
    aria-hidden
    className="h-1.5 w-1.5 shrink-0 rounded-full"
    style={{ backgroundColor: categoryColors[category] }}
  />
);

// Recurring is the exception worth marking. Every row used to carry a
// "One-time" badge as well, which meant the column was a wall of identical
// pills on a typical page and the one row that actually repeated did not
// stand out at all.
const RecurringBadge = ({ transaction }) => {
  if (!transaction.isRecurring) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1 border-primary/40 font-normal text-primary"
          >
            <RefreshCw className="h-3 w-3" />
            {RECURRING_INTERVALS[transaction.recurringInterval]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <div className="font-medium">Next date</div>
            <div>
              {transaction.nextRecurringDate
                ? format(new Date(transaction.nextRecurringDate), "PP")
                : "Not scheduled"}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// What a person sees when there is nothing to list.
//
// It used to be the words "No Transactions Found" in an unpadded table cell,
// which read as a broken row rather than an answer -- and it said the same
// thing whether the account was new or the filters simply excluded
// everything, so the way out of an over-narrow filter was not offered.
const EmptyState = ({ filtered, onClear }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
      <Search className="h-5 w-5 text-muted-foreground" aria-hidden />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {filtered ? "No matching transactions" : "No transactions yet"}
      </p>
      <p className="text-sm text-muted-foreground">
        {filtered
          ? "Nothing here matches the current search and filters."
          : "Transactions appear here once you add your first one."}
      </p>
    </div>
    {filtered && (
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    )}
  </div>
);

// Edit and delete for one row. Shared so the table and the small-screen list
// cannot drift apart.
const RowActions = ({ onEdit, onDelete }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        className="h-8 w-8 shrink-0 p-0"
        aria-label="Transaction actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem className="cursor-pointer" onClick={onEdit}>
        Edit
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="cursor-pointer text-destructive"
        onClick={onDelete}
      >
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

// A column heading you can sort by.
//
// This was a <th> with an onClick and a cursor-pointer, which a keyboard
// could not reach at all and a screen reader announced as plain text. It is
// a real button now, and it carries aria-sort so the current order is
// announced rather than only drawn. The chevron is always present on the
// active column and appears on hover elsewhere, so the other columns admit
// that they sort too -- previously nothing distinguished a sortable heading
// from a fixed one until you happened to click it.
const SortableHead = ({ field, label, sortConfig, onSort, className, align }) => {
  const active = sortConfig.field === field;
  const Chevron = active && sortConfig.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <TableHead
      className={className}
      aria-sort={
        active
          ? sortConfig.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "group -mx-2 flex w-[calc(100%+1rem)] items-center gap-1 rounded px-2 py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
          // On the amount column the chevron goes to the LEFT of the label.
          // It holds its 20px even when invisible, so with the chevron
          // trailing, the word "Amount" stopped 20px short of the right edge
          // its own figures are aligned to.
          align === "right" ? "flex-row-reverse justify-start" : "justify-start"
        )}
      >
        {label}
        <Chevron
          className={cn(
            "h-4 w-4 shrink-0 transition-opacity motion-reduce:transition-none",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
          )}
        />
      </button>
    </TableHead>
  );
};

// showAccount: on /transactions the rows span accounts, so each one names
// its own. The account page leaves it off -- every row is that account.
export function TransactionTable ({ transactions, showAccount = false }) {
  const router = useRouter();
  // Aliased because `format` in this file is date-fns'. Every amount below
  // goes through this: it converts into the currency the viewer picked and
  // formats in that currency's own convention. The column used to print
  // "\u20B9" + amount.toFixed(2), which was wrong twice over -- it showed
  // rupees to someone reading in dollars, and toFixed does no digit
  // grouping, so ninety-two thousand rendered as "92000.00".
  const { format: formatCurrency } = useCurrency();
  const [selectedIDs, setSelectedIDs] = useState([]);
  const [sortConfig, setSortConfig] = useState({
    field: "date",
    direction: "desc",
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [recurringFilter, setRecurringFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const {
    loading: deleteLoading,
    fn: deleteFn,
    data: deleted,
  } = useFetch(bulkDeleteTransactions);

  // Memoize filter and sort transactions
  const filteredAndSortedTransactions = useMemo(() => {
    let result = [...transactions];

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter((transaction) =>
        transaction.description?.toLowerCase().includes(searchLower)
      );
    }

    // Apply recurring filter
    if (recurringFilter) {
      result = result.filter((transaction) => {
        if (recurringFilter === "recurring") return transaction.isRecurring;
        return !transaction.isRecurring;
      });
    }

    // Type filter
    if (typeFilter) {
      result = result.filter((transaction) => transaction.type === typeFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortConfig.field) {
        case "date":
          comparison = new Date(a.date) - new Date(b.date);
          break;
        case "amount":
          comparison = a.amount - b.amount;
          break;
        case "category":
          comparison = a.category.localeCompare(b.category);
          break;
        default:
          comparison = 0;
      }

      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return result;
  }, [transactions, searchTerm, typeFilter, recurringFilter, sortConfig]);

  // Pagination calculations
  const totalPages = Math.ceil(
    filteredAndSortedTransactions.length / ITEMS_PER_PAGE
  );
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedTransactions.slice(
      startIndex,
      startIndex + ITEMS_PER_PAGE
    );
  }, [filteredAndSortedTransactions, currentPage]);

  // Whether anything is narrowing the list -- the empty state says something
  // different depending on the answer.
  const hasFilters = Boolean(searchTerm || typeFilter || recurringFilter);

  const handleSort = (field) => {
    setSortConfig(current => ({
      field,
      direction:
        current.field == field && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleSelect = (id) => {
    setSelectedIDs(current =>
      current.includes(id)
        ? current.filter(item => item != id)
        : [...current, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIDs(current =>
      current.length === paginatedTransactions.length
        ? []
        : paginatedTransactions.map((t) => t.id)
    );
  };

  const deleteTransactions = async (ids) => {
    if (ids.length === 0) return;

    if (
      !window.confirm(
        ids.length === 1
          ? "Are you sure you want to delete this transaction?"
          : `Are you sure you want to delete ${ids.length} transactions?`
      )
    ) {
      return;
    }

    const result = await deleteFn(ids);
    // Only on success -- a failed delete leaves the rows in place, so the
    // selection is still meaningful and the user can retry.
    if (result?.success) setSelectedIDs([]);
  };

  useEffect(() => {
    if (deleted?.success && !deleteLoading) {
      toast.success(
        deleted.data?.deleted === 1
          ? "Transaction deleted successfully"
          : "Transactions deleted successfully"
      );
    }
  }, [deleted, deleteLoading]);

  // Deleting or filtering can shrink the result set past the current page,
  // which left the table empty under a "Page 3 of 2" pager.
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages || 1);
    }
  }, [currentPage, totalPages]);

  // Any change to what is shown clears the selection. It used to survive a
  // search or filter change, so "Delete Selected (n)" went on to delete rows
  // that were no longer on screen.
  const changeFilter = (setter) => (value) => {
    setter(value);
    setCurrentPage(1);
    setSelectedIDs([]);
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setTypeFilter("");
    setRecurringFilter("");
    setCurrentPage(1);
    setSelectedIDs([]);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    setSelectedIDs([]);
  };

  return (
    <div className="space-y-4">
      {deleteLoading && (
        <BarLoader className="mt-4" width={"100%"} color="hsl(var(--primary))" />
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          {/* The icon sat at left-2 under pl-10 padding, so the glyph and the
              text it labelled were six pixels out of step. */}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search transactions"
            value={searchTerm}
            onChange={(e) => changeFilter(setSearchTerm)(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={typeFilter}
            onValueChange={changeFilter(setTypeFilter)}
          >
            {/* Both filters are the same width. One was auto and the other
                150px, so the pair sat unevenly against the search field. */}
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INCOME">Income</SelectItem>
              <SelectItem value="EXPENSE">Expense</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={recurringFilter}
            onValueChange={changeFilter(setRecurringFilter)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Transactions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recurring">Recurring Only</SelectItem>
              <SelectItem value="non-recurring">Non-recurring Only</SelectItem>
            </SelectContent>
          </Select>

          {/* Sorting lives in the table header, and the table header is not
              rendered below md. Without this the small-screen list could
              only ever be newest-first. */}
          <Select
            value={`${sortConfig.field}:${sortConfig.direction}`}
            onValueChange={(value) => {
              const [field, direction] = value.split(":");
              setSortConfig({ field, direction });
            }}
          >
            <SelectTrigger className="w-[160px] lg:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedIDs.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteTransactions(selectedIDs)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Selected ({selectedIDs.length})
            </Button>
          )}

          {hasFilters && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleClearFilters}
              title="Clear filters"
              aria-label="Clear filters"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Transactions, below md.
          The table has eight columns and needs about 616px. On a 375px
          phone that put the amount -- the column this page exists to show
          -- entirely off the right edge, behind a horizontal scroll with
          nothing to suggest it was there, while the date wrapped onto two
          lines and the category clipped mid-word. The same rows, the same
          selection and the same actions, laid out as a list instead.

          The switch is at lg, not md. The sidebar takes 256px, so a 768px
          viewport leaves the table a 462px column -- it still overflowed
          there and still hid ten of the twelve amounts on the page. The
          content column first clears the table's ~616px at lg. */}
      <div className="space-y-2 lg:hidden">
        {paginatedTransactions.length > 0 && (
          <label className="flex w-fit cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground">
            <Checkbox
              className={HIT_AREA}
              onCheckedChange={handleSelectAll}
              checked={
                selectedIDs.length === paginatedTransactions.length &&
                paginatedTransactions.length > 0
              }
            />
            Select all on this page
          </label>
        )}

        {paginatedTransactions.length === 0 ? (
          <EmptyState filtered={hasFilters} onClear={handleClearFilters} />
        ) : (
          paginatedTransactions.map((transaction) => {
            const expense = transaction.type === "EXPENSE";

            return (
              <div
                key={transaction.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <Checkbox
                  className={cn("mt-1 shrink-0", HIT_AREA)}
                  onCheckedChange={() => handleSelect(transaction.id)}
                  checked={selectedIDs.includes(transaction.id)}
                  aria-label={`Select ${transaction.description || "transaction"}`}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {transaction.description || "Untitled"}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 whitespace-nowrap font-medium tabular-nums",
                        expense ? "text-negative" : "text-positive"
                      )}
                    >
                      {expense ? "-" : "+"}
                      {formatCurrency(transaction.amount)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {format(new Date(transaction.date), "PP")}
                    </span>
                    {showAccount && transaction.account?.name && (
                      <span className="truncate capitalize">
                        <span aria-hidden>· </span>
                        {transaction.account.name}
                      </span>
                    )}
                    {/* No middot in front of the category: this line wraps on
                        a narrow phone, and a leading separator opened the
                        second line with a stranded dot. The category's own
                        colour dot does the separating. */}
                    <span className="inline-flex items-center gap-1 whitespace-nowrap capitalize">
                      <CategoryDot category={transaction.category} />
                      {transaction.category}
                    </span>
                  </div>

                  {transaction.isRecurring && (
                    <div className="mt-2">
                      <RecurringBadge transaction={transaction} />
                    </div>
                  )}
                </div>

                <RowActions
                  onEdit={() =>
                    router.push(`/transaction/create?edit=${transaction.id}`)
                  }
                  onDelete={() => deleteTransactions([transaction.id])}
                />
              </div>
            );
          })
        )}
      </div>

      {/* Transactions, lg and up */}
      <div className="hidden rounded-md border lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  className={HIT_AREA}
                  onCheckedChange={handleSelectAll}
                  checked={
                    selectedIDs.length === paginatedTransactions.length &&
                    paginatedTransactions.length > 0
                  }
                />
              </TableHead>
              <SortableHead
                field="date"
                label="Date"
                sortConfig={sortConfig}
                onSort={handleSort}
                className="whitespace-nowrap"
              />
              <TableHead>Description</TableHead>
              {showAccount && <TableHead>Account</TableHead>}
              <SortableHead
                field="category"
                label="Category"
                sortConfig={sortConfig}
                onSort={handleSort}
              />
              <SortableHead
                field="amount"
                label="Amount"
                sortConfig={sortConfig}
                onSort={handleSort}
                align="right"
                className="text-right"
              />
              <TableHead className="w-[50px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedTransactions.length === 0? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={showAccount ? 7 : 6} className="p-0">
                  <EmptyState filtered={hasFilters} onClear={handleClearFilters} />
                </TableCell>
              </TableRow>
            ) : (
              paginatedTransactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    <Checkbox
                      className={HIT_AREA}
                      onCheckedChange={() => handleSelect(transaction.id)}
                      checked={selectedIDs.includes(transaction.id)}
                      aria-label={`Select ${transaction.description || "transaction"}`}
                    />
                  </TableCell>
                  <TableCell>
                    {format(new Date(transaction.date), "PP")}
                  </TableCell>
                  <TableCell>
                    {/* The recurring badge used to have a column to itself,
                        which on a typical page was a header over ten empty
                        cells -- the marker is the exception, so it sits with
                        the row it qualifies instead of reserving width that
                        is usually blank. */}
                    <div className="flex items-center gap-2">
                      <span>{transaction.description}</span>
                      <RecurringBadge transaction={transaction} />
                    </div>
                  </TableCell>
                  {showAccount && (
                    <TableCell className="capitalize text-muted-foreground">
                      {transaction.account?.name ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="capitalize">
                    {/* The category hue used to be this chip's background with
                        white text on top of it. 19 of the 21 categories failed
                        4.5:1 that way -- healthcare worst, at 2.49:1 -- which
                        put the least readable text in the table on the column
                        a user scans to find a row. The hue still identifies
                        the category; it just no longer has to carry the text
                        sitting on it, and it stays the series colour in the
                        charts, where nothing is written over it. */}
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-muted px-2 py-1 text-sm text-foreground">
                      <CategoryDot category={transaction.category} />
                      {transaction.category}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-right font-medium tabular-nums",
                      transaction.type === "EXPENSE"
                        ? "text-negative"
                        : "text-positive"
                    )}
                  >
                    {transaction.type === "EXPENSE" ? "-" : "+"}
                    {formatCurrency(transaction.amount)}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onEdit={() =>
                        router.push(`/transaction/create?edit=${transaction.id}`)
                      }
                      onDelete={() => deleteTransactions([transaction.id])}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
