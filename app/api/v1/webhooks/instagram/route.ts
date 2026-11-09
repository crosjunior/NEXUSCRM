import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveInstagramCreds } from "@/lib/channels/instagram/credentials";
import { verifyMetaSignature, normalizeInstagramWebhook } from "@/lib/channels/instagram/webhook";
import { processInstagramWebhookEvent } from "@/lib/channels/instagram/service";

export const dynamic = "force-dynamic";

/** Verificação do webhook da Meta (Meta App Dashboard -> Webhooks -> Verify and Save) */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");

  const db = createAdminClient();
  const creds = await resolveInstagramCreds(db);

  if (mode === "subscribe" && token === creds.verifyToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  logger.warn("[instagram.webhook] Falha na verificação de token", { tokenRecebido: token });
  return new NextResponse("Forbidden", { status: 403 });
}

/** Recebimento de eventos (DMs, comentários, menções nos stories) */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const db = createAdminClient();
  const creds = await resolveInstagramCreds(db);

  if (!verifyMetaSignature(rawBody, signature, creds.appSecret)) {
    logger.warn("[instagram.webhook] Assinatura inválida da Meta");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const events = normalizeInstagramWebhook(body as Parameters<typeof normalizeInstagramWebhook>[0]);
  if (!events.length) {
    return NextResponse.json({ ok: true });
  }

  // Processa cada evento de forma assíncrona
  for (const ev of events) {
    try {
      await processInstagramWebhookEvent(db, ev);
    } catch (err) {
      logger.error("[instagram.webhook] Erro ao processar evento", {
        kind: ev.kind,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
