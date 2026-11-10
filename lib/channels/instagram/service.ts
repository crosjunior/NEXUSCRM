import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { resolveInstagramCreds, type ResolvedInstagramCreds } from "./credentials";
import {
  buildGraphMessagePayload,
  getInstagramUserProfile,
  replyToInstagramComment,
  sendInstagramMessage,
  sendInstagramRichMessage,
  type InstagramUserProfileInfo,
} from "./api";
import { findMatchingRule } from "./matching";
import {
  advanceFlow,
  createFlowState,
  decodeFlowPayload,
  renderFlowTemplate,
  type FlowContactSnapshot,
  type FlowEffect,
  type FlowEngineEvent,
  type FlowEntryContext,
} from "./flow-engine";
import type {
  InstagramKeywordRule,
  InstagramRuleExecutionLog,
  InstagramRuleStats,
  NormalizedInstagramEvent,
} from "./types";
import { ingestZernioInbound } from "../zernio/ingest";
import type { SocialMessage } from "../social/parser";
import { SOCIAL_PROVIDER, socialMessageId } from "../social/catalog";

export interface InstagramChannelSessionRecord {
  id: string;
  display_name: string | null;
  status: string;
  accountId: string;
  meta_token_encrypted: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function getInstagramChannelSession(
  db: SupabaseClient,
  orgId: string,
): Promise<InstagramChannelSessionRecord | null> {
  const { data: session } = await db
    .from("channel_sessions")
    .select(
      "id, display_name, status, zernio_account_id, meta_token_encrypted, metadata, created_at, updated_at",
    )
    .eq("organization_id", orgId)
    .eq("provider", SOCIAL_PROVIDER)
    .is("archived_at", null)
    .maybeSingle();

  if (!session) return null;
  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  return {
    id: session.id as string,
    display_name: (session.display_name as string | null) ?? null,
    status: (session.status as string) ?? "WORKING",
    accountId: (session.zernio_account_id as string) || String(meta.ig_user_id || ""),
    meta_token_encrypted: (session.meta_token_encrypted as string | null) ?? null,
    metadata: meta,
    created_at: session.created_at as string,
    updated_at: session.updated_at as string,
  };
}

export async function upsertInstagramChannelSession(
  db: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    accountId: string;
    username: string;
    encryptedToken: string;
    metadata: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const { data: existing } = await db
    .from("channel_sessions")
    .select("id, metadata")
    .eq("organization_id", params.orgId)
    .eq("provider", SOCIAL_PROVIDER)
    .eq("zernio_account_id", params.accountId)
    .is("archived_at", null)
    .maybeSingle();

  const prevMetadata = (existing?.metadata ?? {}) as Record<string, unknown>;
  const updatedMetadata = {
    ...prevMetadata,
    ...params.metadata,
  };

  if (existing) {
    await db
      .from("channel_sessions")
      .update({
        display_name: `Instagram · @${params.username}`,
        status: "WORKING",
        meta_token_encrypted: params.encryptedToken,
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("organization_id", params.orgId);
    return { id: existing.id as string };
  }

  const { data: inserted } = await db
    .from("channel_sessions")
    .insert({
      organization_id: params.orgId,
      provider: SOCIAL_PROVIDER,
      waha_session_name: `ig_direct_${params.orgId.slice(0, 8)}_${params.accountId.slice(-6)}`,
      webhook_secret_encrypted: params.encryptedToken,
      zernio_account_id: params.accountId,
      display_name: `Instagram · @${params.username}`,
      status: "WORKING",
      meta_token_encrypted: params.encryptedToken,
      metadata: updatedMetadata,
      created_by: params.userId,
    })
    .select("id")
    .single();

  return { id: (inserted?.id as string) ?? "" };
}

interface ChannelSessionMetadata {
  platform?: string;
  direct_meta?: boolean;
  username?: string;
  name?: string;
  agent_id?: string | null;
  keyword_rules?: InstagramKeywordRule[];
  rule_executions?: InstagramRuleExecutionLog[];
  [key: string]: unknown;
}

const MAX_EXECUTION_LOGS = 400;

function emptyStats(): InstagramRuleStats {
  return {
    total_triggers: 0,
    comments_count: 0,
    public_replies_count: 0,
    dms_sent_count: 0,
    followers_count: 0,
    non_followers_count: 0,
    button_clicks_count: 0,
    last_executed_at: null,
  };
}

/**
 * Executa os efeitos retornados pelo motor visual (envio de mensagens com botões/quick replies,
 * adição de tags, webhooks externos) e retorna o resumo para o log de execução.
 */
async function runVisualFlowEffects(opts: {
  creds: ResolvedInstagramCreds;
  token: string;
  igUserId: string;
  senderId: string;
  ruleId: string;
  effects: FlowEffect[];
}): Promise<{
  dmTexts: string[];
  buttonsSent: string[];
  actionsExecuted: string[];
}> {
  const dmTexts: string[] = [];
  const buttonsSent: string[] = [];
  const actionsExecuted: string[] = [];

  for (const eff of opts.effects) {
    if (eff.type === "send") {
      const recipient = eff.viaCommentId
        ? { comment_id: eff.viaCommentId }
        : { id: opts.senderId };
      const payload = buildGraphMessagePayload(eff.message, opts.ruleId, eff.nodeId);
      await sendInstagramRichMessage(opts.creds, opts.token, recipient, payload, {
        igUserId: opts.igUserId,
      });
      if (eff.message.text) dmTexts.push(eff.message.text);
      for (const b of eff.message.buttons ?? []) {
        buttonsSent.push(b.title);
      }
      for (const q of eff.message.quickReplies ?? []) {
        buttonsSent.push(q.title);
      }
    } else if (eff.type === "add_tag") {
      actionsExecuted.push(`+tag:${eff.tag}`);
    } else if (eff.type === "remove_tag") {
      actionsExecuted.push(`-tag:${eff.tag}`);
    } else if (eff.type === "set_field") {
      actionsExecuted.push(`${eff.field}=${eff.value}`);
    } else if (eff.type === "handoff") {
      actionsExecuted.push("handoff_humano");
    } else if (eff.type === "webhook" && eff.url) {
      actionsExecuted.push(`webhook:${eff.url}`);
      fetch(eff.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eff.body),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  }

  return { dmTexts, buttonsSent, actionsExecuted };
}

/**
 * Atualiza os contadores da regra e adiciona uma linha de auditoria no histórico
 * de execuções (`metadata.rule_executions`) em `channel_sessions`.
 */
async function recordRuleExecution(
  db: SupabaseClient,
  sessionId: string,
  orgId: string,
  metadata: ChannelSessionMetadata,
  ruleId: string,
  entry: Omit<InstagramRuleExecutionLog, "id" | "executed_at">,
  increments: {
    trigger?: number;
    comment?: number;
    publicReply?: number;
    dmSent?: number;
    buttonClick?: number;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const rules: InstagramKeywordRule[] = Array.isArray(metadata.keyword_rules)
    ? metadata.keyword_rules
    : [];

  const updatedRules = rules.map((r) => {
    if (r.id !== ruleId) return r;
    const prev = r.stats ?? emptyStats();
    const isFollower = entry.is_follower;
    return {
      ...r,
      stats: {
        total_triggers: (prev.total_triggers || 0) + (increments.trigger ?? 0),
        comments_count: (prev.comments_count || 0) + (increments.comment ?? 0),
        public_replies_count: (prev.public_replies_count || 0) + (increments.publicReply ?? 0),
        dms_sent_count: (prev.dms_sent_count || 0) + (increments.dmSent ?? 0),
        followers_count:
          (prev.followers_count || 0) + (increments.trigger && isFollower === true ? 1 : 0),
        non_followers_count:
          (prev.non_followers_count || 0) + (increments.trigger && isFollower === false ? 1 : 0),
        button_clicks_count: (prev.button_clicks_count || 0) + (increments.buttonClick ?? 0),
        last_executed_at: nowIso,
      },
    };
  });

  const existingLogs: InstagramRuleExecutionLog[] = Array.isArray(metadata.rule_executions)
    ? metadata.rule_executions
    : [];

  const newLog: InstagramRuleExecutionLog = {
    ...entry,
    id: `exec_${randomUUID()}`,
    executed_at: nowIso,
  };

  const nextLogs = [newLog, ...existingLogs].slice(0, MAX_EXECUTION_LOGS);

  const nextMetadata: ChannelSessionMetadata = {
    ...metadata,
    keyword_rules: updatedRules,
    rule_executions: nextLogs,
  };

  await db
    .from("channel_sessions")
    .update({ metadata: nextMetadata, updated_at: nowIso })
    .eq("id", sessionId)
    .eq("organization_id", orgId);

  metadata.keyword_rules = updatedRules;
  metadata.rule_executions = nextLogs;
}

export async function processInstagramWebhookEvent(
  db: SupabaseClient,
  event: NormalizedInstagramEvent,
): Promise<{ status: "processed" | "ignored" | "error"; reason?: string }> {
  if (event.kind === "ignored") return { status: "ignored", reason: "evento_ignorado" };

  // Busca a sessão do canal correspondente à conta do Instagram
  const { data: candidates, error } = await db
    .from("channel_sessions")
    .select("id, organization_id, zernio_account_id, meta_token_encrypted, metadata, status")
    .eq("provider", SOCIAL_PROVIDER)
    .is("archived_at", null);

  const recipientId = (event as { recipientId?: string }).recipientId;
  const session =
    (candidates ?? []).find((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const igId = String(meta.ig_user_id || row.zernio_account_id || "");
      const pageId = String(meta.page_id || meta.facebook_page_id || "");
      return (
        igId === event.igUserId ||
        (recipientId && igId === recipientId) ||
        (pageId && (pageId === event.igUserId || (recipientId && pageId === recipientId))) ||
        row.zernio_account_id === event.igUserId ||
        (recipientId && row.zernio_account_id === recipientId)
      );
    }) ?? (candidates?.length === 1 ? candidates[0] : null);

  if (error || !session) {
    logger.info("[instagram.webhook] Nenhuma sessão ativa encontrada para conta", {
      igUserId: event.igUserId,
      recipientId,
      candidatos: (candidates ?? []).map((c) => c.zernio_account_id),
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
  if (!token && typeof metadata.access_token === "string") {
    token = metadata.access_token;
  }

  if (!token) {
    logger.warn("[instagram.webhook] Sessão sem token decifrável", { sessionId: session.id });
    return { status: "error", reason: "token_indisponivel" };
  }

  const creds = await resolveInstagramCreds(db, orgId);

  // -------------------------------------------------------------------------
  // 1. Trata Comentários (com regra de palavra-chave por post específico ou geral)
  // -------------------------------------------------------------------------
  if (event.kind === "comment") {
    // Evita responder comentários da própria conta conectada
    if (event.fromId === event.igUserId) {
      return { status: "ignored", reason: "comentario_da_propria_conta" };
    }

    const matchedRule = findMatchingRule(keywordRules, "comment_keyword", event.text, {
      mediaId: event.mediaId,
    });
    if (!matchedRule) {
      return { status: "ignored", reason: "sem_regra_para_comentario" };
    }

    // Busca dados completos do comentarista (nome, foto, se é seguidor ou não)
    const profile: InstagramUserProfileInfo | null = await getInstagramUserProfile(
      creds,
      token,
      event.fromId,
    );
    const username = profile?.username || event.fromUsername || `user_${event.fromId.slice(-4)}`;
    const fullName = profile?.name || event.fromUsername || null;
    const isFollower =
      typeof profile?.is_user_follow_business === "boolean"
        ? profile.is_user_follow_business
        : null;

    const contactSnap: FlowContactSnapshot = {
      username,
      name: fullName,
      is_follower: isFollower,
      follower_count: profile?.follower_count ?? null,
      tags: [],
      fields: {},
    };

    let publicReplySent: string | null = null;
    let dmSentText: string | null = null;
    let buttonsSent: string[] = [];
    let actionsExecuted: string[] = [];

    try {
      // 1.1 Resposta pública no post/Reel (se configurada)
      if (matchedRule.public_reply?.trim()) {
        const pubText = renderFlowTemplate(matchedRule.public_reply.trim(), contactSnap);
        await replyToInstagramComment(creds, token, event.commentId, pubText);
        publicReplySent = pubText;
      }

      // 1.2 Se a regra possui grafo visual ("visual"), executa pelo motor de fluxo
      if (matchedRule.mode === "visual" && matchedRule.flow_graph?.nodes?.length) {
        const entryCtx: FlowEntryContext = {
          type: "comment",
          commentId: event.commentId,
          mediaId: event.mediaId,
          text: event.text,
        };
        const out = advanceFlow(
          matchedRule.flow_graph,
          createFlowState(matchedRule.id),
          { contact: contactSnap, entry: entryCtx },
          { type: "start" },
        );
        const execSummary = await runVisualFlowEffects({
          creds,
          token,
          igUserId: event.igUserId,
          senderId: event.fromId,
          ruleId: matchedRule.id,
          effects: out.effects,
        });
        dmSentText = execSummary.dmTexts.join("\n\n") || null;
        buttonsSent = execSummary.buttonsSent;
        actionsExecuted = execSummary.actionsExecuted;
      } else if (matchedRule.dm_message?.trim()) {
        // Modo básico: envia a mensagem privada no Direct usando o comment_id
        const textToSend = renderFlowTemplate(matchedRule.dm_message.trim(), contactSnap);
        await sendInstagramMessage(
          creds,
          token,
          { comment_id: event.commentId },
          textToSend,
          { igUserId: event.igUserId },
        );
        dmSentText = textToSend;
      }

      await recordRuleExecution(
        db,
        session.id,
        orgId,
        metadata,
        matchedRule.id,
        {
          rule_id: matchedRule.id,
          rule_name: matchedRule.name ?? null,
          trigger_type: "comment_keyword",
          media_id: event.mediaId || matchedRule.media_id || null,
          media_caption_preview: matchedRule.media_caption_preview ?? null,
          ig_user_id: event.fromId,
          username,
          full_name: fullName,
          profile_pic: profile?.profile_pic ?? null,
          is_follower: isFollower,
          follower_count: profile?.follower_count ?? null,
          is_verified: profile?.is_verified_user ?? null,
          comment_or_message_text: event.text,
          public_reply_sent: publicReplySent,
          dm_sent: dmSentText,
          buttons_sent: buttonsSent,
          actions_executed: actionsExecuted,
          status: publicReplySent ? "replied" : "dm_only",
        },
        {
          trigger: 1,
          comment: 1,
          publicReply: publicReplySent ? 1 : 0,
          dmSent: dmSentText ? 1 : 0,
        },
      );

      return { status: "processed" };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("[instagram.webhook] Falha ao responder comentário", {
        commentId: event.commentId,
        erro: errMsg,
      });

      await recordRuleExecution(
        db,
        session.id,
        orgId,
        metadata,
        matchedRule.id,
        {
          rule_id: matchedRule.id,
          rule_name: matchedRule.name ?? null,
          trigger_type: "comment_keyword",
          media_id: event.mediaId || matchedRule.media_id || null,
          media_caption_preview: matchedRule.media_caption_preview ?? null,
          ig_user_id: event.fromId,
          username,
          full_name: fullName,
          profile_pic: profile?.profile_pic ?? null,
          is_follower: isFollower,
          follower_count: profile?.follower_count ?? null,
          is_verified: profile?.is_verified_user ?? null,
          comment_or_message_text: event.text,
          public_reply_sent: publicReplySent,
          dm_sent: dmSentText,
          status: "error",
          error_message: errMsg,
        },
        {
          trigger: 1,
          comment: 1,
          publicReply: publicReplySent ? 1 : 0,
          dmSent: 0,
        },
      ).catch(() => {});

      return { status: "error", reason: "falha_ao_responder_comentario" };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Trata Cliques em Botões (Postbacks) de Fluxos Visuais ManyChat/NexusReply
  // -------------------------------------------------------------------------
  if (event.kind === "postback") {
    const decoded = decodeFlowPayload(event.payload);
    if (decoded) {
      const rule = keywordRules.find((r) => r.id === decoded.ruleId);
      if (rule && rule.flow_graph?.nodes?.length) {
        const profile = await getInstagramUserProfile(creds, token, event.senderId);
        const username = profile?.username || `user_${event.senderId.slice(-4)}`;
        const fullName = profile?.name || null;
        const isFollower =
          typeof profile?.is_user_follow_business === "boolean"
            ? profile.is_user_follow_business
            : null;

        const contactSnap: FlowContactSnapshot = {
          username,
          name: fullName,
          is_follower: isFollower,
          follower_count: profile?.follower_count ?? null,
          tags: [],
          fields: {},
        };

        try {
          const pbEvent: FlowEngineEvent = {
            type: "postback",
            nodeId: decoded.nodeId,
            handleId: decoded.handleId,
          };
          const out = advanceFlow(
            rule.flow_graph,
            createFlowState(rule.id),
            { contact: contactSnap, entry: { type: "dm", text: event.title } },
            pbEvent,
          );
          const execSummary = await runVisualFlowEffects({
            creds,
            token,
            igUserId: event.igUserId,
            senderId: event.senderId,
            ruleId: rule.id,
            effects: out.effects,
          });

          await recordRuleExecution(
            db,
            session.id,
            orgId,
            metadata,
            rule.id,
            {
              rule_id: rule.id,
              rule_name: rule.name ?? null,
              trigger_type: "postback",
              ig_user_id: event.senderId,
              username,
              full_name: fullName,
              profile_pic: profile?.profile_pic ?? null,
              is_follower: isFollower,
              follower_count: profile?.follower_count ?? null,
              is_verified: profile?.is_verified_user ?? null,
              comment_or_message_text: `[Botão clicado] ${event.title}`,
              public_reply_sent: null,
              dm_sent: execSummary.dmTexts.join("\n\n") || null,
              buttons_sent: execSummary.buttonsSent,
              actions_executed: execSummary.actionsExecuted,
              status: "dm_only",
            },
            {
              dmSent: execSummary.dmTexts.length > 0 ? 1 : 0,
              buttonClick: 1,
            },
          );
        } catch (err) {
          logger.error("[instagram.webhook] Falha ao processar postback do fluxo visual", {
            senderId: event.senderId,
            erro: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return { status: "processed" };
  }

  // -------------------------------------------------------------------------
  // 3. Trata Mensagens Diretas (DMs) e Respostas de Stories
  // -------------------------------------------------------------------------
  if (event.kind === "message") {
    if (event.isEcho) {
      return { status: "ignored", reason: "mensagem_echo_da_propria_conta" };
    }

    const text = event.text ?? "";
    const profile = await getInstagramUserProfile(creds, token, event.senderId);
    const username = profile?.username || `user_${event.senderId.slice(-4)}`;
    const fullName = profile?.name || null;
    const isFollower =
      typeof profile?.is_user_follow_business === "boolean"
        ? profile.is_user_follow_business
        : null;

    const contactSnap: FlowContactSnapshot = {
      username,
      name: fullName,
      is_follower: isFollower,
      follower_count: profile?.follower_count ?? null,
      tags: [],
      fields: {},
    };

    // 3.0 Se veio payload de Quick Reply de um fluxo visual, avança o fluxo
    if (event.quickReplyPayload) {
      const decodedQr = decodeFlowPayload(event.quickReplyPayload);
      if (decodedQr) {
        const qrRule = keywordRules.find((r) => r.id === decodedQr.ruleId);
        if (qrRule?.flow_graph?.nodes?.length) {
          try {
            const out = advanceFlow(
              qrRule.flow_graph,
              createFlowState(qrRule.id),
              { contact: contactSnap, entry: { type: "dm", text } },
              { type: "postback", nodeId: decodedQr.nodeId, handleId: decodedQr.handleId },
            );
            const execSummary = await runVisualFlowEffects({
              creds,
              token,
              igUserId: event.igUserId,
              senderId: event.senderId,
              ruleId: qrRule.id,
              effects: out.effects,
            });
            await recordRuleExecution(
              db,
              session.id,
              orgId,
              metadata,
              qrRule.id,
              {
                rule_id: qrRule.id,
                rule_name: qrRule.name ?? null,
                trigger_type: "postback",
                ig_user_id: event.senderId,
                username,
                full_name: fullName,
                profile_pic: profile?.profile_pic ?? null,
                is_follower: isFollower,
                follower_count: profile?.follower_count ?? null,
                is_verified: profile?.is_verified_user ?? null,
                comment_or_message_text: `[Resposta rápida] ${text}`,
                dm_sent: execSummary.dmTexts.join("\n\n") || null,
                buttons_sent: execSummary.buttonsSent,
                actions_executed: execSummary.actionsExecuted,
                status: "dm_only",
              },
              {
                dmSent: execSummary.dmTexts.length > 0 ? 1 : 0,
                buttonClick: 1,
              },
            );
          } catch (err) {
            logger.error("[instagram.webhook] Falha ao processar quick_reply do fluxo visual", {
              senderId: event.senderId,
              erro: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } else {
      // 3.1 Verifica regra de palavra-chave para story_mention ou dm_keyword
      let matchedRule: InstagramKeywordRule | null = null;
      let triggeredType: "story_mention" | "dm_keyword" = "dm_keyword";

      if (event.storyMention || event.storyReply) {
        matchedRule = findMatchingRule(keywordRules, "story_mention", text, {
          mediaId: event.storyId,
        });
        if (matchedRule) triggeredType = "story_mention";
      }
      if (!matchedRule) {
        matchedRule = findMatchingRule(keywordRules, "dm_keyword", text);
        triggeredType = "dm_keyword";
      }

      if (matchedRule) {
        try {
          let dmSentText: string | null = null;
          let buttonsSent: string[] = [];
          let actionsExecuted: string[] = [];

          if (matchedRule.mode === "visual" && matchedRule.flow_graph?.nodes?.length) {
            const out = advanceFlow(
              matchedRule.flow_graph,
              createFlowState(matchedRule.id),
              {
                contact: contactSnap,
                entry: {
                  type: triggeredType === "story_mention" ? "story_mention" : "dm",
                  mediaId: event.storyId,
                  text,
                },
              },
              { type: "start" },
            );
            const execSummary = await runVisualFlowEffects({
              creds,
              token,
              igUserId: event.igUserId,
              senderId: event.senderId,
              ruleId: matchedRule.id,
              effects: out.effects,
            });
            dmSentText = execSummary.dmTexts.join("\n\n") || null;
            buttonsSent = execSummary.buttonsSent;
            actionsExecuted = execSummary.actionsExecuted;
          } else if (matchedRule.dm_message?.trim()) {
            const renderedDm = renderFlowTemplate(matchedRule.dm_message.trim(), contactSnap);
            await sendInstagramMessage(
              creds,
              token,
              { id: event.senderId },
              renderedDm,
              { igUserId: event.igUserId },
            );
            dmSentText = renderedDm;
          }

          await recordRuleExecution(
            db,
            session.id,
            orgId,
            metadata,
            matchedRule.id,
            {
              rule_id: matchedRule.id,
              rule_name: matchedRule.name ?? null,
              trigger_type: triggeredType,
              media_id: event.storyId || matchedRule.media_id || null,
              media_caption_preview: matchedRule.media_caption_preview ?? null,
              ig_user_id: event.senderId,
              username,
              full_name: fullName,
              profile_pic: profile?.profile_pic ?? null,
              is_follower: isFollower,
              follower_count: profile?.follower_count ?? null,
              is_verified: profile?.is_verified_user ?? null,
              comment_or_message_text:
                text || (event.storyMention ? "[Mencionou no Story]" : "[Mensagem]"),
              public_reply_sent: null,
              dm_sent: dmSentText,
              buttons_sent: buttonsSent,
              actions_executed: actionsExecuted,
              status: "dm_only",
            },
            {
              trigger: 1,
              dmSent: dmSentText ? 1 : 0,
            },
          );
        } catch (err) {
          logger.error("[instagram.webhook] Falha ao enviar DM de automação", {
            senderId: event.senderId,
            erro: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 3.2 Ingestão na conversa do CRM
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
        displayName:
          profile?.name ?? profile?.username ?? `Instagram ${event.senderId.slice(-4)}`,
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
