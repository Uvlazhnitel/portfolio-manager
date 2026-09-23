import "server-only";

import { authenticatePersonalCfoRequest, type PersonalCfoConfiguration } from "@/features/personal-cfo-integration/auth";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
} as const;

export class PersonalCfoRequestError extends Error {
  constructor(
    readonly status: 400,
    readonly code: "INVALID_CURSOR" | "INVALID_LIMIT",
    message: string,
  ) {
    super(message);
    this.name = "PersonalCfoRequestError";
  }
}

export function personalCfoJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
  return Response.json(body, { ...init, headers });
}

export async function handlePersonalCfoGet(
  request: Request,
  handler: (configuration: PersonalCfoConfiguration) => Promise<Response> | Response,
) {
  const authentication = authenticatePersonalCfoRequest(request.headers.get("authorization"));
  if (!authentication.ok) {
    return personalCfoJson({
      error: { code: authentication.code, message: authentication.message },
    }, {
      status: authentication.status,
      headers: authentication.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    });
  }

  try {
    return await handler(authentication.configuration);
  } catch (error) {
    if (error instanceof PersonalCfoRequestError) {
      return personalCfoJson({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return personalCfoJson({
      error: { code: "INTERNAL_ERROR", message: "Personal CFO integration request failed." },
    }, { status: 500 });
  }
}
