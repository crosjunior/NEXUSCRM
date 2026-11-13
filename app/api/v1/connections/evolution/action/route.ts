import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { requireRole } from "@/lib/auth/require-role";
import { EvolutionApiError, EvolutionClient } from "@/lib/channels/evolution/client";
import {
  EVOLUTION_WEBHOOK_PATH,
  generateCompanyInstanceName,
  hasConnectedAlternativeQrSession,
  loadOrgWhatsappConnections,
  saveOrgWhatsappConnections,
  syncEvolutionVirtualChannelSession,
  triggerFailoverIfEnabled,
} from "@/lib/channels/evolution/config";
import { MSG_DESCONECTAR_ALTERNATIVO_ANTES } from "@/lib/channels/evolution/ui-labels";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum([
    "connect",
    "disconnect",
    "qr",
    "pairing_code",
    "sync_webhook",
    "check_status",
    "use_company_instance",
    "send_test_message",
    "auto_reconnect",
    "apply_stability",
  ]),
  phone_number: z.string().trim().optional(),
  instance_name: z.string().trim().min(1).max(80).optional(),
  message_text: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido.", 400, { requestId });
  }

  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Ação inválida.", 400, { requestId });
  }

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const [{ displayName, settings, connections }, altQrConnected] = await Promise.all([
    loadOrgWhatsappConnections(admin, orgId),
    hasConnectedAlternativeQrSession(admin, orgId),
  ]);

  const { action, phone_number, instance_name } = parsed.data;
  const targetInstance = instance_name ?? connections.evolution.instance_name;
  const client = new EvolutionClient(connections.evolution.server_url, connections.evolution.api_key);
  const origin = process.env.APP_URL?.replace(/\/+$/, "") || req.nextUrl.origin;
  const fullWebhookUrl = `${origin}${EVOLUTION_WEBHOOK_PATH}`;

  if (
    (action === "connect" || action === "qr" || action === "pairing_code") &&
    altQrConnected
  ) {
    return fail(
      "state_conflict",
      MSG_DESCONECTAR_ALTERNATIVO_ANTES,
      409,
      { requestId },
    );
  }

  if (action === "use_company_instance") {
    const companyInstance = generateCompanyInstanceName(displayName);
    const next = {
      ...connections,
      evolution: {
        ...connections.evolution,
        instance_name: companyInstance,
      },
    };
    await saveOrgWhatsappConnections(admin, orgId, settings, next);
    return ok({ instance_name: companyInstance }, { requestId });
  }

  try {
    if (action === "qr") {
      let qr;
      try {
        qr = await client.getQrCode(targetInstance);
      } catch (err) {
        if (err instanceof EvolutionApiError && err.status === 404) {
          await client.createInstance({
            instanceName: targetInstance,
            number: phone_number ?? connections.evolution.phone_number,
            webhookUrl: fullWebhookUrl,
          });
          qr = await client.getQrCode(targetInstance);
        } else {
          throw err;
        }
      }

      const next = {
        ...connections,
        qr_engine: "evolution" as const,
        evolution: {
          ...connections.evolution,
          instance_name: targetInstance,
          status: qr.base64 ? ("connecting" as const) : connections.evolution.status,
          last_error: null,
        },
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, next);
      try {
        await syncEvolutionVirtualChannelSession(admin, orgId, next);
      } catch {
        // silencioso
      }

      return ok(
        {
          instance_name: targetInstance,
          base64: qr.base64,
          code: qr.code,
          pairingCode: qr.pairingCode,
        },
        { requestId },
      );
    }

    if (action === "pairing_code") {
      const targetPhone = phone_number ?? connections.evolution.phone_number;
      const result = await client.getPairingCode(targetInstance, targetPhone);
      return ok(
        {
          instance_name: targetInstance,
          phone_number: targetPhone,
          pairingCode: result.pairingCode,
        },
        { requestId },
      );
    }

    if (action === "sync_webhook") {
      await client.setWebhook(targetInstance, fullWebhookUrl);
      const next = {
        ...connections,
        evolution: {
          ...connections.evolution,
          webhook_url: EVOLUTION_WEBHOOK_PATH,
          webhook_synced: true,
          last_error: null,
        },
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, next);
      try {
        await syncEvolutionVirtualChannelSession(admin, orgId, next);
      } catch {
        // silencioso
      }
      return ok({ webhook_url: fullWebhookUrl, webhook_synced: true }, { requestId });
    }

    if (action === "check_status") {
      const stateRes = await client.fetchConnectionState(targetInstance);
      const mappedStatus =
        stateRes.state === "open"
          ? ("connected" as const)
          : stateRes.state === "connecting"
            ? ("connecting" as const)
            : ("disconnected" as const);

      const next = {
        ...connections,
        evolution: {
          ...connections.evolution,
          status: mappedStatus,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        },
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, next);
      try {
        await syncEvolutionVirtualChannelSession(admin, orgId, next);
      } catch {
        // silencioso
      }

      let failoverTo: string | null = null;
      if (mappedStatus === "disconnected" && connections.active_connection === "evolution") {
        failoverTo = await triggerFailoverIfEnabled(
          admin,
          orgId,
          "evolution",
          "Instância Evolution API desconectada durante verificação de saúde.",
        );
      }

      if (mappedStatus === "connected") {
        void client.applyStabilitySettings(targetInstance).catch(() => {});
      }

      return ok({ status: mappedStatus, state: stateRes.state, failover_to: failoverTo }, { requestId });
    }

    if (action === "auto_reconnect") {
      const stateRes = await client.tryAutoReconnect(targetInstance);
      const isConnected = stateRes.state === "open";
      const mappedStatus = isConnected
        ? ("connected" as const)
        : stateRes.state === "connecting"
          ? ("connecting" as const)
          : ("disconnected" as const);

      const next = {
        ...connections,
        evolution: {
          ...connections.evolution,
          status: mappedStatus,
          last_checked_at: new Date().toISOString(),
          last_error: isConnected ? null : connections.evolution.last_error,
        },
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, next);
      try {
        await syncEvolutionVirtualChannelSession(admin, orgId, next);
      } catch {
        // silencioso
      }

      if (isConnected) {
        void client.applyStabilitySettings(targetInstance).catch(() => {});
      }

      return ok(
        {
          success: isConnected,
          reconnected: isConnected,
          status: mappedStatus,
          state: stateRes.state,
          message: isConnected
            ? "Conexão restaurada com sucesso sem necessidade de ler QR Code!"
            : "A sessão Baileys não pôde ser restaurada automaticamente. Abra o QR Code para parear novamente.",
        },
        { requestId },
      );
    }

    if (action === "apply_stability") {
      await client.applyStabilitySettings(targetInstance);
      return ok(
        {
          success: true,
          message: "Modo Always Online e estabilidade de keep-alive ativados com sucesso na instância!",
        },
        { requestId },
      );
    }

    if (action === "send_test_message") {
      const targetPhone = phone_number ?? connections.evolution.phone_number;
      if (!targetPhone) {
        return fail("validation_failed", "Informe o número de destino para o teste.", 400, {
          requestId,
        });
      }

      // 1. Verifica estado real da conexão antes de tentar enviar
      const stateRes = await client.fetchConnectionState(targetInstance).catch(() => null);
      if (stateRes && stateRes.state !== "open") {
        const next = {
          ...connections,
          evolution: {
            ...connections.evolution,
            status: "disconnected" as const,
            last_checked_at: new Date().toISOString(),
            last_error: "Aparelho desconectado (Connection Closed).",
          },
        };
        await saveOrgWhatsappConnections(admin, orgId, settings, next);
        try {
          await syncEvolutionVirtualChannelSession(admin, orgId, next);
        } catch {
          // silencioso
        }
        return fail(
          "service_unavailable",
          `A instância "${targetInstance}" está desconectada do WhatsApp (${stateRes.state}). Por favor, reconecte utilizando o QR Code ou Código de Pareamento antes de enviar mensagens.`,
          400,
          { requestId },
        );
      }

      const text =
        parsed.data.message_text?.trim() ||
        `*NexusCRM - Teste de Conexão*\n\nMensagem de teste enviada com sucesso através da instância *${targetInstance}* (Evolution API).\nData/Hora: ${new Date().toLocaleString("pt-BR")}`;

      const res = await client.sendText(targetInstance, targetPhone, text);

      void audit({
        action: "channel.schedule_updated" as AuditAction,
        actorUserId: authz.user.id,
        organizationId: orgId,
        resourceType: "organization",
        resourceId: orgId,
        requestId,
        metadata: {
          instance_name: targetInstance,
          to_phone: targetPhone,
        },
      });

      return ok(
        {
          success: true,
          to_phone: targetPhone,
          instance_name: targetInstance,
          result: res,
        },
        { requestId },
      );
    }

    if (action === "disconnect") {
      try {
        await client.logout(targetInstance);
      } catch {
        // Se a instância já estiver offline no servidor remoto, ainda marcamos como desconectada localmente.
      }
      const next = {
        ...connections,
        evolution: {
          ...connections.evolution,
          status: "disconnected" as const,
          last_checked_at: new Date().toISOString(),
        },
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, next);
      try {
        await syncEvolutionVirtualChannelSession(admin, orgId, next);
      } catch {
        // silencioso
      }
      void audit({
        action: "channel.disabled" as AuditAction,
        actorUserId: authz.user.id,
        organizationId: orgId,
        resourceType: "organization",
        resourceId: orgId,
        requestId,
        metadata: { instance_name: targetInstance },
      });
      return ok({ status: "disconnected" }, { requestId });
    }

    // action === "connect"
    await client.createInstance({
      instanceName: targetInstance,
      number: phone_number ?? connections.evolution.phone_number,
      webhookUrl: fullWebhookUrl,
    });
    const next = {
      ...connections,
      qr_engine: "evolution" as const,
      active_connection: "evolution" as const,
      evolution: {
        ...connections.evolution,
        instance_name: targetInstance,
        status: "connecting" as const,
        webhook_synced: true,
        webhook_url: EVOLUTION_WEBHOOK_PATH,
        last_error: null,
      },
    };
    await saveOrgWhatsappConnections(admin, orgId, settings, next);
    return ok({ instance_name: targetInstance, status: "connecting" }, { requestId });
  } catch (err) {
    const message =
      err instanceof EvolutionApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Erro ao comunicar com a Evolution API.";

    const next = {
      ...connections,
      evolution: {
        ...connections.evolution,
        last_error: message,
        last_checked_at: new Date().toISOString(),
      },
    };
    await saveOrgWhatsappConnections(admin, orgId, settings, next);

    return fail("upstream_error", message, 502, { requestId });
  }
}
