import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { resolveInstagramCreds } from "./credentials";
import {
  replyToInstagramComment,
  sendInstagramMessage,
  getInstagramUserProfile,
} from "./api";
import { findMatchingRule } from "./matching";
import type { NormalizedInstagramEvent, InstagramKeywordRule } from "./types";
import { ingestZernioInbound } from "../zernio/ingest";
import type { SocialMessage } from "../social/parser";
import { socialMessageId } from "../social/catalog";

interface ChannelSessionMetadata {
  platform?: string;
  direct_meta?: boolean;
  username?: string;
  name?: string;
  agent_id?: string | null;
  keyword_rules?: InstagramKeywordRule[];
  [key: string]: unknown;
}

export async function processInstagramWebhookEvent(
  db: SupabaseClient,
  event: NormalizedInstagramEvent,
): Promise<{ status: "processed" | "ignored" | "error"; reason?: string }> {
  if (event.kind === "ignored") return { status: "ignored", reason: "evento_ignorado" };

  // Busca a sessão do canal correspondente à conta do Instagram
  const { data: session, error } = await db
    .from("channel_sessions")
    .select("id, organization_id, meta_token_encrypted, metadata, status")
    .eq("zernio_account_id", event.igUserId)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !session) {
    logger.info("[instagram.webhook] Nenhuma sessão ativa encontrada para conta", {
      igUserId: event.igUserId,
    });
    return { status: "ignored", reason: "conta_nao_encontrada" };
  }

  const orgId = session.organization_id;
  const metadata = (session.metadata ?? {}) as ChannelSessionMetadata;
  const keywordRules: InstagramKeywordRule[] = Array.isArray(metadata.keyword_rules)
    ? metadata.keyword_rules
    : [];

  // Decifra o token de acesso da Meta
  let token: string | null = null;
  if (session.meta_token_encrypted) {
    token = await decryptWebhookSecret(db, session.meta_token_encrypted as string);
  }

  if (!token) {
    logger.warn("[instagram.webhook] Sessão sem token decifrável", { sessionId: session.id });
    return { status: "error", reason: "token_indisponivel" };
  }

  const creds = await resolveInstagramCreds(db, orgId);

  // -------------------------------------------------------------------------
  // 1. Trata Comentários (com regra de palavra-chave ou ManyChat style)
  // -------------------------------------------------------------------------
  if (event.kind === "comment") {
    // Verifica se há regra para comentários
    const matchedRule = findMatchingRule(keywordRules, "comment_keyword", event.text);
    if (!matchedRule) {
      return { status: "ignored", reason: "sem_regra_para_comentario" };
    }

    try {
      // 1.1 Resposta pública no post/Reel (se configurada)
      if (matchedRule.public_reply?.trim()) {
        await replyToInstagramComment(
          creds,
          token,
          event.commentId,
          matchedRule.public_reply.trim(),
        );
      }

      // 1.2 Resposta privada no Direct (DM) usando o comment_id como destinatário
      if (matchedRule.dm_message?.trim()) {
        // Substitui {username} pelo nome do usuário se existir
        const textToSend = matchedRule.dm_message.replace(
          /\{username\}/gi,
          event.fromUsername ? `@${event.fromUsername}` : "",
        );

        await sendInstagramMessage(
          creds,
          token,
          { comment_id: event.commentId },
          textToSend,
          { igUserId: event.igUserId },
        );
      }

      return { status: "processed" };
    } catch (err) {
      logger.error("[instagram.webhook] Falha ao responder comentário", {
        commentId: event.commentId,
        erro: err instanceof Error ? err.message : String(err),
      });
      return { status: "error", reason: "falha_ao_responder_comentario" };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Trata Mensagens Diretas (DMs) e Respostas de Stories
  // -------------------------------------------------------------------------
  if (event.kind === "message") {
    if (event.isEcho) {
      return { status: "ignored", reason: "mensagem_echo_da_propria_conta" };
    }

    const text = event.text ?? "";

    // 2.1 Verifica regra de palavra-chave para story_mention ou dm_keyword
    const ruleType = event.storyMention ? "story_mention" : "dm_keyword";
    const matchedRule = findMatchingRule(keywordRules, ruleType, text);

    if (matchedRule && matchedRule.dm_message?.trim()) {
      try {
        await sendInstagramMessage(
          creds,
          token,
          { id: event.senderId },
          matchedRule.dm_message.trim(),
          { igUserId: event.igUserId },
        );
      } catch (err) {
        logger.error("[instagram.webhook] Falha ao enviar DM de automação", {
          senderId: event.senderId,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
      // Continua para registrar na caixa de entrada do CRM
    }

    // 2.2 Ingestão na conversa do CRM
    const profile = await getInstagramUserProfile(creds, token, event.senderId);

    const socialMsg: SocialMessage = {
      platform: "instagram",
      participantId: event.senderId,
      accountId: event.igUserId,
      conversationId: `ig_${event.senderId}_${event.igUserId}`,
      externalId: socialMessageId(event.igUserId, event.mid),
      direction: "inbound",
      kind: "message",
      text: event.text ?? null,
      sentAt: new Date().toISOString(),
      attachments: event.attachments
        .filter((a): a is { type: string; url: string } => Boolean(a.url))
        .map((a) => ({ type: a.type, url: a.url })),
      referral: null,
      identity: {
        phone: null,
        bsuid: null,
        anchor: null,
        username: profile?.username ?? null,
        displayName: profile?.name ?? profile?.username ?? `Instagram ${event.senderId.slice(-4)}`,
      },
    };

    const ingestResult = await ingestZernioInbound(db, {
      organizationId: orgId,
      channelSessionId: session.id,
      payload: event,
      socialMessage: socialMsg,
    });

    // Se a sessão tem um agente configurado explicitamente, garante que a conversa
    // fique vinculada a ele para responder automaticamente
    if (metadata.agent_id && ingestResult.conversationId) {
      await db
        .from("conversations")
        .update({
          active_ai_agent_id: metadata.agent_id,
          channel: "instagram",
        })
        .eq("organization_id", orgId)
        .eq("id", ingestResult.conversationId)
        .is("active_ai_agent_id", null);
    }

    return { status: "processed" };
  }

  return { status: "ignored", reason: "tipo_evento_nao_suportado" };
}
