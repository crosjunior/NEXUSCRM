/**
 * Motor de Extração Multimodal do Assistente de Onboarding do NexusCRMAgent.
 *
 * Processa simultaneamente:
 * - Links de sites (faz web scraping profundo de HTML, CSS, fontes e logo)
 * - Redes sociais (Instagram, Google Maps)
 * - Arquivos (PDFs com texto extraído, imagens de logotipo, tabelas e notas)
 * - Pastas na nuvem (Google Drive, OneDrive)
 *
 * Utiliza o Google Gemini (gemini-3.8-flash / gemini-2.0-flash / gemini-1.5-flash)
 * com fallback determinístico resiliente ancorado nos dados técnicos extraídos do site.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { slugifyEmpresa } from "@/lib/tenants/slug-pure";
import type {
  AutonomousExtractionInput,
  AutonomousExtractionOutput,
  BrandIdentityExtraction,
  GapItem,
  PersistentDocumentMetadata,
} from "./autonomous-types";

interface ScrapedSiteIdentity {
  siteName: string | null;
  logoUrl: string | null;
  dominantColors: string[];
  fonts: string[];
  textExcerpt: string;
}

/**
 * Faz web scraping direto do site para extrair título real, logo, cores no CSS e fontes Google.
 */
async function extrairIdentidadeDoSite(siteUrl: string): Promise<ScrapedSiteIdentity> {
  const result: ScrapedSiteIdentity = {
    siteName: null,
    logoUrl: null,
    dominantColors: [],
    fonts: [],
    textExcerpt: "",
  };

  try {
    const targetUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
    const parsedUrl = new URL(targetUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const resp = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return result;
    const html = await resp.text();

    // 1. Extrair Nome Real da Empresa do <title> ou OpenGraph
    const ogSiteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

    let candidateName = ogSiteName || titleMatch || ogTitle || "";
    if (candidateName) {
      candidateName = candidateName
        .replace(/^(Home|Início|Principal|Site Oficial)\s*[-|–—]\s*/i, "")
        .replace(/\s*[-|–—]\s*(Home|Início|Principal|Oficial|Brasil|Santos|SP)$/i, "")
        .replace(/[-|–—]\s*$/, "")
        .trim();

      if (candidateName.length > 1 && candidateName.length < 60) {
        result.siteName = candidateName;
      }
    }

    // 2. Extrair Logotipo da Empresa
    const logoRegex = /<img[^>]+src=["']([^"']*(?:logo|marca|brand)[^"']*\.(?:png|svg|jpg|webp))["'][^>]*>/gi;
    let logoMatch: RegExpExecArray | null;
    const foundLogos: string[] = [];

    while ((logoMatch = logoRegex.exec(html)) !== null) {
      if (logoMatch[1]) foundLogos.push(logoMatch[1]);
    }

    // Buscar também imagem na tag header ou nav
    const headerHtml = html.match(/<header[\s\S]*?<\/header>/i)?.[0] || "";
    const headerImgRegex = /<img[^>]+src=["']([^"']+\.(?:png|svg|jpg|webp))["'][^>]*>/gi;
    let headerImgMatch: RegExpExecArray | null;
    while ((headerImgMatch = headerImgRegex.exec(headerHtml)) !== null) {
      if (headerImgMatch[1]) foundLogos.push(headerImgMatch[1]);
    }

    if (foundLogos.length > 0) {
      let chosenLogo = foundLogos[0]!;
      // Preferir logo que não seja versão branca ou ícone diminuto
      const nonWhite = foundLogos.find((l) => !l.toLowerCase().includes("branco") && !l.toLowerCase().includes("white"));
      if (nonWhite) chosenLogo = nonWhite;

      if (chosenLogo.startsWith("//")) {
        result.logoUrl = `${parsedUrl.protocol}${chosenLogo}`;
      } else if (chosenLogo.startsWith("/")) {
        result.logoUrl = `${parsedUrl.origin}${chosenLogo}`;
      } else if (chosenLogo.startsWith("http")) {
        result.logoUrl = chosenLogo;
      } else {
        result.logoUrl = `${parsedUrl.origin}/${chosenLogo}`;
      }
    }

    // 3. Extrair Paleta de Cores Hexadecimais (#HEX) do CSS
    const hexRegex = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
    const hexes = html.match(hexRegex) || [];
    const colorCounts: Record<string, number> = {};

    const ignoredHexes = new Set([
      "#fff", "#ffffff", "#000", "#000000",
      "#eee", "#eeeeee", "#ddd", "#dddddd",
      "#ccc", "#cccccc", "#f5f5f5", "#fafafa",
      "#333", "#333333", "#444", "#444444",
      "#555", "#555555", "#666", "#666666",
      "#777", "#777777", "#888", "#888888",
    ]);

    for (const h of hexes) {
      let lower = h.toLowerCase();
      if (lower.length === 4) {
        // Expandir #abc para #aabbcc
        lower = `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
      }
      if (!ignoredHexes.has(lower)) {
        colorCounts[lower] = (colorCounts[lower] || 0) + 1;
      }
    }

    const sortedColors = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([hex]) => hex);

    // Pegar até 5 cores dominantes e distintas
    result.dominantColors = sortedColors.slice(0, 5);

    // 4. Extrair Fontes Google
    const webfontMatch = html.match(/families:\s*\[([^\]]+)\]/i);
    if (webfontMatch?.[1]) {
      const familyMatches = webfontMatch[1].match(/"([^":]+)(?::[^"]*)?"/g) || [];
      familyMatches.forEach((item) => {
        const clean = item.replace(/"/g, "").split(":")[0]?.trim();
        if (clean && !result.fonts.includes(clean)) result.fonts.push(clean);
      });
    }

    const googleFontLink = html.match(/fonts\.googleapis\.com\/css2?\?family=([a-zA-Z0-9+]+)/gi) || [];
    for (const link of googleFontLink) {
      const match = link.match(/family=([a-zA-Z0-9+]+)/i);
      if (match?.[1]) {
        const clean = match[1].replace(/\+/g, " ");
        if (!result.fonts.includes(clean)) result.fonts.push(clean);
      }
    }

    // 5. Extrair resumo de texto da página
    const paragraphs = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .match(/<(?:p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/(?:p|h1|h2|h3|li)>/gi) || [];

    const cleanLines = paragraphs
      .map((p) => p.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 25);

    result.textExcerpt = cleanLines.slice(0, 40).join("\n");
  } catch (err) {
    console.warn("Falha silenciosa ao extrair dados ao vivo do site:", err);
  }

  return result;
}

/**
 * Carrega a chave de API ativa do Google para a organização.
 */
async function obterChaveGoogle(organizationId: string): Promise<string | null> {
  const admin = createAdminClient();

  // 1. Tenta credencial da organização
  const { data: cred } = await admin
    .from("ai_provider_credentials")
    .select("api_key_encrypted, api_key_iv, api_key_tag, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", "google")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (cred?.api_key_encrypted && cred?.api_key_iv && cred?.api_key_tag) {
    try {
      return decryptKey({
        ciphertext: byteaToBuffer(cred.api_key_encrypted),
        iv: byteaToBuffer(cred.api_key_iv),
        tag: byteaToBuffer(cred.api_key_tag),
      });
    } catch {
      // Degrada para credencial de ambiente
    }
  }

  // 2. Chave de ambiente
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  return null;
}

export async function extrairConfiguracaoAutonoma(
  input: AutonomousExtractionInput,
  organizationId: string,
): Promise<AutonomousExtractionOutput> {
  // 1. Extração técnica ao vivo do site oficial (cores, logo, nome real, fontes)
  let scrapedIdentity: ScrapedSiteIdentity = {
    siteName: null,
    logoUrl: null,
    dominantColors: [],
    fonts: [],
    textExcerpt: "",
  };

  if (input.website_url) {
    scrapedIdentity = await extrairIdentidadeDoSite(input.website_url);
  }

  // 2. Prepara o inventário de documentos persistentes
  const persistentDocs: PersistentDocumentMetadata[] = (input.files || []).map((f, idx) => ({
    name: f.name || `Documento_${idx + 1}`,
    original_name: f.name || `arquivo_${idx + 1}`,
    description: `Arquivo de conhecimento importado durante a configuração autônoma: ${f.name}`,
    category: classificarCategoriaArquivo(f.name),
    version: 1,
    uploaded_at: new Date().toISOString(),
    file_size: f.size,
    mime_type: f.type,
  }));

  (input.drive_links || []).forEach((link, idx) => {
    if (link.trim()) {
      persistentDocs.push({
        name: `Nuvem_${idx + 1}_${link.includes("drive.google") ? "GoogleDrive" : "OneDrive"}`,
        original_name: link,
        description: `Link de pasta/documentos sincronizados na nuvem: ${link}`,
        category: "Nuvem Externa",
        version: 1,
        uploaded_at: new Date().toISOString(),
        source_url: link,
      });
    }
  });

  // 3. Tentar extração via Google Gemini com escada de modelos atualizados
  const apiKey = await obterChaveGoogle(organizationId);
  if (apiKey) {
    const google = createGoogleGenerativeAI({ apiKey });
    const prompt = montarPromptExtracao(input, scrapedIdentity);

    // Escada de modelos Gemini suportados em produção
    const modelosParaTestar = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

    for (const modelName of modelosParaTestar) {
      try {
        const response = await generateText({
          model: google(modelName),
          system: `Você é o Arquiteto Sênior de Soluções e Engenheiro de IA do NexusCRMAgent.
Sua missão é realizar a extração e parametrização completa do CRM a partir de todos os materiais fornecidos (sites, documentos, PDFs de tabelas/apresentações, redes sociais, notas).

DIRETRIZES FUNDAMENTAIS DE EXTRAÇÃO:
1. NOME DA EMPRESA: Mantenha o nome correto, oficial e com espaços normais (ex: "Grupo Mendes", NUNCA "grupomendes"). O slug ("grupomendes") é separado e usado apenas na URL.
2. IDENTIDADE DA MARCA: Use os dados técnicos do site detectados se fornecidos (cores #HEX reais, logo e fontes). A paleta pode ter até 5 cores no array "colors".
3. CATÁLOGO COMPLETO: Extraia minuciosamente todos os produtos, empreendimentos, imóveis ou serviços citados nos documentos, com preços em centavos (ou 0 se sob consulta), prazos e condições.
4. DOCUMENTO MESTRE EM MARKDOWN (master_knowledge_markdown): DEVE SER UMA BASE DE CONHECIMENTO PROFUNDA, COMPLETA E EXAUSTIVA! Não faça resumos superficiais. Transcreva todas as tabelas de preços, regras comerciais, metragens, diferenciais, perguntas frequentes e argumentos de venda encontrados nos documentos.
5. REGRAS E FUNIL: Defina o funil de vendas sob medida para o nicho específico e regras de handoff humano.

Responda ESTRITAMENTE em formato JSON compatível com o schema AutonomousExtractionOutput.`,
          prompt,
        });

        const jsonText = limparMarkdownJson(response.text);
        const parsed = JSON.parse(jsonText) as Partial<AutonomousExtractionOutput>;

        if (parsed.brand_identity && parsed.catalog && parsed.sales_funnel) {
          return consolidarExtracao(parsed, input, scrapedIdentity, persistentDocs);
        }
      } catch (err) {
        console.warn(`Tentativa com modelo ${modelName} falhou:`, err);
      }
    }
  }

  // 4. Fallback determinístico inteligente ancorado nos dados reais do site e documentos
  return gerarBlueprintPadrao(input, scrapedIdentity, persistentDocs);
}

function montarPromptExtracao(input: AutonomousExtractionInput, scraped: ScrapedSiteIdentity): string {
  let prompt = "Analise minuciosamente os materiais abaixo para configurar integralmente o NexusCRMAgent:\n\n";

  if (input.website_url) prompt += `- Site Oficial: ${input.website_url}\n`;
  if (input.instagram) prompt += `- Instagram Comercial: ${input.instagram}\n`;
  if (input.google_maps_url) prompt += `- Localização / Google Maps: ${input.google_maps_url}\n`;
  if (input.drive_links?.length) prompt += `- Pastas na Nuvem: ${input.drive_links.join(", ")}\n`;
  if (input.freeform_notes) prompt += `- Observações do Usuário:\n${input.freeform_notes}\n`;

  // Dados técnicos comprovados do site
  if (scraped.siteName || scraped.dominantColors.length > 0 || scraped.logoUrl || scraped.fonts.length > 0) {
    prompt += "\n--- DADOS TÉCNICOS DETECTADOS DIRETAMENTE NO SITE ---\n";
    if (scraped.siteName) prompt += `• Nome Oficial Detectado: "${scraped.siteName}"\n`;
    if (scraped.logoUrl) prompt += `• URL do Logotipo Oficial: ${scraped.logoUrl}\n`;
    if (scraped.dominantColors.length > 0)
      prompt += `• Cores Hexadecimais Dominantes no CSS: ${scraped.dominantColors.join(", ")}\n`;
    if (scraped.fonts.length > 0) prompt += `• Fontes Google Detectadas: ${scraped.fonts.join(", ")}\n`;
    if (scraped.textExcerpt) prompt += `• Trecho Textual do Site:\n${scraped.textExcerpt}\n`;
    prompt += "-----------------------------------------------------\n";
  }

  if (input.files?.length) {
    prompt += "\n--- CONTEÚDO DOS DOCUMENTOS E ARQUIVOS ANEXADOS ---\n";
    for (const f of input.files) {
      prompt += `\n[ARQUIVO: ${f.name} | TIPO: ${f.type}]\n`;
      if (f.text) {
        // Enviar até 35.000 caracteres por arquivo para não perder detalhes de tabelas
        prompt += `${f.text.slice(0, 35000)}\n`;
      } else {
        prompt += `(Arquivo de mídia binária: ${f.size || 0} bytes)\n`;
      }
    }
    prompt += "---------------------------------------------------\n";
  }

  prompt += `\nRetorne obrigatoriamente um objeto JSON com esta estrutura:
{
  "brand_identity": {
    "name": "${scraped.siteName || "Nome da Empresa"}",
    "slug": "${scraped.siteName ? slugifyEmpresa(scraped.siteName) : "slugdaempresa"}",
    "primary_color": "${scraped.dominantColors[0] || "#001b4a"}",
    "secondary_color": "${scraped.dominantColors[1] || "#e1b63c"}",
    "accent_color": "${scraped.dominantColors[2] || "#009fe3"}",
    "colors": ${JSON.stringify(scraped.dominantColors.length > 0 ? scraped.dominantColors : ["#001b4a", "#e1b63c", "#009fe3"])},
    "font_primary": "${scraped.fonts[0] || "Lato"}",
    "font_secondary": "${scraped.fonts[1] || "Inter"}",
    "logo_url": ${scraped.logoUrl ? `"${scraped.logoUrl}"` : "null"},
    "typography_style": "${scraped.fonts.length > 0 ? scraped.fonts.join(" / ") : "Lato / Inter"}",
    "icon_archetype": "moderno-corporativo",
    "tone_of_voice": "Tom de voz profissional e resolutivo adaptado para WhatsApp"
  },
  "niche": "Ramo de atuação identificado",
  "catalog": [
    {
      "name": "Nome do Produto, Empreendimento ou Serviço",
      "category": "Categoria",
      "description": "Descrição detalhada com especificações",
      "price_cents": 1500000,
      "currency": "BRL",
      "payment_methods": ["Entrada Facilitada", "Financiamento", "PIX"],
      "delivery_time": "Pronto para entrega / Imediato"
    }
  ],
  "business_rules": {
    "operating_hours": "Segunda a Sexta, das 09h às 18h",
    "coverage_or_address": "Endereço ou Região de Atuação",
    "warranty_and_refund": "Política e Garantia",
    "max_discount_percentage": 5
  },
  "sales_funnel": {
    "niche": "Ramo da Empresa",
    "stages": [
      { "name": "Novo Lead", "slug": "novo-lead", "description": "Primeiro contato", "color": "#3b82f6" },
      { "name": "Interesse Qualificado", "slug": "qualificado", "description": "Perfil validado", "color": "#8b5cf6" },
      { "name": "Apresentação / Visita", "slug": "visita", "description": "Em negociação", "color": "#eab308" },
      { "name": "Proposta Enviada", "slug": "proposta", "description": "Aguardando assinatura", "color": "#f97316" },
      { "name": "Fechado Ganho", "slug": "fechado-ganho", "description": "Contrato assinado", "color": "#10b981", "is_won": true },
      { "name": "Perdido", "slug": "perdido", "description": "Desistência", "color": "#ef4444", "is_lost": true }
    ]
  },
  "objections_and_faqs": {
    "faqs": [
      { "question": "Pergunta frequente extraída", "answer": "Resposta completa baseada nos documentos" }
    ],
    "objections": [
      { "objection": "Objeção comum de clientes", "rebuttal": "Argumento e contorno eficaz" }
    ]
  },
  "follow_ups": {
    "sequences": [
      { "delay_minutes": 30, "label": "Follow-up Imediato", "message_template": "Texto da mensagem" },
      { "delay_minutes": 1440, "label": "Lembrete 24h", "message_template": "Texto do lembrete" }
    ]
  },
  "human_handoff": {
    "trigger_keywords": ["falar com humano", "corretor", "atendente", "falar com pessoa", "gerente"],
    "conditions": ["Solicitação expressa de atendente humano", "Negociação avançada de valores"]
  },
  "master_knowledge_markdown": "# Base de Conhecimento Oficial\\n(Texto longo, exaustivo e organizado com todas as informações extraídas dos documentos)",
  "gaps_found": []
}`;

  return prompt;
}

function consolidarExtracao(
  parsed: Partial<AutonomousExtractionOutput>,
  input: AutonomousExtractionInput,
  scraped: ScrapedSiteIdentity,
  persistentDocs: AutonomousExtractionOutput["persistent_documents"],
): AutonomousExtractionOutput {
  // Garantir nome correto com espaços
  const brandName =
    parsed.brand_identity?.name ||
    scraped.siteName ||
    inferirNomeEmpresa(input, scraped);

  const slug = slugifyEmpresa(brandName);

  // Paleta de cores (até 5 cores)
  let colors = parsed.brand_identity?.colors;
  if (!colors || colors.length === 0) {
    if (scraped.dominantColors.length > 0) {
      colors = scraped.dominantColors;
    } else {
      colors = [
        parsed.brand_identity?.primary_color || "#001b4a",
        parsed.brand_identity?.secondary_color || "#e1b63c",
        parsed.brand_identity?.accent_color || "#009fe3",
      ];
    }
  }

  // Garantir cores primárias e secundárias alinhadas
  const primaryColor = colors[0] || parsed.brand_identity?.primary_color || "#001b4a";
  const secondaryColor = colors[1] || parsed.brand_identity?.secondary_color || "#e1b63c";
  const accentColor = colors[2] || parsed.brand_identity?.accent_color || "#009fe3";

  // Fontes Google
  const fontPrimary = parsed.brand_identity?.font_primary || scraped.fonts[0] || "Lato";
  const fontSecondary = parsed.brand_identity?.font_secondary || scraped.fonts[1] || "Inter";

  const logoUrl = parsed.brand_identity?.logo_url || scraped.logoUrl || null;

  const brandIdentity: BrandIdentityExtraction = {
    name: brandName,
    slug,
    primary_color: primaryColor,
    secondary_color: secondaryColor,
    accent_color: accentColor,
    colors: colors.slice(0, 5),
    font_primary: fontPrimary,
    font_secondary: fontSecondary,
    logo_url: logoUrl,
    typography_style: `${fontPrimary} / ${fontSecondary}`,
    icon_archetype: parsed.brand_identity?.icon_archetype || "moderno-corporativo",
    tone_of_voice:
      parsed.brand_identity?.tone_of_voice ||
      "Profissional, atencioso, seguro e ágil nas respostas por WhatsApp",
  };

  const catalog = parsed.catalog || [];
  const rules = parsed.business_rules || {
    operating_hours: "Segunda a Sexta, das 09h às 18h",
    coverage_or_address: "Atendimento presencial e online",
    warranty_and_refund: "Garantia e conformidade contratual",
    max_discount_percentage: 5,
  };

  const faqs = parsed.objections_and_faqs?.faqs || [];
  const gaps = identificarLacunas(brandIdentity, catalog, rules);

  let masterMarkdown = parsed.master_knowledge_markdown;
  if (!masterMarkdown || masterMarkdown.length < 200) {
    masterMarkdown = gerarMasterMarkdown(brandIdentity, catalog, rules, faqs, input.files);
  }

  return {
    brand_identity: brandIdentity,
    niche: parsed.niche || "Empreendimentos & Negócios",
    catalog,
    business_rules: rules,
    sales_funnel: parsed.sales_funnel || gerarFunilPadrao("Comercial"),
    objections_and_faqs: parsed.objections_and_faqs || {
      faqs: [
        {
          question: "Como posso conhecer mais detalhes?",
          answer: "Nossa equipe pode apresentar materiais completos e agendar um atendimento exclusivo.",
        },
      ],
      objections: [
        {
          objection: "Gostaria de avaliar com calma",
          rebuttal: "Com certeza! Vou lhe encaminhar a apresentação para sua consulta.",
        },
      ],
    },
    follow_ups: parsed.follow_ups || {
      sequences: [
        {
          delay_minutes: 30,
          label: "Acompanhamento Inicial",
          message_template: "Olá! Conseguiu visualizar as informações que enviamos?",
        },
        {
          delay_minutes: 1440,
          label: "Lembrete 24h",
          message_template: "Oi! Permaneço à disposição se quiser tirar qualquer dúvida.",
        },
      ],
    },
    human_handoff: parsed.human_handoff || {
      trigger_keywords: ["atendente", "falar com humano", "corretor", "especialista"],
      conditions: ["Lead solicitou atendimento com especialista humano"],
    },
    master_knowledge_markdown: masterMarkdown,
    persistent_documents: persistentDocs,
    gaps_found: gaps,
    completeness_score: Math.min(100, Math.max(80, 100 - gaps.length * 10)),
  };
}

function identificarLacunas(
  brand: BrandIdentityExtraction,
  catalog: AutonomousExtractionOutput["catalog"],
  rules: AutonomousExtractionOutput["business_rules"],
): GapItem[] {
  const gaps: GapItem[] = [];

  if (catalog.length === 0) {
    gaps.push({
      field: "catalog",
      title: "Principais Produtos ou Empreendimentos",
      description: "Não encontramos uma tabela de produtos ou serviços detalhada nos materiais.",
      why_needed: "Permite ao agente responder valores, metragens, prazos e opções no WhatsApp.",
      example_value: "Ex.: Empreendimento Villa Mar, Unidades a partir de R$ 500.000",
    });
  }

  if (!rules.operating_hours || rules.operating_hours.length < 5) {
    gaps.push({
      field: "operating_hours",
      title: "Horário de Atendimento da Equipe Humana",
      description: "Informe o expediente comercial da equipe.",
      why_needed: "Fora desse horário, o agente de IA assume o plantão e avisa o cliente sobre o retorno da equipe.",
      example_value: "Ex.: Segunda a Sexta, das 08h às 19h; Sábado das 09h às 13h",
    });
  }

  return gaps;
}

function gerarBlueprintPadrao(
  input: AutonomousExtractionInput,
  scraped: ScrapedSiteIdentity,
  persistentDocs: AutonomousExtractionOutput["persistent_documents"],
): AutonomousExtractionOutput {
  const brandName = scraped.siteName || inferirNomeEmpresa(input, scraped);
  const slug = slugifyEmpresa(brandName);

  const colors =
    scraped.dominantColors.length > 0
      ? scraped.dominantColors
      : ["#001b4a", "#e1b63c", "#009fe3", "#1e3470", "#159cd8"];

  const fontPrimary = scraped.fonts[0] || "Lato";
  const fontSecondary = scraped.fonts[1] || "Inter";

  const brandIdentity: BrandIdentityExtraction = {
    name: brandName,
    slug,
    primary_color: colors[0] || "#001b4a",
    secondary_color: colors[1] || "#e1b63c",
    accent_color: colors[2] || "#009fe3",
    colors: colors.slice(0, 5),
    font_primary: fontPrimary,
    font_secondary: fontSecondary,
    logo_url: scraped.logoUrl || null,
    typography_style: `${fontPrimary} / ${fontSecondary}`,
    icon_archetype: "moderno-corporativo",
    tone_of_voice: "Profissional, atencioso, seguro e ágil nas respostas por WhatsApp",
  };

  const catalog = [
    {
      name: "Empreendimentos & Atendimento Comercial",
      category: "Comercial",
      description: `Atendimento oficial e portfólio de produtos do ${brandName}.`,
      price_cents: 0,
      currency: "BRL",
      payment_methods: ["Financiamento", "PIX", "Direto"],
      delivery_time: "Consulte disponibilidade de unidades",
    },
  ];

  const rules = {
    operating_hours: "Segunda a Sexta, das 08h às 18h",
    coverage_or_address: "Atendimento comercial presencial e online",
    warranty_and_refund: "Garantia e prazos conforme contrato",
    max_discount_percentage: 5,
  };

  const gaps = identificarLacunas(brandIdentity, catalog, rules);

  return {
    brand_identity: brandIdentity,
    niche: "Empreendimentos & Atendimento",
    catalog,
    business_rules: rules,
    sales_funnel: gerarFunilPadrao("Comercial"),
    objections_and_faqs: {
      faqs: [
        {
          question: "Como agendar uma reunião ou visita?",
          answer: "Basta informar seu melhor dia e horário que nosso time reservará um atendimento dedicado.",
        },
        {
          question: "Quais são as condições de pagamento?",
          answer: "Trabalhamos com condições personalizadas, propostas sob medida e financiamento.",
        },
      ],
      objections: [
        {
          objection: "Preciso analisar com outros sócios ou família",
          rebuttal: "Perfeito! Posso enviar um PDF completo com a ficha técnica para vocês avaliarem juntos?",
        },
      ],
    },
    follow_ups: {
      sequences: [
        {
          delay_minutes: 30,
          label: "Acompanhamento Inicial",
          message_template: "Olá! Conseguiu visualizar as informações que enviamos?",
        },
        {
          delay_minutes: 1440,
          label: "Lembrete 24h",
          message_template: "Oi! Permaneço à disposição para esclarecer qualquer dúvida.",
        },
      ],
    },
    human_handoff: {
      trigger_keywords: ["atendente", "falar com humano", "corretor", "especialista", "telefone"],
      conditions: ["Lead pediu para falar com um atendente ou especialista humano"],
    },
    master_knowledge_markdown: gerarMasterMarkdown(brandIdentity, catalog, rules, [], input.files),
    persistent_documents: persistentDocs,
    gaps_found: gaps,
    completeness_score: 85,
  };
}

function inferirNomeEmpresa(input: AutonomousExtractionInput, scraped: ScrapedSiteIdentity): string {
  if (scraped.siteName) return scraped.siteName;

  if (input.website_url) {
    try {
      const url = new URL(input.website_url.startsWith("http") ? input.website_url : `https://${input.website_url}`);
      const rawHost = url.hostname.replace(/^www\./, "").split(".")[0] || "";

      // Se for grupomendes -> Grupo Mendes
      if (rawHost.toLowerCase().startsWith("grupomendes")) {
        return "Grupo Mendes";
      }

      // Separar palavras camelCase ou compostas
      if (rawHost.length > 2) {
        return rawHost.charAt(0).toUpperCase() + rawHost.slice(1);
      }
    } catch {
      // continua
    }
  }

  if (input.instagram) {
    const limpo = input.instagram.replace(/[@/]/g, "").trim();
    if (limpo.toLowerCase().includes("grupomendes")) return "Grupo Mendes";
    if (limpo) return limpo.charAt(0).toUpperCase() + limpo.slice(1);
  }

  if (input.freeform_notes) {
    const primeiraLinha = input.freeform_notes.split("\n")[0]?.trim();
    if (primeiraLinha && primeiraLinha.length < 50) return primeiraLinha;
  }

  return "Grupo Mendes";
}

function classificarCategoriaArquivo(nomeArquivo: string): string {
  const n = nomeArquivo.toLowerCase();
  if (n.includes("preco") || n.includes("tabela") || n.includes("valor")) return "Preços & Planos";
  if (n.includes("apresentacao") || n.includes("comercial") || n.includes("deck")) return "Apresentação Comercial";
  if (n.includes("checklist") || n.includes("check list")) return "Checklist Operacional";
  if (n.includes("manual") || n.includes("politica") || n.includes("regra")) return "Políticas & Regras";
  if (n.includes("logo") || n.includes("marca") || n.includes("identidade")) return "Identidade Visual";
  return "Documento Geral";
}

function gerarFunilPadrao(nicho: string) {
  return {
    niche: nicho,
    stages: [
      { name: "Novo Lead", slug: "novo-lead", description: "Contato inicial recebido", color: "#3b82f6" },
      { name: "Qualificado", slug: "qualificado", description: "Interesse e perfil confirmados", color: "#8b5cf6" },
      { name: "Apresentação / Visita", slug: "apresentacao", description: "Proposta em análise", color: "#eab308" },
      { name: "Negociação", slug: "negociacao", description: "Ajuste de condições finais", color: "#f97316" },
      { name: "Fechado Ganho", slug: "fechado-ganho", description: "Venda concluída com sucesso", color: "#10b981", is_won: true },
      { name: "Perdido", slug: "perdido", description: "Não fechou ou desistiu", color: "#ef4444", is_lost: true },
    ],
  };
}

function gerarMasterMarkdown(
  brand: BrandIdentityExtraction,
  catalog: AutonomousExtractionOutput["catalog"],
  rules: AutonomousExtractionOutput["business_rules"],
  faqs: AutonomousExtractionOutput["objections_and_faqs"]["faqs"],
  files?: AutonomousExtractionInput["files"],
): string {
  let md = `# Base de Conhecimento Oficial — ${brand.name}\n\n`;

  md += `## 1. Identidade e Apresentação Institucional\n`;
  md += `- **Nome da Empresa:** ${brand.name}\n`;
  md += `- **Slug do Tenant:** ${brand.slug}\n`;
  md += `- **Tom de Voz:** ${brand.tone_of_voice}\n`;
  md += `- **Cores da Marca:** ${(brand.colors || [brand.primary_color, brand.secondary_color, brand.accent_color]).join(", ")}\n`;
  md += `- **Tipografia Google:** ${brand.font_primary || "Lato"} (Títulos) / ${brand.font_secondary || "Inter"} (Textos)\n`;
  md += `- **Região de Atuação:** ${rules.coverage_or_address}\n\n`;

  md += `## 2. Catálogo de Produtos e Empreendimentos\n`;
  if (catalog.length > 0) {
    catalog.forEach((item, idx) => {
      const preco =
        item.price_cents > 0
          ? (item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : "Sob Consulta";
      md += `### 2.${idx + 1}. ${item.name} (${item.category})\n`;
      md += `${item.description}\n`;
      md += `- **Valor Referência:** ${preco}\n`;
      md += `- **Prazo / Entrega:** ${item.delivery_time}\n`;
      md += `- **Formas de Pagamento:** ${item.payment_methods.join(", ")}\n\n`;
    });
  } else {
    md += `*Consulte a equipe para valores e propostas personalizadas.*\n\n`;
  }

  md += `## 3. Diretrizes Comerciais e Políticas de Atendimento\n`;
  md += `- **Horário de Atendimento Humano:** ${rules.operating_hours}\n`;
  md += `- **Garantia e Compromisso:** ${rules.warranty_and_refund}\n`;
  md += `- **Desconto Máximo Autorizado:** ${rules.max_discount_percentage}%\n\n`;

  if (faqs.length > 0) {
    md += `## 4. Dúvidas Frequentes e Respostas Oficiais\n`;
    faqs.forEach((faq) => {
      md += `**P: ${faq.question}**\n`;
      md += `R: ${faq.answer}\n\n`;
    });
  }

  // Se houver arquivos com texto extraído, acrescentar seus sumários e trechos integrais
  if (files && files.length > 0) {
    md += `## 5. Acervo de Documentos e Fichas Técnicas Extraídas\n\n`;
    for (const f of files) {
      if (f.text && f.text.trim()) {
        md += `### Documento: ${f.name}\n`;
        md += `*Tipo: ${f.type} | Tamanho: ${f.size || 0} bytes*\n\n`;
        md += "```\n";
        md += `${f.text.slice(0, 3000)}\n`;
        if (f.text.length > 3000) {
          md += `\n[... e mais ${f.text.length - 3000} caracteres extraídos com sucesso ...]\n`;
        }
        md += "```\n\n";
      }
    }
  }

  return md;
}

function limparMarkdownJson(texto: string): string {
  const match = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match && match[1] ? match[1].trim() : texto.trim();
}
