export interface InstagramAccountInfo {
  id: string;
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  caption_preview: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_product_type: "FEED" | "REELS" | "STORY" | "AD" | string;
  media_url?: string;
  thumbnail_url?: string;
  preview_url: string | null;
  permalink?: string;
  timestamp: string;
}

export type InstagramKeywordType = "comment_keyword" | "story_mention" | "dm_keyword";
export type InstagramMatchMode = "contains" | "exact";

// ---------------------------------------------------------------------
// Tipos do Construtor Visual de Fluxos (ManyChat / NexusReply style)
// ---------------------------------------------------------------------
export type FlowNodeType = "start" | "message" | "input" | "condition" | "action" | "delay" | "ai";

export type FlowTriggerType =
  | "comment_keyword"
  | "dm_keyword"
  | "story_reply"
  | "story_mention"
  | "default_reply";

export interface FlowTriggerConfig {
  id: string;
  type: FlowTriggerType;
  keywords: string[];
  match: "contains" | "exact" | "any";
  mediaId?: string | null;
  publicReplies?: string[];
  cooldownHours?: number;
}

export interface FlowButtonItem {
  id: string;
  title: string;
  type: "postback" | "url";
  url?: string;
}

export interface FlowQuickReplyItem {
  id: string;
  title: string;
}

export interface FlowStartData {
  triggers: FlowTriggerConfig[];
}

export interface FlowMessageData {
  text: string;
  imageUrl?: string;
  buttons: FlowButtonItem[];
  quickReplies: FlowQuickReplyItem[];
}

export interface FlowInputData {
  question: string;
  field: string;
  validation: "text" | "email" | "phone" | "number";
  retryMessage: string;
  skipLabel?: string;
}

export type FlowConditionOp =
  | "is_follower"
  | "not_follower"
  | "has_tag"
  | "not_has_tag"
  | "field_equals"
  | "field_contains"
  | "field_exists";

export interface FlowConditionData {
  op: FlowConditionOp;
  tag?: string;
  field?: string;
  value?: string;
}

export interface FlowActionItem {
  id: string;
  kind: "add_tag" | "remove_tag" | "set_field" | "handoff" | "webhook";
  tag?: string;
  field?: string;
  value?: string;
  url?: string;
}

export interface FlowActionData {
  actions: FlowActionItem[];
}

export interface FlowDelayData {
  minutes: number;
}

export interface FlowAiData {
  systemPrompt: string;
  conversational: boolean;
  maxTurns: number;
}

export interface FlowNodeDataMap {
  start: FlowStartData;
  message: FlowMessageData;
  input: FlowInputData;
  condition: FlowConditionData;
  action: FlowActionData;
  delay: FlowDelayData;
  ai: FlowAiData;
}

export interface FlowNode<T extends FlowNodeType = FlowNodeType> {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: FlowNodeDataMap[T];
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
}

export interface InstagramFlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ---------------------------------------------------------------------
// Indicadores e Logs de Execução de Regras
// ---------------------------------------------------------------------
export interface InstagramRuleStats {
  total_triggers: number;
  comments_count: number;
  public_replies_count: number;
  dms_sent_count: number;
  followers_count: number;
  non_followers_count: number;
  button_clicks_count: number;
  last_executed_at?: string | null;
}

export interface InstagramRuleExecutionLog {
  id: string;
  rule_id: string;
  rule_name?: string | null;
  trigger_type: InstagramKeywordType | "postback";
  media_id?: string | null;
  media_caption_preview?: string | null;
  ig_user_id: string;
  username: string;
  full_name?: string | null;
  profile_pic?: string | null;
  is_follower: boolean | null;
  follower_count?: number | null;
  is_verified?: boolean | null;
  comment_or_message_text: string;
  public_reply_sent?: string | null;
  dm_sent?: string | null;
  buttons_sent?: string[];
  actions_executed?: string[];
  status: "replied" | "dm_only" | "error";
  error_message?: string | null;
  executed_at: string;
}

export interface InstagramKeywordRule {
  id: string;
  name?: string | null;
  /** Modo de criação: "basic" (formulário tradicional) ou "visual" (construtor de fluxo ManyChat/NexusReply) */
  mode?: "basic" | "visual";
  type: InstagramKeywordType;
  keywords: string[];
  match: InstagramMatchMode;
  public_reply?: string | null;
  dm_message: string;
  active: boolean;
  /** ID do Post, Reels ou Story específico; null ou vazio = qualquer publicação */
  media_id?: string | null;
  media_caption_preview?: string | null;
  media_thumbnail_url?: string | null;
  media_product_type?: string | null;
  media_permalink?: string | null;
  /** Se true (padrão), a regra é permanente. Se false, respeita starts_at e ends_at */
  is_permanent?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  /** Grafo visual quando a regra é criada ou editada no modo visual */
  flow_graph?: InstagramFlowGraph | null;
  /** Indicadores acumulados da regra */
  stats?: InstagramRuleStats | null;
}

export interface InstagramTenantConfig {
  app_id?: string;
  app_secret?: string;
  config_id?: string;
  verify_token?: string;
}

export type NormalizedInstagramEvent =
  | {
      kind: "comment";
      commentId: string;
      mediaId: string;
      mediaProductType?: string;
      fromId: string;
      fromUsername?: string;
      text: string;
      igUserId: string;
    }
  | {
      kind: "message";
      mid: string;
      senderId: string;
      recipientId: string;
      text?: string;
      quickReplyPayload?: string;
      isEcho: boolean;
      storyReply?: boolean;
      storyMention?: boolean;
      storyId?: string;
      attachments: Array<{ type: string; url?: string }>;
      igUserId: string;
    }
  | {
      kind: "postback";
      mid: string;
      senderId: string;
      recipientId: string;
      title: string;
      payload: string;
      igUserId: string;
    }
  | {
      kind: "ignored";
    };
