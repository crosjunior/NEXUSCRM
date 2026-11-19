import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { testOnlineLinkAccess } from "@/lib/ai/rag/extractors/online-links";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().trim().min(5),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Informe uma URL válida.", 422, { requestId });
  }

  const resultado = await testOnlineLinkAccess(parsed.data.url);
  return ok(resultado, { requestId });
}
