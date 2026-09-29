import type { Metadata } from "next";

import { SimpleMarkdown } from "@/components/simple-markdown";
import { legalDocument } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · ABL" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <SimpleMarkdown source={legalDocument("privacy-policy")} />
    </main>
  );
}
