import { getUserAccounts } from '@/lib/queries';
import { defaultCategories } from '@/data/categories';
import { AddTransactionForm } from '../_components/transaction-form';
import { getTransaction } from '@/actions/transaction';
import { notFound } from 'next/navigation';
import { checkUser } from '@/lib/checkUser';
import { planIdFromRows } from '@/lib/billing/service';
import { devGrantsAll } from '@/lib/billing/dev-override';
import { enforcementEnabled, planGrants } from '@/lib/billing/entitlements';

// Whether to offer the scanner, decided on the server.
//
// Receipt scanning became an Intelligent feature on 2026-11-10, and
// actions/transaction.js refuses it for anything less before the image is even
// read. This is the other half: a control that would be refused should not be
// offered, which the form already has a treatment for -- it locks the scanner
// in demo mode for the same reason, a scan being a Gemini request that needs a
// signed-in account.
//
// enforcementEnabled() is in the condition deliberately, exactly as in
// components/billing/feature-gate.jsx: while enforcement is off the action
// lets everybody through, and a padlock over a control that works is its own
// kind of lie.
const mayScan = async () => {
  if (!enforcementEnabled()) return true;
  const user = await checkUser();
  // Offered to the development account because actions/transaction.js will in
  // fact accept the scan from it -- the two halves have to agree.
  if (devGrantsAll(user?.id)) return true;
  return planGrants(planIdFromRows(user?.subscriptions), "ai.receipts");
};

export default async function AddTransactionPage({ searchParams }) {
  const accounts = await getUserAccounts();
  const { edit: editId } = (await searchParams) ?? {};
  const canScan = await mayScan();

  let initialData = null;
  if (editId) {
    initialData = await getTransaction(editId);
    // A stale or foreign id used to crash the page; it is simply not found.
    if (!initialData) notFound();
  }

  return (
    <div className="max-w-3xl mx-auto px-5">
      <h1 className="text-5xl gradient-title mb-8">
        {editId ? "Edit" : "Add"} Transaction
      </h1>

      <AddTransactionForm
        accounts={accounts}
        categories={defaultCategories}
        editMode={!!editId}
        initialData={initialData}
        canScan={canScan}
      />
    </div>
  );
}
