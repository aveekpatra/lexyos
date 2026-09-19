"use client";

import {
  SignInButton,
  SignUpButton,
  Show,
} from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IoPrism } from "react-icons/io5";

/** Where to go after sign-in: a same-origin path from ?redirect_url (OAuth consent), else the timeline. */
function useAfterSignIn(): string {
  const sp = useSearchParams();
  const r = sp.get("redirect_url") ?? "";
  return r.startsWith("/") && !r.startsWith("//") ? r : "/timeline";
}

function RedirectToTimeline() {
  const router = useRouter();
  const to = useAfterSignIn();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function Home() {
  const to = useAfterSignIn();
  return (
    <>
      <Show when="signed-in">
        <RedirectToTimeline />
      </Show>
      <Show when="signed-out">
        <div className="flex min-h-svh flex-col items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-8 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <IoPrism size={24} />
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Mindbook
              </h1>
              <p className="text-sm text-muted-foreground">
                AI-powered productivity. Tasks and projects — unified.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2.5">
              <SignInButton mode="modal" forceRedirectUrl={to}>
                <Button className="w-full" size="lg">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl={to}>
                <Button variant="outline" className="w-full" size="lg">
                  Create account
                </Button>
              </SignUpButton>
            </div>

            <p className="text-xs text-muted-foreground">
              Your tasks live in the cloud, always in sync.
            </p>
          </div>
        </div>
      </Show>
    </>
  );
}
