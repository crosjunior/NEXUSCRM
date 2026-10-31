/**
 * Tipos e contratos do Assistente de Onboarding Autônomo do NexusCRMAgent.
 */

export interface AutonomousExtractionInput {
  website_url?: string;
  instagram?: string;
  google_maps_url?: string;
  drive_links?: string[];
  freeform_notes?: string;
  files?: Array<{
    name: string;
    type: string;
    size?: number;
    base64_data?: string;
    text?: string;
  }>;
}

export interface CatalogItem {
  name: string;
  category: string;
  description: string;
  price_cents: number;
  currency: string;
  payment_methods: string[];
  delivery_time: string;
}

export interface FunnelStage {
  name: string;
  slug: string;
  description: string;
  color: string;
  is_won?: boolean;
  is_lost?: boolean;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ObjectionItem {
  objection: string;
  rebuttal: string;
}

export interface FollowUpSequence {
  delay_minutes: number;
  label: string;
  message_template: string;
}

export interface PersistentDocumentMetadata {
  name: string;
  original_name: string;
  description: string;
  category: string;
  version: number;
  uploaded_at: string;
  source_url?: string;
  file_size?: number;
  mime_type?: string;
}

export interface GapItem {
  field: string;
  title: string;
  description: string;
  why_needed: string;
  example_value: string;
  current_value?: string;
}

export interface BrandIdentityExtraction {
  name: string;
  slug: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  colors?: string[]; // Suporte a até 5 cores da marca
  font_primary?: string; // Fonte Google para Títulos
  font_secondary?: string; // Fonte Google para Textos
  logo_url: string | null;
  typography_style: string;
  icon_archetype: string;
  tone_of_voice: string;
}

export interface AutonomousExtractionOutput {
  brand_identity: BrandIdentityExtraction;
  niche: string;
  catalog: CatalogItem[];
  business_rules: {
    operating_hours: string;
    coverage_or_address: string;
    warranty_and_refund: string;
    max_discount_percentage: number;
  };
  sales_funnel: {
    niche: string;
    stages: FunnelStage[];
  };
  objections_and_faqs: {
    faqs: FaqItem[];
    objections: ObjectionItem[];
  };
  follow_ups: {
    sequences: FollowUpSequence[];
  };
  human_handoff: {
    trigger_keywords: string[];
    conditions: string[];
  };
  master_knowledge_markdown: string;
  persistent_documents: PersistentDocumentMetadata[];
  gaps_found: GapItem[];
  completeness_score: number;
}
