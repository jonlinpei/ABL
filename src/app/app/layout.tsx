import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

/**
 * Everything under /app requires a signed-in user. The check lives here, next
 * to the resource, rather than in proxy.ts path matching. Signed-out visitors
 * are redirected to the sign-in page.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  await auth.protect();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-foreground/10 px-6 py-3">
        <Link href="/app" className="font-semibold">
          ABL
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/app/glossary" className="text-sm text-foreground/70 hover:text-foreground">
            Glossary
          </Link>
          <Link href="/app/about-me" className="text-sm text-foreground/70 hover:text-foreground">
            What ABL knows about me
          </Link>
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
