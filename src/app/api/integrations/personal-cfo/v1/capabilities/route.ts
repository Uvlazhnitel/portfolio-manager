import { personalCfoCapabilities } from "@/features/personal-cfo-integration/contract";
import { handlePersonalCfoGet, personalCfoJson } from "@/features/personal-cfo-integration/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handlePersonalCfoGet(request, ({ identity }) => (
    personalCfoJson(personalCfoCapabilities(identity))
  ));
}
