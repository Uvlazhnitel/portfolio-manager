import { handlePersonalCfoGet, personalCfoJson } from "@/features/personal-cfo-integration/http";
import { buildPersonalCfoSnapshot } from "@/features/personal-cfo-integration/snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handlePersonalCfoGet(request, async ({ identity }) => (
    personalCfoJson(await buildPersonalCfoSnapshot({ identity }))
  ));
}
