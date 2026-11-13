import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { empresaExigeMfa, politicaDaEmpresa } from "@/lib/auth/politica-mfa";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  enabled: z.boolean(),
});

/**
 * PATCH /api/v1/admin/tenants/[id]/mfa
 * Ativa ou desativa a exigência de MFA para os administradores da empresa cadastrada.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_failed", "Invalid JSON body", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("id", id)
    .maybeSingle();

  if (orgError) return fail("internal_error", orgError.message, 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const security = (settings.security ?? {}) as Record<string, unknown>;
  const cfg = politicaDaEmpresa(settings);
  const papelAtual = cfg.papelMinimo ?? (empresaExigeMfa(settings) ? "admin" : "none");
  const papelNovo = parsed.data.enabled ? "admin" : "none";

  if (papelAtual === papelNovo) {
    return ok({ mfa_required: parsed.data.enabled }, { requestId });
  }

  const novo = {
    ...settings,
    security: {
      ...security,
      mfa_required: parsed.data.enabled,
      mfa_required_min_role: papelNovo,
      mfa_grace_days: cfg.diasDeCarencia,
      mfa_policy_changed_at: new Date().toISOString(),
    },
  };

  const { error: updateErr } = await admin
    .from("organizations")
    .update({ settings: novo })
    .eq("id", id);

  if (updateErr) {
    return fail("internal_error", updateErr.message, 500, { requestId });
  }

  await audit({
    action: parsed.data.enabled ? "security.mfa_exigida" : "security.mfa_dispensada",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: {
      papel_minimo_anterior: papelAtual,
      papel_minimo_novo: papelNovo,
      via: "platform_admin",
    },
  });

  revalidatePath("/app", "layout");
  return ok({ mfa_required: parsed.data.enabled }, { requestId });
}

