import { generateStructured } from "@/lib/ai/structured";

import { definePrompt, type GlossarySense } from "./glossary";
import { GLOSSARY_SKILL } from "./glossary.generated";
import { GlossaryEntry } from "./schemas";

/** Define a term the learner added, in the field it belongs to. */
export async function defineTerm(
  input: { term: string; note: string | null; learner: { currentRole: string; goal: string }; existing: GlossarySense[] },
  userId: string,
): Promise<GlossaryEntry> {
  const { output } = await generateStructured({
    task: "glossary_define",
    userId,
    instructions: GLOSSARY_SKILL,
    prompt: definePrompt(input),
    schema: GlossaryEntry,
  });
  return output;
}
