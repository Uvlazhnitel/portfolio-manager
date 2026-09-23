import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { personalCfoIdentity, type PersonalCfoIdentity } from "@/features/personal-cfo-integration/contract";

export type PersonalCfoConfiguration = {
  token: string;
  identity: PersonalCfoIdentity;
};

export type PersonalCfoAuthenticationResult =
  | { ok: true; configuration: PersonalCfoConfiguration }
  | { ok: false; status: 401 | 503; code: "UNAUTHORIZED" | "INTEGRATION_DISABLED"; message: string };

export function readPersonalCfoConfiguration(
  environment: Record<string, string | undefined> = process.env,
): PersonalCfoConfiguration | null {
  const token = environment.PERSONAL_CFO_API_TOKEN;
  const instanceId = environment.PORTFOLIO_INTEGRATION_INSTANCE_ID?.trim();
  if (!token?.trim() || !instanceId) return null;
  return { token, identity: personalCfoIdentity(instanceId) };
}

export function authenticatePersonalCfoRequest(
  authorization: string | null,
  configuration = readPersonalCfoConfiguration(),
): PersonalCfoAuthenticationResult {
  if (!configuration) {
    return {
      ok: false,
      status: 503,
      code: "INTEGRATION_DISABLED",
      message: "Personal CFO integration is not configured.",
    };
  }

  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const suppliedToken = match?.[1];
  if (!suppliedToken || !safeTokenEqual(suppliedToken, configuration.token)) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Valid bearer authentication is required.",
    };
  }

  return { ok: true, configuration };
}

export function safeTokenEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
