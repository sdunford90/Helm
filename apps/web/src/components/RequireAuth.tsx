import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { Outlet } from 'react-router-dom';

/** Route guard: signed-in users see the nested routes, everyone else is sent to Clerk sign-in. */
export default function RequireAuth() {
  return (
    <>
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
