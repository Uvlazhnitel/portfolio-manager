import { afterEach, describe, expect, it } from "vitest";
import * as capabilitiesRoute from "@/app/api/integrations/personal-cfo/v1/capabilities/route";
import * as capitalFlowsRoute from "@/app/api/integrations/personal-cfo/v1/capital-flows/route";
import {
  authenticatePersonalCfoRequest,
  readPersonalCfoConfiguration,
  safeTokenEqual,
} from "@/features/personal-cfo-integration/auth";

const originalToken = process.env.PERSONAL_CFO_API_TOKEN;
const originalInstanceId = process.env.PORTFOLIO_INTEGRATION_INSTANCE_ID;

afterEach(() => {
  restoreEnvironment("PERSONAL_CFO_API_TOKEN", originalToken);
  restoreEnvironment("PORTFOLIO_INTEGRATION_INSTANCE_ID", originalInstanceId);
});

describe("Personal CFO integration authentication", () => {
  it("is disabled until both server-only settings are configured", () => {
    expect(readPersonalCfoConfiguration({})).toBeNull();
    expect(readPersonalCfoConfiguration({ PERSONAL_CFO_API_TOKEN: "token" })).toBeNull();
    expect(readPersonalCfoConfiguration({ PORTFOLIO_INTEGRATION_INSTANCE_ID: "primary" })).toBeNull();
  });

  it("compares valid tokens without accepting different values", () => {
    expect(safeTokenEqual("a-secret-token", "a-secret-token")).toBe(true);
    expect(safeTokenEqual("a-secret-token", "another-token-with-a-different-length")).toBe(false);
  });

  it("rejects missing, malformed, and invalid credentials identically", () => {
    const configuration = readPersonalCfoConfiguration({
      PERSONAL_CFO_API_TOKEN: "correct-token",
      PORTFOLIO_INTEGRATION_INSTANCE_ID: "household-portfolio",
    });
    expect(configuration).not.toBeNull();
    for (const authorization of [null, "correct-token", "Basic correct-token", "Bearer wrong-token", "Bearer correct-token extra"]) {
      expect(authenticatePersonalCfoRequest(authorization, configuration)).toEqual({
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Valid bearer authentication is required.",
      });
    }
    expect(authenticatePersonalCfoRequest("Bearer correct-token", configuration)).toEqual({
      ok: true,
      configuration,
    });
  });

  it("returns stable protected capability responses with private-cache headers", async () => {
    delete process.env.PERSONAL_CFO_API_TOKEN;
    delete process.env.PORTFOLIO_INTEGRATION_INSTANCE_ID;
    const disabled = await capabilitiesRoute.GET(new Request("http://localhost/api/integrations/personal-cfo/v1/capabilities"));
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({
      error: { code: "INTEGRATION_DISABLED", message: "Personal CFO integration is not configured." },
    });

    process.env.PERSONAL_CFO_API_TOKEN = "route-secret-token";
    process.env.PORTFOLIO_INTEGRATION_INSTANCE_ID = "household-portfolio";
    const missing = await capabilitiesRoute.GET(new Request("http://localhost/api/integrations/personal-cfo/v1/capabilities"));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");

    const valid = await capabilitiesRoute.GET(new Request(
      "http://localhost/api/integrations/personal-cfo/v1/capabilities",
      { headers: { Authorization: "Bearer route-secret-token" } },
    ));
    const body = await valid.json();
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toBe("no-store");
    expect(valid.headers.get("vary")).toBe("Authorization");
    expect(valid.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toEqual(expect.objectContaining({
      contractVersion: "portfolio-manager-personal-cfo-v1",
      provider: "portfolio-manager",
      providerInstanceId: "household-portfolio",
      portfolioId: "household-portfolio",
      capabilities: expect.objectContaining({
        totalMarketValue: true,
        revisionsCorrections: true,
        pnl: false,
        fxInformation: false,
      }),
    }));
    expect(JSON.stringify(body)).not.toContain("route-secret-token");
    expect("POST" in capabilitiesRoute).toBe(false);
    expect("POST" in capitalFlowsRoute).toBe(false);

    const queryCredential = await capabilitiesRoute.GET(new Request(
      "http://localhost/api/integrations/personal-cfo/v1/capabilities?token=route-secret-token",
    ));
    expect(queryCredential.status).toBe(401);

    const invalidCursor = await capitalFlowsRoute.GET(new Request(
      "http://localhost/api/integrations/personal-cfo/v1/capital-flows?cursor=not-valid",
      { headers: { Authorization: "Bearer route-secret-token" } },
    ));
    expect(invalidCursor.status).toBe(400);
    expect(invalidCursor.headers.get("cache-control")).toBe("no-store");
    expect(await invalidCursor.json()).toEqual({
      error: { code: "INVALID_CURSOR", message: "cursor is invalid." },
    });
  });
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
