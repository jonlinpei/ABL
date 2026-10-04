import { beforeEach, describe, expect, it, vi } from "vitest";

import { unsubscribeToken } from "@/lib/reminders/reminders";

const auth = vi.fn();
const loadReminderPrefs = vi.fn();
const saveReminderPrefs = vi.fn();
const unsubscribeReminders = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/reminders/reminder-store", () => ({
  loadReminderPrefs: (...a: unknown[]) => loadReminderPrefs(...a),
  saveReminderPrefs: (...a: unknown[]) => saveReminderPrefs(...a),
  unsubscribeReminders: (...a: unknown[]) => unsubscribeReminders(...a),
}));

const { GET, PUT } = await import("./route");
const { GET: UNSUB, POST: ONE_CLICK } = await import("./unsubscribe/route");
const put = (body: unknown) => new Request("http://t", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  for (const m of [loadReminderPrefs, saveReminderPrefs, unsubscribeReminders]) m.mockReset();
  auth.mockResolvedValue({ userId: "user_1" });
  vi.stubEnv("REMINDER_SECRET", "s3cret");
  vi.stubEnv("RESEND_API_KEY", "");
});

describe("/api/reminders", () => {
  it("has sensible defaults before the learner sets anything, and says whether email is set up", async () => {
    loadReminderPrefs.mockResolvedValue(undefined);
    expect(await (await GET()).json()).toEqual({ enabled: false, days: [1, 2, 3, 4], time: "19:00", timeZone: "America/Los_Angeles", unsubscribed: false, emailReady: false });
  });

  it("saves valid settings, deduped and sorted, and rejects bad ones", async () => {
    loadReminderPrefs.mockResolvedValue(undefined);
    expect((await PUT(put({ enabled: true, days: [3, 1, 3], time: "07:30", timeZone: "Europe/London" }))).status).toBe(200);
    expect(saveReminderPrefs).toHaveBeenCalledWith("user_1", { enabled: true, days: [1, 3], time: "07:30", timeZone: "Europe/London" });
    for (const bad of [
      { enabled: true, days: [], time: "07:30", timeZone: "Europe/London" },
      { enabled: true, days: [1], time: "25:00", timeZone: "Europe/London" },
      { enabled: true, days: [1], time: "07:30", timeZone: "Mars/Olympus" },
    ]) expect((await PUT(put(bad))).status, JSON.stringify(bad)).toBe(400);
  });
});

describe("/api/reminders/unsubscribe", () => {
  it("unsubscribes with a valid signed link, and does nothing without one", async () => {
    const t = unsubscribeToken("user_1", "s3cret");
    const ok = await UNSUB(new Request(`http://t/api/reminders/unsubscribe?u=user_1&t=${t}`));
    expect(await ok.text()).toContain("You won't get reminders");
    expect(unsubscribeReminders).toHaveBeenCalledWith("user_1");
    expect((await ONE_CLICK(new Request(`http://t/api/reminders/unsubscribe?u=user_2&t=${t}`, { method: "POST" }))).status).toBe(400);
    expect(unsubscribeReminders).toHaveBeenCalledTimes(1);
  });
});
