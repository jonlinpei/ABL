import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { samplePlan } from "@/lib/specialists/test-fixtures";

const currentGoal = vi.fn();
const loadSessionState = vi.fn();
const openCheckIn = vi.fn();
const getUser = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/lib/goals/goal-store", () => ({ currentGoal: (...a: unknown[]) => currentGoal(...a) }));
vi.mock("@/lib/specialists/session-state", () => ({ loadSessionState: (...a: unknown[]) => loadSessionState(...a) }));
vi.mock("@/lib/specialists/coach-store", () => ({ openCheckIn: (...a: unknown[]) => openCheckIn(...a) }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser: (...a: unknown[]) => getUser(...a) } }) }));

const { sendReminder } = await import("./send-reminder");

beforeEach(() => {
  for (const m of [currentGoal, loadSessionState, openCheckIn, getUser, fetchMock]) m.mockReset();
  vi.stubEnv("REMINDER_SECRET", "s3cret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_URL", "https://iamabl.com");
  vi.stubGlobal("fetch", fetchMock);
  currentGoal.mockResolvedValue({ id: "g1" });
  loadSessionState.mockResolvedValue({ brief: { brief: sampleBrief }, plan: { id: "p1", plan: samplePlan }, milestoneIndex: 1, active: undefined });
  getUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "maya@example.com" } });
  openCheckIn.mockResolvedValue({ message: "Busy week? Twenty minutes counts." });
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("sendReminder", () => {
  it("emails the next milestone and the coach's check-in, with one-click unsubscribe", async () => {
    expect(await sendReminder("user_1")).toEqual({ outcome: "sent" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["maya@example.com"]);
    expect(body.subject).toBe("A note from your coach, and your next step");
    expect(body.text).toContain(samplePlan.milestones[1]!.title);
    expect(body.text).toContain("https://iamabl.com/app/goals/g1");
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/iamabl\.com\/api\/reminders\/unsubscribe\?u=user_1&t=/);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("skips quietly without a plan, an email address, or email set up", async () => {
    loadSessionState.mockResolvedValueOnce(undefined);
    expect(await sendReminder("user_1")).toEqual({ outcome: "skipped", reason: "no_plan" });
    getUser.mockResolvedValueOnce({ primaryEmailAddress: null });
    expect(await sendReminder("user_1")).toEqual({ outcome: "skipped", reason: "no_email" });
    vi.stubEnv("RESEND_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendReminder("user_1")).toEqual({ outcome: "skipped", reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
