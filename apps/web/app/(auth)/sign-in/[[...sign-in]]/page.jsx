import { SignIn } from '@clerk/nextjs';
import { authAppearance } from '@/lib/clerk-appearance';

export default function Page() {
  // appearance: the card is branded from lib/clerk-appearance rather than
  // from whatever is uploaded in the Clerk dashboard. See that file.
  return <SignIn appearance={authAppearance} />;
}
