import { describe, expect, it } from "vitest";

import { localNow, reminderDue, reminderEmail, unsubscribeToken, validUnsubscribeToken } from "./reminders";

// Tuesday 2026-10-06 02:30 UTC is Monday 19:30 in Los Angeles and Tuesday 11:30 in Tokyo.
const now = new Date("2026-10-06T02:30:00Z");
const prefs = { enabled: true, days: [1, 3], time: "19:00", timeZone: "America/Los_Angeles", lastSentOn: null };

describe("localNow", () => {
  it("reads the weekday, date and time in the learner's zone", () => {
    expect(localNow(now, "America/Los_Angeles")).toEqual({ weekday: 1, date: "2026-10-05", minutes: 19 * 60 + 30 });
    expect(localNow(now, "Asia/Tokyo")).toEqual({ weekday: 2, date: "2026-10-06", minutes: 11 * 60 + 30 });
  });
});

describe("reminderDue", () => {
  it("is due on a chosen day, at or after their time, once a day", () => {
    expect(reminderDue(prefs, now)).toEqual({ due: true, localDate: "2026-10-05" });
    expect(reminderDue({ ...prefs, lastSentOn: "2026-10-05" }, now).due).toBe(false);
    expect(reminderDue({ ...prefs, time: "20:00" }, now).due).toBe(false);
    expect(reminderDue({ ...prefs, days: [2] }, now).due).toBe(false);
    expect(reminderDue({ ...prefs, enabled: false }, now).due).toBe(false);
  });

  it("catches up on a missed run within three hours, not later", () => {
    expect(reminderDue({ ...prefs, time: "16:31" }, now).due).toBe(true);
    expect(reminderDue({ ...prefs, time: "16:29" }, now).due).toBe(false);
  });

  it("is never due for an unknown time zone", () => {
    expect(reminderDue({ ...prefs, timeZone: "Mars/Olympus" }, now)).toEqual({ due: false, localDate: "" });
  });
});

describe("unsubscribe tokens", () => {
  it("only accept the token signed for that learner with this secret", () => {
    const t = unsubscribeToken("user_1", "s3cret");
    expect(validUnsubscribeToken("user_1", t, "s3cret")).toBe(true);
    expect(validUnsubscribeToken("user_2", t, "s3cret")).toBe(false);
    expect(validUnsubscribeToken("user_1", t, "other")).toBe(false);
    expect(validUnsubscribeToken("user_1", "x", "s3cret")).toBe(false);
  });
});

describe("reminderEmail", () => {
  const base = { goalTitle: "Data Analyst", nextStep: "Join tables", sessionMinutes: 45, goalUrl: "https://x/app/goals/g", unsubscribeUrl: "https://x/u", settingsUrl: "https://x/s" };
  it("leads with the coach's check-in when there is one, and always offers a way to stop", () => {
    const withNote = reminderEmail({ ...base, checkIn: "Busy week? A 20-minute session counts <3" });
    expect(withNote.subject).toBe("A note from your coach, and your next step");
    expect(withNote.text.split("\n")[0]).toBe("Busy week? A 20-minute session counts <3");
    expect(withNote.html).toContain("counts &lt;3");
    expect(withNote.text).toContain("Stop reminders: https://x/u");
    const plain = reminderEmail({ ...base, checkIn: null });
    expect(plain.subject).toBe("Your next 45 minutes: Join tables");
    expect(plain.html).toContain('href="https://x/u"');
  });
});
