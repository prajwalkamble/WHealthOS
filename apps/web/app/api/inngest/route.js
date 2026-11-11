import { inngest } from "@/lib/inngest/client";
import { checkBudgetAlert, generateMonthlyReports, sendBudgetAlert, processRecurringTransaction, recordUptime, refreshExchangeRates, sendFeedbackNotification, sendMonthlyReport, sendSubscriptionConfirmation, sweepFeedbackNotifications, sweepSubscriptionNotifications, triggerRecurringTransactions } from "@/lib/inngest/functions";
import { serve } from "inngest/next";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    checkBudgetAlert,
    sendBudgetAlert,
    triggerRecurringTransactions,
    processRecurringTransaction,
    generateMonthlyReports,
    sendMonthlyReport,
    recordUptime,
    sendSubscriptionConfirmation,
    refreshExchangeRates,
    sweepSubscriptionNotifications,
    sendFeedbackNotification,
    sweepFeedbackNotifications,
  ],
});
