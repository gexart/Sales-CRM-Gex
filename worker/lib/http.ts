import type { Context } from "hono";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Record") => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new ApiError(403, "forbidden", msg);

export function errorResponse(err: unknown, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "Some fields are invalid",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/i.test(msg)) {
    return c.json({ error: { code: "conflict", message: "A record with the same unique value already exists" } }, 409);
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return c.json({ error: { code: "invalid_reference", message: "A linked record does not exist" } }, 400);
  }
  console.error("Unhandled error", err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, 500);
}

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
  return schema.parse(body);
}
