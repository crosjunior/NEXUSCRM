export interface InstagramAccountInfo {
  id: string;
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
}

export type InstagramKeywordType = "comment_keyword" | "story_mention" | "dm_keyword";
export type InstagramMatchMode = "contains" | "exact";

export interface InstagramKeywordRule {
  id: string;
  type: InstagramKeywordType;
  keywords: string[];
  match: InstagramMatchMode;
  public_reply?: string | null;
  dm_message: string;
  active: boolean;
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
