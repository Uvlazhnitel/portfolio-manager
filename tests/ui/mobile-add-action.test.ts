import { describe, expect, it } from "vitest";
import { mobileAddActionHref } from "@/components/layout/navigation";

describe("mobile add action", () => {
  it("routes the central add button to the portfolio asset flow", () => {
    expect(mobileAddActionHref).toBe("/portfolio?action=add-asset");
  });
});
