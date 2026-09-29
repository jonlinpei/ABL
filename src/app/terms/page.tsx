import type { Metadata } from "next";

import { SimpleMarkdown } from "@/components/simple-markdown";
import { legalDocument } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · ABL" };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <SimpleMarkdown source={legalDocument("terms-of-service")} />
    </main>
  );
}
