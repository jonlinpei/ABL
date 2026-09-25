import { describe, expect, it } from "vitest";

import { hasValue } from "./checks.mjs";

describe("hasValue", () => {
  it.each([
    ["No formal lessons, but used Duolingo for 2 months", true],
    ["Never finished a course, did 3 weeks of SQL", true],
    ["Nothing formal, but I took a Coursera class", true],
    ["Took a community college course in 2019", true],
    ["By March 15", true],
    ["None", false],
    ["none.", false],
    ["No deadline", false],
    ["Not set yet", false],
    ["First time learning this", false],
    ["Never tried before", false],
    ["None, first time", false],
    ["", false],
    [null, false],
  ])("hasValue(%j) is %s", (value, expected) => {
    expect(hasValue(value)).toBe(expected);
  });
});
