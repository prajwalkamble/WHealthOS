"use client";

import { updateDefaultAccount } from '@/actions/accounts';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import useFetch from '@/hooks/use-fetch';
import { useCurrency } from '@/components/currency-provider';
import PrefetchLink from '@/components/navigation/prefetch-link';
import React, { useEffect } from 'react'
import { toast } from 'sonner';

const AccountCard = ({ account }) => {
  const { name, type, balance, id, isDefault, _count } = account;
  const { format: formatCurrency } = useCurrency();
  const count = _count?.transactions ?? 0;

  const {
    loading: updateDefaultLoading,
    fn: updateDefaultFn,
    data: updatedAccount,
  } = useFetch(updateDefaultAccount);

  const handleDefaultChange = async (checked) => {
    if (isDefault) {
      toast.warning("You need at least 1 default account");
      return; // Don't allow toggling off the default account
    }

    if (!checked) return;

    await updateDefaultFn(id);
  };

  useEffect(() => {
    if (updatedAccount?.success) {
      toast.success("Default account updated successfully");
    }
  }, [updatedAccount]);

  // updateDefaultAccount throws on failure and useFetch raises the toast, so
  // there is deliberately no error effect here.

  return (
    <Card className="hover:shadow-md transition-shadow group relative">
      {/* Outside the Link: a Switch renders a <button>, and a <button> inside
          an <a> is invalid HTML that React flags during hydration. */}
      <div className="absolute right-6 top-5 z-10">
        <Switch
          checked={isDefault}
          onCheckedChange={handleDefaultChange}
          disabled={updateDefaultLoading}
          aria-label={`Make ${name} the default account`}
        />
      </div>

      <PrefetchLink href={`/account/${id}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium capitalize pr-14">
            {name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Through the formatter, not a pasted glyph: the balance has to
              follow the currency the viewer chose, and it printed a hardcoded
              rupee sign with no digit grouping until now. */}
          <div className="text-2xl font-bold tabular-nums tracking-tight">
            {formatCurrency(parseFloat(balance))}
          </div>
          <p className="text-xs text-muted-foreground">
            {type.charAt(0) + type.slice(1).toLowerCase()} Account
          </p>
        </CardContent>
        {/* This row used to be an up arrow labelled "Income" beside a down
            arrow labelled "Expense", with no figure against either -- the
            same two words on every card, carrying nothing. The account's
            transaction count is already loaded and is the thing a person
            actually wants here. */}
        <CardFooter className="text-sm text-muted-foreground">
          {count === 0
            ? "No transactions yet"
            : `${count} transaction${count === 1 ? "" : "s"}`}
        </CardFooter>
      </PrefetchLink>
    </Card>
  );
};

export default AccountCard;
