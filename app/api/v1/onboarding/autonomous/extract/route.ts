/**
 * Rota de Extração Multimodal do Assistente de Onboarding do NexusCRMAgent.
 *
 * POST /api/v1/onboarding/autonomous/extract
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { extrairConfiguracaoAutonoma } from "@/lib/onboarding/autonomous-extractor";
import type { AutonomousExtractionInput } from "@/lib/onboarding/autonomous-types";

const extractSchema = z.object({
  website_url: z.string().trim().optional(),
  instagram: z.string().trim().optional(),
  google_maps_url: z.string().trim().optional(),
  drive_links: z.array(z.string().trim()).optional(),
  freeform_notes: z.string().trim().optional(),
  files: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        size: z.number().optional(),
        base64_data: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // Autorização canônica: apenas admin da organização
  const authz = await requireRole("admin", { requestId, resource: "onboarding.autonomous" });
  if (!authz.ok) return authz.response;

  const supportBlock = await requireSupportWrite(authz.org.orgId);
  if (supportBlock) return supportBlock;

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return fail(
      "invalid_json",
      err instanceof Error ? `Corpo da requisição inválido: ${err.message}` : "Corpo da requisição deve ser um JSON válido.",
      400,
      { requestId },
    );
  }

  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Parâmetros inválidos para extração.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  try {
    const output = await extrairConfiguracaoAutonoma(parsed.data as AutonomousExtractionInput, authz.org.orgId);
    return ok(output, { requestId });
  } catch (err) {
    return fail(
      "extraction_failed",
      err instanceof Error ? err.message : "Falha na extração de dados.",
      500,
      { requestId },
    );
  }
}
