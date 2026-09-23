import { buildPersonalCfoCapitalFlows } from "@/features/personal-cfo-integration/capital-flows";
import { handlePersonalCfoGet, personalCfoJson } from "@/features/personal-cfo-integration/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handlePersonalCfoGet(request, async ({ identity }) => {
    const searchParams = new URL(request.url).searchParams;
    return personalCfoJson(await buildPersonalCfoCapitalFlows({
      identity,
      cursor: searchParams.get("cursor"),
      limit: searchParams.get("limit"),
    }));
  });
}
