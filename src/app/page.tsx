import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">ABL</h1>
      <p className="text-lg text-foreground/80">
        A personal learning tutor for adults. ABL plans your path around your goals and fits
        it to the time you actually have.
      </p>
      <div className="flex gap-3">
        <Show when="signed-out">
          <SignUpButton>
            <button className="rounded-md bg-foreground px-4 py-2 text-background">
              Get started
            </button>
          </SignUpButton>
          <SignInButton>
            <button className="rounded-md border border-foreground/20 px-4 py-2">Sign in</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link href="/app" className="rounded-md bg-foreground px-4 py-2 text-background">
            Open ABL
          </Link>
        </Show>
      </div>
    </main>
  );
}
