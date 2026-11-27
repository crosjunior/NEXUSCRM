import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import {
  MODULOS_TENANT,
  MODULOS_TENANT_CATALOGO,
  MODULOS_TENANT_TODOS,
  RECURSOS_TENANT_CATALOGO,
  RECURSOS_TENANT_TODOS,
  modulosHabilitadosDaOrganizacao,
  recursosHabilitadosDaOrganizacao,
  type ModuloTenant,
} from "@/lib/tenants/modulos-contratados";

const schemaUpdateModulos = z.object({
  modulos_habilitados: z.array(z.enum(MODULOS_TENANT)),
  recursos_habilitados: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants/[id]/modules
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, slug, display_name, settings")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  const modulosHabilitados = modulosHabilitadosDaOrganizacao(org.settings);
  const recursosHabilitados = recursosHabilitadosDaOrganizacao(org.settings, modulosHabilitados);

  return ok(
    {
      organization_id: id,
      modulos_habilitados: modulosHabilitados,
      recursos_habilitados: recursosHabilitados,
      catalogo: Object.values(MODULOS_TENANT_CATALOGO),
      catalogo_recursos: Object.values(RECURSOS_TENANT_CATALOGO),
      todos_modulos: MODULOS_TENANT_TODOS,
      todos_recursos: RECURSOS_TENANT_TODOS,
    },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/tenants/[id]/modules
// ---------------------------------------------------------------------------
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

  const parsed = schemaUpdateModulos.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug, settings")
    .eq("id", id)
    .maybeSingle();

  if (orgError) return fail("internal_error", orgError.message, 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });

  const currentSettings =
    org.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>)
      : {};

  const updatedSettings = {
    ...currentSettings,
    modulos_habilitados: parsed.data.modulos_habilitados,
    ...(parsed.data.recursos_habilitados !== undefined
      ? { recursos_habilitados: parsed.data.recursos_habilitados }
      : {}),
  };

  const { error: updateError } = await admin
    .from("organizations")
    .update({ settings: updatedSettings })
    .eq("id", id);

  if (updateError) {
    return fail("internal_error", updateError.message, 500, { requestId });
  }

  void audit({
    action: "org.updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: {
      tenant_slug: org.slug,
      via: "platform_admin",
      fields_changed: ["modulos_habilitados", "recursos_habilitados"],
      modulos_habilitados: parsed.data.modulos_habilitados,
      recursos_habilitados: parsed.data.recursos_habilitados,
    },
  });

  void admin
    .rpc("emit_event", {
      p_event_type: "org.modules_updated",
      p_entity_kind: "organization",
      p_entity_id: id,
      p_payload: {
        organization_id: id,
        modulos_habilitados: parsed.data.modulos_habilitados,
        recursos_habilitados: parsed.data.recursos_habilitados,
      },
      p_metadata: { request_id: requestId, via: "platform_admin" },
      p_organization_id: id,
    })
    .then(({ error }) => {
      if (error) {
        logger.warn("[admin.tenants.modules.patch] emit_event falhou", {
          requestId,
          erro: error.message,
        });
      }
    });

  return ok(
    {
      id,
      modulos_habilitados: parsed.data.modulos_habilitados,
      recursos_habilitados: parsed.data.recursos_habilitados,
    },
    { requestId },
  );
}
