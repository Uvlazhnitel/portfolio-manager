import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { mobileAddActionHref, mobileNavigationItems, navigationItems } from "@/components/layout/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("portfolio-first routing and navigation", () => {
  it("redirects root and dashboard to portfolio", async () => {
    const [{ default: Home }, { default: DashboardPage }, { redirect }] = await Promise.all([
      import("@/app/page"),
      import("@/app/dashboard/page"),
      import("next/navigation"),
    ]);

    expect(() => Home()).toThrow("NEXT_REDIRECT:/portfolio");
    expect(redirect).toHaveBeenCalledWith("/portfolio");
    expect(() => DashboardPage()).toThrow("NEXT_REDIRECT:/portfolio");
    expect(redirect).toHaveBeenCalledWith("/portfolio");
  });

  it("keeps dashboard and performance out of top-level desktop navigation", () => {
    expect(navigationItems.map((item) => item.label)).toEqual(["Portfolio", "Plan", "Intelligence", "Assistant", "Settings"]);
    expect(navigationItems.map((item) => item.href)).not.toContain("/dashboard");
    expect(navigationItems.map((item) => item.href)).not.toContain("/performance");
  });

  it("uses portfolio-first mobile navigation while keeping the central add action", () => {
    expect(mobileNavigationItems.map((item) => item.label)).toEqual(["Portfolio", "Plan", "Assistant", "More"]);
    expect(mobileNavigationItems.map((item) => item.href)).toEqual(["/portfolio", "/plan", "/assistant", "/more"]);
    expect(mobileAddActionHref).toBe("/portfolio?action=add-asset");
  });

  it("starts the installed app and offline retry flow at portfolio", async () => {
    const offlinePage = await readFile(path.join(projectRoot, "src/app/offline/page.tsx"), "utf8");

    expect(manifest().start_url).toBe("/portfolio");
    expect(offlinePage).toContain('href="/portfolio"');
    expect(offlinePage).not.toContain('href="/dashboard"');
  });

  it("keeps portfolio as the combined app surface without duplicating dashboard strategy warnings", async () => {
    const portfolioClient = await readFile(path.join(projectRoot, "src/app/portfolio/_components/portfolio-client.tsx"), "utf8");

    expect(portfolioClient).toContain('(["holdings", "accounts", "transactions"] as const)');
    expect(portfolioClient).toContain('href="/performance"');
    expect(portfolioClient).toContain("const violations = risk.violations.slice(0, 3);");
    expect(portfolioClient).not.toContain("risk.strategyViolations");
  });
});
