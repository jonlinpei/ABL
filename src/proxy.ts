import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 renamed middleware.ts to proxy.ts.
// clerkMiddleware() makes auth state available to server code. Route
// protection happens next to the resource (see src/app/app/layout.tsx), per
// Clerk's current guidance, not by path matching here.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
