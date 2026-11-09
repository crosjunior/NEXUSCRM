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

export interface InstagramKeywordRule {
  id: string;
  name?: string | null;
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
