"use client";

import {
  SignInButton,
  SignUpButton,
  Show,
} from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Layers01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function RedirectToTimeline() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/timeline");
  }, [router]);
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function Home() {
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
                <HugeiconsIcon icon={Layers01Icon} size={24} color="currentColor" />
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">
                UniFocus
              </h1>
              <p className="text-sm text-muted-foreground">
                AI-powered productivity. Tasks and projects — unified.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2.5">
              <SignInButton mode="modal" forceRedirectUrl="/timeline">
                <Button className="w-full" size="lg">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl="/timeline">
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
