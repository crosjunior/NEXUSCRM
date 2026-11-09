import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInstagramEvent } from "./types";

/** Valida a assinatura x-hub-signature-256 enviada pela Meta */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;
  const hash = parts[1];
  if (!hash) return false;

  try {
    const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    if (expected.length !== hash.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

interface MetaWebhookEntry {
  id?: string;
  messaging?: Array<{
    sender?: { id: string };
    recipient?: { id: string };
    message?: {
      mid: string;
      text?: string;
      is_echo?: boolean;
      reply_to?: { story?: { id: string; url?: string } };
      attachments?: Array<{ type: string; payload?: { url?: string } }>;
    };
    postback?: {
      mid?: string;
      title?: string;
      payload?: string;
    };
  }>;
  changes?: Array<{
    field?: string;
    value?: {
      id?: string;
      text?: string;
      from?: { id: string; username?: string };
      media?: { id: string; media_product_type?: string };
    };
  }>;
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

/** Converte o payload bruto de webhook da Meta em eventos normalizados */
export function normalizeInstagramWebhook(body: MetaWebhookPayload): NormalizedInstagramEvent[] {
  if (!body?.entry || !Array.isArray(body.entry)) return [];
  const events: NormalizedInstagramEvent[] = [];

  for (const entry of body.entry) {
    const igUserId = String(entry.id ?? "");

    // 1. Mensagens e postbacks
    if (entry.messaging && Array.isArray(entry.messaging)) {
      for (const m of entry.messaging) {
        const senderId = m.sender?.id ? String(m.sender.id) : "";
        const recipientId = m.recipient?.id ? String(m.recipient.id) : "";

        if (m.postback) {
          events.push({
            kind: "postback",
            mid: m.postback.mid ?? `pb_${Date.now()}_${senderId}`,
            senderId,
            recipientId,
            title: m.postback.title ?? "",
            payload: m.postback.payload ?? "",
            igUserId,
          });
          continue;
        }

        if (m.message) {
          const attachments = (m.message.attachments ?? []).map((att) => ({
            type: att.type,
            url: att.payload?.url,
          }));

          const storyReply = Boolean(m.message.reply_to?.story);
          const isStoryMention = attachments.some((att) => att.type === "story_mention");

          events.push({
            kind: "message",
            mid: m.message.mid,
            senderId,
            recipientId,
            text: m.message.text,
            isEcho: Boolean(m.message.is_echo),
            storyReply,
            storyMention: isStoryMention,
            attachments,
            igUserId,
          });
        }
      }
    }

    // 2. Comentários em posts e Reels
    if (entry.changes && Array.isArray(entry.changes)) {
      for (const ch of entry.changes) {
        if (ch.field === "comments" && ch.value) {
          const val = ch.value;
          if (val.id && val.from?.id) {
            events.push({
              kind: "comment",
              commentId: String(val.id),
              mediaId: String(val.media?.id ?? ""),
              mediaProductType: val.media?.media_product_type,
              fromId: String(val.from.id),
              fromUsername: val.from.username,
              text: val.text ?? "",
              igUserId,
            });
          }
        }
      }
    }
  }

  return events;
}
