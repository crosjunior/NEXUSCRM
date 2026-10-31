/**
 * Rota de Aplicação (1-Clique) do Blueprint do NexusCRMAgent.
 *
 * POST /api/v1/onboarding/autonomous/apply
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { aplicarBlueprintAutonomo } from "@/lib/onboarding/autonomous-apply";
import type { AutonomousExtractionOutput } from "@/lib/onboarding/autonomous-types";

const applySchema = z.object({
  brand_identity: z
    .object({
      name: z.string().min(1),
      slug: z.string().min(1),
      primary_color: z.string(),
      secondary_color: z.string(),
      accent_color: z.string(),
      colors: z.array(z.string()).optional(),
      font_primary: z.string().optional(),
      font_secondary: z.string().optional(),
      logo_url: z.string().nullable().optional(),
      typography_style: z.string(),
      icon_archetype: z.string(),
      tone_of_voice: z.string(),
    })
    .passthrough(),
  niche: z.string(),
  catalog: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      description: z.string(),
      price_cents: z.number(),
      currency: z.string(),
      payment_methods: z.array(z.string()),
      delivery_time: z.string(),
    }),
  ),
  business_rules: z.object({
    operating_hours: z.string(),
    coverage_or_address: z.string(),
    warranty_and_refund: z.string(),
    max_discount_percentage: z.number(),
  }),
  sales_funnel: z.object({
    niche: z.string(),
    stages: z.array(
      z.object({
        name: z.string(),
        slug: z.string(),
        description: z.string(),
        color: z.string(),
        is_won: z.boolean().optional(),
        is_lost: z.boolean().optional(),
      }),
    ),
  }),
  objections_and_faqs: z.object({
    faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
    objections: z.array(z.object({ objection: z.string(), rebuttal: z.string() })),
  }),
  follow_ups: z.object({
    sequences: z.array(
      z.object({
        delay_minutes: z.number(),
        label: z.string(),
        message_template: z.string(),
      }),
    ),
  }),
  human_handoff: z.object({
    trigger_keywords: z.array(z.string()),
    conditions: z.array(z.string()),
  }),
  master_knowledge_markdown: z.string(),
  persistent_documents: z.array(
    z.object({
      name: z.string(),
      original_name: z.string(),
      description: z.string(),
      category: z.string(),
      version: z.number(),
      uploaded_at: z.string(),
      source_url: z.string().optional(),
      file_size: z.number().optional(),
      mime_type: z.string().optional(),
    }),
  ),
  gaps_found: z.array(z.any()).optional().default([]),
  completeness_score: z.number().optional().default(100),
}).passthrough();

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // Autorização canônica: apenas admin da organização
  const authz = await requireRole("admin", { requestId, resource: "onboarding.autonomous.apply" });
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_json", "Corpo da requisição deve ser um JSON válido.", 400, { requestId });
  }

  const rawData =
    body && typeof body === "object" && "blueprint" in body
      ? (body as { blueprint: unknown }).blueprint
      : body;

  const parsed = applySchema.safeParse(rawData);
  if (!parsed.success) {
    return fail("validation_error", "Blueprint inválido para aplicação.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const resultado = await aplicarBlueprintAutonomo(
    parsed.data as AutonomousExtractionOutput,
    authz.org.orgId,
    authz.user.id,
  );

  if (!resultado.ok) {
    return fail("apply_failed", resultado.error || "Falha ao aplicar configurações.", 500, {
      requestId,
    });
  }

  return ok(resultado, { requestId });
}
