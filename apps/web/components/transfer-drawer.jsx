"use client";

import { useState } from "react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./ui/drawer";
import { Button } from "./ui/button";
import TransferFlow, { STEP, transferCopy } from "./transfer-flow";

// The drawer way into a transfer, from /accounts and from an account's own
// page. The page at /transfer is the other way in, and both render the same
// TransferFlow -- see the note at the top of transfer-flow.jsx for why the
// flow does not live in either of them.
//
// Everything this adds is the shell: a trigger, a header that follows the
// step, and a Cancel that closes rather than navigates.
const TransferDrawer = ({
  children,
  accounts = [],
  defaultFromAccountId = null,
}) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(STEP.FORM);
  // Bumped on every close, and used as the flow's key.
  //
  // Remounting is the reset. The alternative -- a reset() the drawer calls --
  // has to be kept in step with every piece of state the flow gains later,
  // and the first one that is forgotten shows the last transfer's receipt to
  // somebody opening the drawer for a new one.
  const [session, setSession] = useState(0);

  const close = (next) => {
    setOpen(next);
    if (!next) {
      // On close rather than on open, so the drawer never flashes the last
      // transfer's summary while the new one mounts.
      setSession((n) => n + 1);
      setStep(STEP.FORM);
    }
  };

  const copy = transferCopy(step);

  return (
    <Drawer open={open} onOpenChange={close}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent className="max-h-[92vh] overflow-y-auto">
        {/* A measure, which this drawer needs and the app's others do not.
            A vaul bottom drawer is the full width of the window, which suits
            a stack of ordinary fields; it does not suit a display figure and
            a side-by-side pair, and at 1280px the amount input came out
            1166px wide with the number alone at the far left. */}
        <div className="mx-auto w-full max-w-2xl">
          <DrawerHeader>
            <DrawerTitle>{copy.title}</DrawerTitle>
            <DrawerDescription>{copy.description}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-6">
            <TransferFlow
              key={session}
              accounts={accounts}
              defaultFromAccountId={defaultFromAccountId}
              onStepChange={setStep}
              onDone={() => close(false)}
              cancelSlot={
                <DrawerClose asChild>
                  <Button type="button" variant="outline" className="flex-1">
                    Cancel
                  </Button>
                </DrawerClose>
              }
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default TransferDrawer;
