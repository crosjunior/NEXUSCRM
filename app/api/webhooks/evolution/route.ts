import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { EvolutionClient } from "@/lib/channels/evolution/client";
import {
  DEFAULT_EVOLUTION_INSTANCE_NAME,
  loadOrgWhatsappConnections,
  saveOrgWhatsappConnections,
  triggerFailoverIfEnabled,
} from "@/lib/channels/evolution/config";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return ok({ status: "ready", endpoint: "/api/webhooks/evolution" });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("validation_failed", "Invalid JSON payload", 400, { requestId });
  }

  const event = typeof payload.event === "string" ? payload.event.toUpperCase() : "UNKNOWN";
  const instance =
    typeof payload.instance === "string" && payload.instance.trim()
      ? payload.instance.trim()
      : DEFAULT_EVOLUTION_INSTANCE_NAME;

  logger.info("[webhook.evolution] evento recebido", {
    requestId,
    event,
    instance,
  });

  if (event === "CONNECTION_UPDATE") {
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const state = typeof data.state === "string" ? data.state.toLowerCase() : "";

    const admin = createAdminClient();
    const { data: orgs } = await admin.from("organizations").select("id, settings");

    for (const org of orgs ?? []) {
      const { settings, connections } = await loadOrgWhatsappConnections(admin, org.id);
      if (connections.evolution.instance_name !== instance) continue;

      const nextStatus =
        state === "open"
          ? ("connected" as const)
          : state === "connecting"
            ? ("connecting" as const)
            : ("disconnected" as const);

      const client = new EvolutionClient(
        connections.evolution.server_url,
        connections.evolution.api_key || process.env.EVOLUTION_API_KEY,
      );

      // Se a conexão abriu, garante configurações de estabilidade ativas (Always Online)
      if (nextStatus === "connected") {
        void client.applyStabilitySettings(instance).catch(() => {});
      }

      await saveOrgWhatsappConnections(admin, org.id, settings, {
        ...connections,
        evolution: {
          ...connections.evolution,
          status: nextStatus,
          last_checked_at: new Date().toISOString(),
        },
      });

      // Auto-reconexão inteligente se a conexão caiu transitoriamente
      const reasonCode = Number(data.statusCode ?? data.disconnectionReasonCode ?? 0);
      const isExplicitRevocation = reasonCode === 401;

      if (nextStatus === "disconnected" && !isExplicitRevocation) {
        logger.info("[webhook.evolution] Tentando auto-reconexão de sessão Baileys...", {
          instance,
          reasonCode,
        });

        void (async () => {
          try {
            const reconnected = await client.tryAutoReconnect(instance);
            if (reconnected.state === "open") {
              logger.info("[webhook.evolution] Auto-reconexão bem-sucedida sem ler QR Code!", {
                instance,
              });
              const recovered = {
                ...connections,
                evolution: {
                  ...connections.evolution,
                  status: "connected" as const,
                  last_checked_at: new Date().toISOString(),
                  last_error: null,
                },
              };
              await saveOrgWhatsappConnections(admin, org.id, settings, recovered);
              void client.applyStabilitySettings(instance).catch(() => {});
              return;
            }
          } catch (healErr) {
            logger.warn("[webhook.evolution] Falha na auto-reconexão", {
              instance,
              error: String(healErr),
            });
          }

          // Se auto-reconexão não surtiu efeito e failover estiver ativo, chaveia
          if (connections.active_connection === "evolution") {
            await triggerFailoverIfEnabled(
              admin,
              org.id,
              "evolution",
              `Webhook CONNECTION_UPDATE (${state || "close"}, code ${reasonCode})`,
            );
          }
        })();
      } else if (nextStatus === "disconnected" && connections.active_connection === "evolution") {
        await triggerFailoverIfEnabled(
          admin,
          org.id,
          "evolution",
          `Webhook CONNECTION_UPDATE (${state || "close"})`,
        );
      }
    }
  }

  return ok({ received: true, event, instance }, { requestId });
}

