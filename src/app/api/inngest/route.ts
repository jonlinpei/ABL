import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Specialist steps call models, so give each invocation room to finish.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
