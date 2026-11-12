"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format as formatDate } from "date-fns";
import {
  ArrowRight,
  CalendarIcon,
  Check,
  ArrowLeftRight,
  Loader,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import useFetch from "@/hooks/use-fetch";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency/format";
import { symbolOf, DEFAULT_CURRENCY } from "@/lib/currency/registry";
import { transferSchema } from "@/app/lib/schema";
import { createInternalTransfer } from "@/actions/transfers";
import {
  checkTransfer,
  messageFor,
  projectedBalances,
} from "@/lib/transfers/rules";

// Moving money between two of the person's own accounts.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A COMPONENT AND NOT A DRAWER
// ---------------------------------------------------------------------------
// There are two ways into a transfer -- the /transfer page, and the drawer
// behind the Transfer button on /accounts and on an account's own page -- and
// they must be the same transfer. Not "the same fields": the same validation,
// the same review step, the same idempotency key discipline, the same
// receipt. A second copy of this flow inside the drawer is how two routes to
// one operation come to disagree about what the operation is.
//
// So the flow lives here, knowing nothing about the shell it sits in. The
// shell supplies a cancel control (`cancelSlot`), may supply a column beside
// the form (`renderAside`), and is told when the step changes.
//
// ---------------------------------------------------------------------------
// WHAT CARRIES THE WEIGHT ON THIS SCREEN
// ---------------------------------------------------------------------------
// The amount. It is the one figure somebody is actually deciding, and it used
// to be the third of four identically-sized fields in a stack -- which made a
// screen that moves real money look like a settings form.
//
// So the amount is set as display type, in the source account's own currency,
// with the available balance and the balance left after sitting directly
// under it. The two accounts are a pair rather than two more rows: side by
// side at sm and above, with the swap control on the axis between them, so
// the direction of travel is something you see instead of something you read.
//
// Everything is drawn from the theme tokens -- no literal colours anywhere --
// because the palette, the radius, the font and light/dark are all things the
// person has already chosen in Settings. A premium screen here is one that
// obeys those choices, not one that overrides them.
//
// ---------------------------------------------------------------------------
// WHY EVERY FIGURE HERE IS IN THE ACCOUNT'S CURRENCY, NOT THE VIEWER'S
// ---------------------------------------------------------------------------
// Everywhere else in WHealthOS a balance is drawn through useCurrency(), which
// converts into whatever currency the person has chosen to read in. That is
// right for reading and wrong for this screen, because the number typed below
// is STORED: type 10,000 against a rupee account and ₹10,000 moves, whatever
// the dashboard is set to. Converting the balances beside the input while
// leaving the input itself unconverted would put two different currencies on
// one screen and label neither -- so formatMoney() is used instead, which
// formats in the currency given and converts nothing.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A REVIEW STEP
// ---------------------------------------------------------------------------
// A transfer is the only operation in the application that changes two
// balances at once, and it is immutable afterwards -- correcting one means
// deleting it and starting again. So it is worth one screen that says, in
// full, which account falls, which rises, and what both of them will hold.
//
// The review is also where the idempotency key is minted. A fresh key per
// visit to the review step means: double-clicking Confirm sends the same key
// twice and the server answers the second with the first one's result, while
// going Back, changing something and reviewing again mints a new one -- so a
// genuinely different transfer is never mistaken for a retry of the old.

export const STEP = { FORM: "form", REVIEW: "review", DONE: "done" };

// The heading and the sentence under it, for whichever shell is framing this.
//
// Here rather than in each shell because they are a property of the step, not
// of the drawer or of the page, and two copies would drift the first time one
// of them was reworded.
export const transferCopy = (step) =>
  step === STEP.DONE
    ? {
        title: "Transfer complete",
        description: "Both balances have been updated.",
      }
    : {
        title: "Fund Transfer",
        description:
          "Shift money you already hold from one account to another: savings set aside, a card cleared, a bill's account topped up. You end up no better or worse off — which is why it counts as neither income nor an expense.",
      };

// A micro-label: the small, letter-spaced caps over a field or a panel.
//
// One shared component rather than the same four utilities repeated eleven
// times, so the labels on the form, on the review and in whatever the shell
// puts beside them are the same size and the same weight by construction.
// Polymorphic because half of these are <label>s with an htmlFor and half are
// not labels at all. One component either way, so a field's label and a
// panel's heading cannot drift apart in size or weight.
const Eyebrow = ({ as: Tag = "span", className, children, ...rest }) => (
  <Tag
    className={cn(
      "inline-block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground",
      className
    )}
    {...rest}
  >
    {children}
  </Tag>
);

// The accounts prop is the server-rendered list: { id, name, type, balance,
// currency }. Balances come from the database; nothing here recalculates one.
const TransferFlow = ({
  accounts = [],
  defaultFromAccountId = null,
  // The shell's way out of the form -- a DrawerClose in the drawer, a link
  // back to /accounts on the page. A node rather than a callback, because
  // DrawerClose has to wrap the button itself to work.
  cancelSlot = null,
  // Optional second column, given the live state of the form.
  //
  // A render prop rather than a callback and a piece of lifted state: the
  // shell gets what it needs during the same render, so there is no effect to
  // fire, nothing to get out of step, and no re-render loop to be careful of.
  // The drawer passes nothing and stays one column.
  renderAside = null,
  onStepChange,
  onDone,
}) => {
  const [step, setStep] = useState(STEP.FORM);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    trigger,
  } = useForm({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: defaultFromAccountId ?? "",
      toAccountId: "",
      amount: "",
      date: new Date(),
      description: "",
    },
  });

  const fromAccountId = watch("fromAccountId");
  const toAccountId = watch("toAccountId");
  const amount = watch("amount");
  const date = watch("date");
  const description = watch("description");

  const byId = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );
  const source = byId.get(fromAccountId) ?? null;
  const destination = byId.get(toAccountId) ?? null;

  const {
    loading,
    fn: createFn,
    data: created,
  } = useFetch(createInternalTransfer);

  // One place decides the step, so the shell is told about every change
  // without each setStep call having to remember to say so.
  const goTo = (next) => {
    setStep(next);
    onStepChange?.(next);
  };

  // The server's own rules, run here.
  //
  // Imported from lib/transfers/rules.js rather than reimplemented, which is
  // the whole reason that module is separate from the service. A second,
  // hand-written copy of "may this transfer happen" in the browser is how an
  // interface comes to promise something the server then refuses -- and the
  // reverse, a disabled button over a transfer that would have been accepted.
  //
  // Advisory, always. These balances were rendered on the server some seconds
  // ago; the authoritative check happens inside the database transaction under
  // a row lock, against the balance the row actually holds.
  const verdict = useMemo(() => {
    if (!source || !destination || amount === "" || amount === undefined) {
      return null;
    }
    return checkTransfer({ source, destination, amount: Number(amount) });
  }, [source, destination, amount]);

  const projection = useMemo(() => {
    if (!source || !destination || !Number.isFinite(Number(amount))) return null;
    return projectedBalances({
      sourceBalance: source.balance,
      destinationBalance: destination.balance,
      amount: Number(amount),
    });
  }, [source, destination, amount]);

  const swap = () => {
    // Both at once, and nothing else. The amount stays, the date stays, the
    // note stays; only the two accounts exchange places, and validation reruns
    // because the funds question now concerns a different account. Not a
    // submit: this button lives inside a form, so it needs type="button" or it
    // would send the transfer.
    setValue("fromAccountId", toAccountId, { shouldValidate: true });
    setValue("toAccountId", fromAccountId, { shouldValidate: true });
  };

  const toReview = async () => {
    // The browser schema first (shape, both accounts chosen, two different
    // ones), then the financial rules. Reviewing a transfer that cannot be
    // made would be showing somebody a summary of nothing.
    if (!(await trigger())) return;
    if (verdict && !verdict.ok) {
      toast.error(messageFor(verdict.code));
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    goTo(STEP.REVIEW);
  };

  const onConfirm = handleSubmit(async (data) => {
    await createFn({
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      amount: data.amount,
      date: data.date,
      description: data.description?.trim() ? data.description.trim() : null,
      idempotencyKey,
    });
  });

  useEffect(() => {
    if (created?.success && !loading) {
      // Only now. The success state is drawn from the server's answer -- the
      // transfer's own id, and the accounts as the server resolved them --
      // never from the form, so there is nothing to show until it has
      // committed.
      setReceipt(created.data);
      setStep(STEP.DONE);
      onStepChange?.(STEP.DONE);
    }
    // onStepChange is the shell's own callback and is not a dependency worth
    // re-running the effect for; the receipt is what this watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, loading]);

  // createInternalTransfer throws on failure and useFetch raises the toast,
  // so there is deliberately no error effect here -- the same arrangement
  // CreateAccountDrawer uses.

  // Nothing here resets itself. Both shells discard this component instead --
  // the drawer by remounting on close, the page by remounting after a
  // transfer -- which is one rule rather than a reset function that has to be
  // kept in step with every piece of state added later.
  if (accounts.length < 2) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">You need two accounts</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A transfer moves money between two of your own accounts, so there has
          to be somewhere for it to go.
        </p>
      </div>
    );
  }

  // The currency the input is denominated in. Before a source is chosen there
  // is nothing to be denominated in yet, so the symbol sits at reduced
  // emphasis in the account default rather than guessing and being wrong the
  // moment somebody picks a foreign-currency account.
  const currency = source?.currency ?? DEFAULT_CURRENCY;
  const blocked = Boolean(verdict && !verdict.ok);

  const body =
    step === STEP.DONE ? (
      <Receipt receipt={receipt} onDone={() => onDone?.()} />
    ) : step === STEP.REVIEW ? (
      <Review
        source={source}
        destination={destination}
        amount={Number(amount)}
        date={date}
        description={description}
        projection={projection}
        loading={loading}
        onBack={() => goTo(STEP.FORM)}
        onConfirm={onConfirm}
      />
    ) : (
      <form
        className="space-y-6"
        onSubmit={(event) => {
          // Enter in the amount field must reach the review step, not submit a
          // transfer that has not been reviewed.
          event.preventDefault();
          toReview();
        }}
      >
        {/* --- The amount, as the thing this screen is about ------------- */}
        <section
          className={cn(
            "rounded-xl border bg-muted/30 px-5 py-4 transition-colors",
            "focus-within:border-ring/50 focus-within:bg-muted/50",
            (errors.amount || blocked) && "border-negative/50 bg-negative/5"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Eyebrow as="label" htmlFor="transfer-amount">
              Amount
            </Eyebrow>
            {source ? (
              <span className="rounded-md bg-background/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {source.currency}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span
              aria-hidden
              className={cn(
                "text-2xl font-medium tabular-nums transition-colors",
                source ? "text-muted-foreground" : "text-muted-foreground/40"
              )}
            >
              {symbolOf(currency)}
            </span>
            {/* A bare input rather than <Input>: this one is display type, and
                the component's own h-10 and border would fight both. The ring
                moves to the panel around it, which is why that panel carries
                focus-within. Spinners are suppressed -- arrows on a four-digit
                display figure look like a stepper somebody is meant to use. */}
            <input
              id="transfer-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              aria-invalid={Boolean(errors.amount) || verdict?.ok === false}
              aria-describedby="transfer-amount-help"
              className={cn(
                "min-w-0 flex-1 bg-transparent text-4xl font-semibold tracking-tight tabular-nums",
                "outline-none placeholder:text-muted-foreground/30",
                "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              )}
              {...register("amount")}
            />
          </div>

          <p
            id="transfer-amount-help"
            className="mt-2 border-t border-border/60 pt-2 text-sm"
          >
            {errors.amount ? (
              <span className="text-negative">{errors.amount.message}</span>
            ) : blocked ? (
              <span className="text-negative">{messageFor(verdict.code)}</span>
            ) : source ? (
              <span className="text-muted-foreground tabular-nums">
                {formatMoney(source.balance, source.currency)} available
                {projection && Number(amount) > 0
                  ? ` · ${formatMoney(projection.source, source.currency)} left after`
                  : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Enter amount to be transferred.
              </span>
            )}
          </p>
        </section>

        {/* --- The pair, with the direction of travel between them -------- */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end sm:gap-4">
          <AccountField
            id="transfer-from"
            label="From"
            accounts={accounts}
            value={fromAccountId}
            onChange={(value) =>
              setValue("fromAccountId", value, { shouldValidate: true })
            }
            error={errors.fromAccountId?.message}
          />

          {/* On the axis between the two selects at sm and above, and on the
              seam between them when they stack. A convenience, so it stays
              small -- but it is the control that explains the screen, so it
              turns when you reach for it. */}
          <div className="flex items-center justify-center sm:pb-[0.3125rem]">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(
                "h-9 w-9 shrink-0 rounded-full shadow-sm",
                "transition-transform duration-300 hover:rotate-180 active:scale-95",
                "motion-reduce:transition-none motion-reduce:hover:rotate-0"
              )}
              onClick={swap}
              disabled={!fromAccountId && !toAccountId}
              aria-label="Swap the two accounts"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>

          <AccountField
            id="transfer-to"
            label="To"
            accounts={accounts}
            value={toAccountId}
            onChange={(value) =>
              setValue("toAccountId", value, { shouldValidate: true })
            }
            // Offered but not selectable, rather than removed. Removing it
            // makes the list change length as the other select changes, which
            // is disorienting; and the disabled row is itself the explanation.
            disabledId={fromAccountId}
            error={errors.toAccountId?.message}
          />
        </div>

        {/* --- The two details, which are details ------------------------ */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Eyebrow as="label" htmlFor="transfer-date">
              Date
            </Eyebrow>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="transfer-date"
                  type="button"
                  variant="outline"
                  className="w-full justify-start pl-3 font-normal"
                  aria-invalid={Boolean(errors.date)}
                >
                  {date ? formatDate(date, "PPP") : <span>Pick a date</span>}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(value) =>
                    value && setValue("date", value, { shouldValidate: true })
                  }
                  // The same range an ordinary transaction allows: today or
                  // earlier. Not a transfer-specific rule -- it is the app's
                  // existing one, and inventing a different one here would be
                  // inconsistent for no reason.
                  disabled={(value) =>
                    value > new Date() || value < new Date("1900-01-01")
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {errors.date && (
              <p className="text-sm text-negative">{errors.date.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Eyebrow as="label" htmlFor="transfer-description">
              Note · optional
            </Eyebrow>
            <Input
              id="transfer-description"
              placeholder="e.g. Setting aside for the deposit"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-sm text-negative">
                {errors.description.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t pt-5">
          {cancelSlot}
          <Button
            type="submit"
            className="flex-1 transition-transform active:scale-[0.99]"
            disabled={blocked}
          >
            Review transfer
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </form>
    );

  const asideContent = renderAside?.({
    step,
    source,
    destination,
    amount: Number(amount),
    projection,
    receipt,
  });

  if (!asideContent) return body;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8">
      {/* min-w-0 on both: a grid item defaults to min-width:auto, so the
          column cannot shrink below its content's min-content width and the
          whole form overflowed a phone by 200px. minmax(0,1fr) fixes the
          named column at lg; this is the same fix for the implicit single
          column below it. */}
      <div className="min-w-0">{body}</div>
      <aside className="min-w-0 lg:sticky lg:top-6">{asideContent}</aside>
    </div>
  );
};

// One side of the pair: a labelled select whose trigger carries the account's
// name, type and balance rather than its name alone.
const AccountField = ({
  id,
  label,
  accounts,
  value,
  onChange,
  disabledId = null,
  error,
}) => (
  <div className="space-y-1.5">
    <Eyebrow as="label" htmlFor={id}>
      {label}
    </Eyebrow>
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-invalid={Boolean(error)}
        className="h-auto min-h-[3.25rem] py-2 text-left transition-colors hover:bg-accent/50"
      >
        <SelectValue placeholder="Choose an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem
            key={account.id}
            value={account.id}
            disabled={disabledId ? account.id === disabledId : false}
          >
            <AccountLabel account={account} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {error && <p className="text-sm text-negative">{error}</p>}
  </div>
);

// Name over type and balance. Two lines rather than one, because the balance
// is the thing being decided against and a trailing grey run-on buried it --
// and because two accounts can share a name, where the type is what tells
// them apart.
const AccountLabel = ({ account }) => (
  <span className="flex w-full min-w-0 flex-col gap-0.5 text-left">
    <span className="truncate text-sm font-medium">{account.name}</span>
    <span className="truncate text-xs text-muted-foreground tabular-nums">
      {account.type === "SAVINGS" ? "Savings" : "Current"} ·{" "}
      {formatMoney(account.balance, account.currency)}
    </span>
  </span>
);

// One side of the review, before and after.
const Side = ({ label, account, before, after, direction }) => (
  <div className="rounded-xl border bg-card p-4">
    <Eyebrow>{label}</Eyebrow>
    <p className="mt-1 truncate text-sm font-medium">{account.name}</p>
    <p className="mt-2 text-sm text-muted-foreground tabular-nums">
      {formatMoney(before, account.currency)}
    </p>
    <p
      className={cn(
        "text-lg font-semibold tabular-nums",
        direction === "out" ? "text-negative" : "text-positive"
      )}
    >
      {formatMoney(after, account.currency)}
    </p>
  </div>
);

const Review = ({
  source,
  destination,
  amount,
  date,
  description,
  projection,
  loading,
  onBack,
  onConfirm,
}) => (
  <div className="space-y-6">
    {/* The figure, once, at the size it deserves on the screen that commits
        it. The accounts under it read as one sentence left to right. */}
    <div className="rounded-xl border bg-muted/30 px-5 py-6 text-center shadow-panel">
      <Eyebrow>Moving</Eyebrow>
      <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular-nums">
        {formatMoney(amount, source.currency)}
      </p>
      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{source.name}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">{destination.name}</span>
      </p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Side
        label="From"
        account={source}
        before={source.balance}
        after={projection?.source ?? source.balance}
        direction="out"
      />
      <Side
        label="To"
        account={destination}
        before={destination.balance}
        after={projection?.destination ?? destination.balance}
        direction="in"
      />
    </div>

    <dl className="divide-y rounded-xl border text-sm">
      <div className="flex justify-between gap-4 px-4 py-2.5">
        <dt className="text-muted-foreground">Date</dt>
        <dd>{date ? formatDate(date, "PPP") : "—"}</dd>
      </div>
      {description?.trim() ? (
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <dt className="text-muted-foreground">Note</dt>
          <dd className="truncate text-right">{description.trim()}</dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4 px-4 py-2.5">
        <dt className="text-muted-foreground">Recorded as</dt>
        {/* Said out loud, because it is the thing people get wrong about
            transfers and the reason this feature exists. */}
        <dd className="text-right">Transfer — not income or an expense</dd>
      </div>
      {/* No fee line and no conversion line: there are none. Both accounts are
          in one currency and WHealthOS charges nothing to move money between
          them, so a row reading "Fee: ₹0.00" would imply a fee that could be
          something else one day. */}
    </dl>

    <div className="flex gap-3 border-t pt-5">
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        onClick={onBack}
        disabled={loading}
      >
        Back
      </Button>
      <Button
        type="button"
        className="flex-1 transition-transform active:scale-[0.99]"
        onClick={onConfirm}
        // Disabled WHILE the request is in flight, which stops the second of
        // two fast clicks. It is not the protection, though -- the server's
        // idempotency key is, because a button is only as reliable as the
        // browser it is in.
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader className="mr-2 h-4 w-4 animate-spin" />
            Transferring...
          </>
        ) : (
          "Confirm transfer"
        )}
      </Button>
    </div>
  </div>
);

const Receipt = ({ receipt, onDone }) => {
  if (!receipt) return null;
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/30 px-5 py-6 text-center shadow-panel">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-positive/15 text-positive ring-1 ring-inset ring-positive/25">
          <Check className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
          {formatMoney(receipt.amount, receipt.currency)}
        </p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {receipt.from?.name ?? "—"}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="font-medium text-foreground">
            {receipt.to?.name ?? "—"}
          </span>
        </p>
      </div>

      <dl className="divide-y rounded-xl border text-sm">
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDate(new Date(receipt.date), "PPP")}</dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <dt className="text-muted-foreground">Recorded</dt>
          <dd>{formatDate(new Date(receipt.createdAt), "PPp")}</dd>
        </div>
        <div className="flex flex-col gap-1 px-4 py-2.5">
          <dt className="text-muted-foreground">Reference</dt>
          {/* The transfer's own id. Shown in full rather than shortened: it is
              what somebody would quote if they ever had to ask about this
              transfer, and half of it would be no use. Its own line, because
              at font-mono it is wider than half a drawer. */}
          <dd className="break-all font-mono text-xs">{receipt.id}</dd>
        </div>
      </dl>

      <Button
        type="button"
        className="w-full transition-transform active:scale-[0.99]"
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
};

export default TransferFlow;
