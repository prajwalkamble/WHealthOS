"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// The last thing between a failed checkout render and a stack trace.
//
// Without this, an error thrown while resolving somebody's subscription --
// an unapplied migration, a database that is briefly unreachable -- reaches
// the browser as Next's error overlay in development and a bare error page in
// production. On a payment screen that is the worst possible moment to show
// somebody something that looks like the site fell over, because the question
// they will actually have is "was I charged?".
//
// So: it answers that question first, and offers the status page, which reads
// the database rather than guessing.
const CheckoutError = ({ error, reset }) => {
  useEffect(() => {
    // The digest is what ties this to the server log. The message itself is
    // only present in development -- Next replaces it in production -- so
    // there is nothing here to leak either way.
    console.error({
      code: "CHECKOUT_RENDER_FAILED",
      details: { digest: error?.digest ?? null },
    });
  }, [error]);

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <AlertCircle className="h-7 w-7 text-negative" aria-hidden />
        <CardTitle className="mt-2">Something went wrong on our side</CardTitle>
        <CardDescription className="text-sm leading-6">
          This screen could not be loaded. If you had not pressed the payment
          button yet, nothing has been charged. If you had, the payment is
          unaffected by this — it is recorded by Razorpay and by us
          independently of this page, so check your plan rather than paying
          again.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/billing/success">Check my plan</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/contact">Billing support</Link>
          </Button>
        </div>

        {/* Only ever rendered outside production: Next replaces the message
            with a digest in a production build, so there is no path by which
            an internal error reaches a visitor. In development the person
            reading it is the person who has to fix it. */}
        {process.env.NODE_ENV !== "production" && error?.message && (
          <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            {error.message}
          </pre>
        )}
      </CardContent>
    </Card>
  );
};

export default CheckoutError;
