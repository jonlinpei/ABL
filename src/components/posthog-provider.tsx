"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useRef } from "react";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!token) return; // analytics disabled when no token is configured
    posthog.init(token, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      // Config snapshot date. Includes automatic $pageview capture on
      // client-side (history API) navigations, which the App Router uses.
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      // The privacy policy promises both: a Do Not Track signal turns
      // analytics off, and session replays hide page text (conversations,
      // resumes, briefs) and form fields, keeping only layout and clicks.
      respect_dnt: true,
      session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <IdentifyUser />
      {children}
    </PHProvider>
  );
}

/** Tie PostHog's anonymous id to the Clerk user once signed in. */
function IdentifyUser() {
  const { isLoaded, user } = useUser();
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !isLoaded) return;
    if (user && identifiedId.current !== user.id) {
      posthog.identify(user.id);
      identifiedId.current = user.id;
    } else if (!user && identifiedId.current) {
      posthog.reset(); // signed out: start a fresh anonymous id
      identifiedId.current = null;
    }
  }, [isLoaded, user]);

  return null;
}
