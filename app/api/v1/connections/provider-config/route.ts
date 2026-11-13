import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { requireRole } from "@/lib/auth/require-role";
import {
  buildEvolutionManagerUrl,
  generateCompanyInstanceName,
  hasConnectedAlternativeQrSession,
  hasConnectedOfficialSession,
  loadOrgWhatsappConnections,
  saveOrgWhatsappConnections,
  syncEvolutionVirtualChannelSession,
} from "@/lib/channels/evolution/config";
import {
  ACTIVE_CONNECTIONS,
  ENGINE_ALTERNATIVO,
  ENGINE_EVOLUTION,
  MSG_DESCONECTAR_ALTERNATIVO_ANTES,
  MSG_DESCONECTAR_EVOLUTION_ANTES,
  QR_ENGINES,
} from "@/lib/channels/evolution/ui-labels";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  qr_engine: z.enum(QR_ENGINES).optional(),
  active_connection: z.enum(ACTIVE_CONNECTIONS).optional(),
  auto_failover: z.boolean().optional(),
  evolution: z
    .object({
      instance_name: z.string().trim().min(1).max(80).optional(),
      server_url: z.string().trim().url().optional(),
      api_key: z.string().trim().nullable().optional(),
      phone_number: z.string().trim().min(6).max(32).optional(),
    })
    .optional(),
});

function sanitizeForClient(
  connections: Awaited<ReturnType<typeof loadOrgWhatsappConnections>>["connections"],
) {
  return {
    ...connections,
    evolution: {
      ...connections.evolution,
      api_key: undefined,
      has_api_key: Boolean(connections.evolution.api_key || process.env.EVOLUTION_API_KEY),
      manager_url: buildEvolutionManagerUrl(
        connections.evolution.server_url,
        connections.evolution.instance_id,
      ),
    },
  };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const [{ displayName, connections }, altQrConnected, metaConnected] = await Promise.all([
    loadOrgWhatsappConnections(admin, orgId),
    hasConnectedAlternativeQrSession(admin, orgId),
    hasConnectedOfficialSession(admin, orgId),
  ]);

  // Mantém sessão virtual em sincronia com o estado das conexões
  try {
    await syncEvolutionVirtualChannelSession(admin, orgId, connections);
  } catch {
    // silencia para não quebrar retorno de tela
  }

  return ok(
    {
      connections: sanitizeForClient(connections),
      company_name: displayName,
      suggested_instance_name: generateCompanyInstanceName(displayName),
      alt_qr_connected: altQrConnected,
      meta_connected: metaConnected,
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido.", 400, { requestId });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const [{ settings, connections }, altQrConnected] = await Promise.all([
    loadOrgWhatsappConnections(admin, orgId),
    hasConnectedAlternativeQrSession(admin, orgId),
  ]);

  const input = parsed.data;

  // Regra de exclusividade mútua entre motores QR
  if (input.qr_engine === ENGINE_ALTERNATIVO && connections.evolution.status === "connected") {
    return fail(
      "state_conflict",
      MSG_DESCONECTAR_EVOLUTION_ANTES,
      409,
      { requestId },
    );
  }
  if (input.qr_engine === ENGINE_EVOLUTION && altQrConnected) {
    return fail(
      "state_conflict",
      MSG_DESCONECTAR_ALTERNATIVO_ANTES,
      409,
      { requestId },
    );
  }

  const next = {
    ...connections,
    ...(input.qr_engine ? { qr_engine: input.qr_engine } : {}),
    ...(input.active_connection ? { active_connection: input.active_connection } : {}),
    ...(typeof input.auto_failover === "boolean" ? { auto_failover: input.auto_failover } : {}),
    evolution: {
      ...connections.evolution,
      ...(input.evolution?.instance_name ? { instance_name: input.evolution.instance_name } : {}),
      ...(input.evolution?.server_url ? { server_url: input.evolution.server_url } : {}),
      ...(input.evolution?.api_key !== undefined ? { api_key: input.evolution.api_key } : {}),
      ...(input.evolution?.phone_number ? { phone_number: input.evolution.phone_number } : {}),
    },
  };

  await saveOrgWhatsappConnections(admin, orgId, settings, next);

  try {
    await syncEvolutionVirtualChannelSession(admin, orgId, next);
  } catch {
    // silencia para não quebrar retorno de tela
  }

  void audit({
    action: "channel.schedule_updated" as AuditAction,
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: {
      qr_engine: next.qr_engine,
      active_connection: next.active_connection,
      auto_failover: next.auto_failover,
    },
  });

  return ok({ connections: sanitizeForClient(next) }, { requestId });
}
