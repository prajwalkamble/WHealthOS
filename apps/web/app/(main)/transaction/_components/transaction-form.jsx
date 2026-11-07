"use client";

import { createTransaction, updateTransaction } from '@/actions/transaction';
import { transactionSchema } from '@/app/lib/schema';
import CreateAccountDrawer from '@/components/create-account-drawer';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import useFetch from '@/hooks/use-fetch';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { CalendarIcon, Loader, Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ReceiptScanner } from './receipt-scanner';
import { useCurrency } from '@/components/currency-provider';
import Link from 'next/link';

// Stands in for the scanner in demo mode, saying plainly why it is
// unavailable and where to go, rather than showing a button that fails.
const LockedReceiptScanner = () => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Lock className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-medium">Scan Receipt with AI</p>
        <p className="text-sm text-muted-foreground">
          Available once you create an account.
        </p>
      </div>
    </div>
    <Button asChild size="sm" variant="outline">
      <Link href="/sign-up">Create account</Link>
    </Button>
  </div>
);

// guest: demo mode. The same form, but it hands the values to onGuestSubmit --
// which keeps them in the browser -- instead of calling the server action,
// and the receipt scanner is locked, since scanning spends Gemini quota and
// there is no account to rate-limit against.
export function AddTransactionForm ({
  accounts,
  categories,
  editMode = false,
  initialData = null,
  guest = false,
  onGuestSubmit,
}) {
  const router = useRouter();
  // Aliased: `format` in this file is date-fns'. The balance beside each
  // account in the picker has to agree with the balance on that account's
  // card, which means going through the same formatter rather than a
  // hardcoded rupee sign.
  const { format: formatCurrency } = useCurrency();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const {
    register,
    handleSubmit,
    formState: {errors},
    watch,
    setValue,
    getValues,
    reset,
  } = useForm({
    resolver: zodResolver(transactionSchema),
    defaultValues:
    editMode && initialData
    ? {
        type: initialData.type,
        amount: initialData.amount.toString(),
        description: initialData.description ?? "",
        accountId: initialData.accountId,
        category: initialData.category,
        date: new Date(initialData.date),
        isRecurring: initialData.isRecurring,
        ...(initialData.recurringInterval && {
          recurringInterval: initialData.recurringInterval,
        }),
      }
    : {
        type: "EXPENSE",
        amount: "",
        description: "",
        accountId: accounts.find((ac) => ac.isDefault)?.id,
        date: new Date(),
        isRecurring: false,
      },
  });

  const {
    loading: transactionLoading,
    fn: transactionFn,
    data: transactionResult,
  } = useFetch(editMode ? updateTransaction : createTransaction);

  const onSubmit = async (data) => {
    const formData = {
      ...data,
      amount: parseFloat(data.amount),
    };

    if (guest) {
      onGuestSubmit?.(formData);
      reset();
      return;
    }

    if (editMode) {
      transactionFn(editId, formData)
    } else {
      transactionFn(formData);
    }
  };

  useEffect(() => {
    // Demo mode never calls the action, so there is no result to react to.
    if (guest) return;
    if (transactionResult?.success && !transactionLoading) {
      toast.success(
        editMode
          ? "Transaction updated successfully"
          : "Transaction created successfully"
      );
      reset();
      router.push(`/account/${transactionResult.data.accountId}`);
    }
  }, [transactionResult, transactionLoading, editMode, guest, reset, router]);

  const handleScanComplete = (scannedData) => {
    if (scannedData) {
      // A receipt is money going out. The scanner only ever suggests expense
      // categories, so the type has to match or the category is rejected.
      setValue("type", "EXPENSE");
      setValue("amount", scannedData.amount.toString());
      setValue("date", new Date(scannedData.date));
      if (scannedData.description) {
        setValue("description", scannedData.description);
      }
      if (scannedData.category) {
        setValue("category", scannedData.category);
      }
      toast.success("Receipt Scanned Successfully");
    }
  };

  const type = watch("type");
  const isRecurring = watch("isRecurring");
  const date = watch("date");
  const category = watch("category");
  const accountId = watch("accountId");

  const filteredCategories = categories.filter(
    (category) => category.type === type
  );

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
        {/* AI Receipt Scanner. Locked in demo mode: a scan is a Gemini
            request, and the rate limiter keys on a signed-in user. */}
        {!editMode &&
          (guest ? (
            <LockedReceiptScanner />
          ) : (
            <ReceiptScanner onScanComplete={handleScanComplete} />
          ))}

      {/* Type */}
      <div className="space-y-2">
        <label htmlFor="transaction-type" className="text-sm font-medium">
          Type
        </label>
        <Select
          onValueChange={(value) => {
            setValue("type", value);
            // Categories are type-specific. Keeping the old selection let an
            // expense category ride along on an income transaction.
            if (getValues("category")) {
              setValue("category", "", { shouldValidate: false });
            }
          }}
          value={type}
        >
          <SelectTrigger
            id="transaction-type"
            aria-invalid={Boolean(errors.type)}
            aria-describedby={errors.type ? "transaction-type-error" : undefined}
          >
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="INCOME">Income</SelectItem>
          </SelectContent>
        </Select>

        {errors.type && (
          <p id="transaction-type-error" className="text-sm text-negative">
            {errors.type.message}
          </p>
        )}
      </div>

      {/* Amount and Account */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="transaction-amount" className="text-sm font-medium">
            Amount
          </label>
          <Input
            id="transaction-amount"
            type="number"
            step="0.01"
            placeholder="0.00"
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={
              errors.amount ? "transaction-amount-error" : undefined
            }
            {...register("amount")}
          />

          {errors.amount && (
            <p id="transaction-amount-error" className="text-sm text-negative">
              {errors.amount.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="transaction-account" className="text-sm font-medium">
            Account
          </label>
          <Select
            onValueChange={(value) =>
              setValue("accountId", value, { shouldValidate: true })
            }
            value={accountId ?? ""}
          >
            <SelectTrigger
              id="transaction-account"
              aria-invalid={Boolean(errors.accountId)}
              aria-describedby={
                errors.accountId ? "transaction-account-error" : undefined
              }
            >
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} ({formatCurrency(parseFloat(account.balance))})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Outside the dropdown: inside it, the drawer was part of the
              dropdown's content and unmounted as soon as the dropdown closed. */}
          <CreateAccountDrawer
            onCreated={(account) => {
              setValue("accountId", account.id, { shouldValidate: true });
              // Reload the server-rendered account list so the new one appears.
              router.refresh();
            }}
          >
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm"
            >
              + Create a new account
            </Button>
          </CreateAccountDrawer>

          {errors.accountId && (
            <p id="transaction-account-error" className="text-sm text-negative">
              {errors.accountId.message}
            </p>
          )}
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <label htmlFor="transaction-category" className="text-sm font-medium">
          Category
        </label>
        {/* Controlled, not defaultValue: Radix reads defaultValue once, so the
            trigger kept showing the old label after a receipt scan or a type
            change had already rewritten the form value underneath it. */}
        <Select
          onValueChange={(value) => setValue("category", value)}
          value={category ?? ""}
        >
          <SelectTrigger
            id="transaction-category"
            aria-invalid={Boolean(errors.category)}
            aria-describedby={
              errors.category ? "transaction-category-error" : undefined
            }
          >
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {errors.category && (
          <p id="transaction-category-error" className="text-sm text-negative">
            {errors.category.message}
          </p>
        )}
      </div>

      {/* Date */}
      <div className="space-y-2">
        <label htmlFor="transaction-date" className="text-sm font-medium">
          Date
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="transaction-date"
              variant="outline"
              className="w-full pl-3 text-left font-normal"
              aria-invalid={Boolean(errors.date)}
              aria-describedby={
                errors.date ? "transaction-date-error" : undefined
              }
            >
              {date ? format(date, "PPP") : <span>Pick a date</span>}
              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(date) => setValue("date", date)}
              disabled={(date) =>
                date > new Date() || date < new Date("1900-01-01")
              }
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {errors.date && (
          <p id="transaction-date-error" className="text-sm text-negative">
            {errors.date.message}
          </p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label htmlFor="transaction-description" className="text-sm font-medium">
          Description
        </label>
        <Input
          id="transaction-description"
          placeholder="Enter description"
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description ? "transaction-description-error" : undefined
          }
          {...register("description")}
        />
        {errors.description && (
          <p
            id="transaction-description-error"
            className="text-sm text-negative"
          >
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Recurring Toggle */}
      <div className="flex flex-row items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <label
            htmlFor="transaction-recurring"
            className="cursor-pointer text-base font-medium"
          >
            Recurring Transaction
          </label>

          <p className="text-sm text-muted-foreground">
            Set up a recurring schedule for this transaction
          </p>
        </div>
        <Switch
          id="transaction-recurring"
          checked={isRecurring}
          onCheckedChange={(checked) => setValue("isRecurring", checked)}
        />
      </div>

      {/* Recurring Interval */}
      {isRecurring && (
        <div className="space-y-2">
          <label htmlFor="transaction-interval" className="text-sm font-medium">
            Recurring Interval
          </label>
          <Select
            onValueChange={(value) => setValue("recurringInterval", value)}
            defaultValue={getValues("recurringInterval")}
          >
            <SelectTrigger
              id="transaction-interval"
              aria-invalid={Boolean(errors.recurringInterval)}
              aria-describedby={
                errors.recurringInterval
                  ? "transaction-interval-error"
                  : undefined
              }
            >
              <SelectValue placeholder="Select interval" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
              <SelectItem value="MONTHLY">Monthly</SelectItem>
              <SelectItem value="YEARLY">Yearly</SelectItem>
            </SelectContent>
          </Select>
          {errors.recurringInterval && (
            <p
              id="transaction-interval-error"
              className="text-sm text-negative"
            >
              {errors.recurringInterval.message}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" className="w-full" disabled={transactionLoading}>
          {transactionLoading ? (
            <>
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              {editMode ? "Updating..." : "Creating..."}
            </>
          ) : editMode ? (
            "Update Transaction"
          ) : (
            "Create Transaction"
          )}
        </Button>
      </div>
    </form>
  );
}
