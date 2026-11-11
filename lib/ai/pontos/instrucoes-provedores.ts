/**
 * Instruções passo a passo para obtenção e configuração de API Keys dos principais provedores de IA.
 * 
 * Cobre os modelos e provedores mais populares:
 * - Gemini (Google)
 * - GPT (OpenAI)
 * - Claude (Anthropic)
 * - Llama (Meta via OpenRouter / Groq)
 * - Copilot / ChatGPT (Assinatura)
 * - Grok (xAI via OpenRouter ou Direto)
 * - DeepSeek
 */

export interface GuiaProvedor {
  id: string;
  titulo: string;
  site: string;
  rotuloSite: string;
  prefixoChave: string;
  modelosDestaque: string[];
  passos: string[];
  dica?: string;
}

export const GUIAS_PROVEDORES: Record<string, GuiaProvedor> = {
  google: {
    id: "google",
    titulo: "Google Gemini",
    site: "https://aistudio.google.com/apikey",
    rotuloSite: "Google AI Studio",
    prefixoChave: "AIza…",
    modelosDestaque: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    passos: [
      "Acesse o Google AI Studio (aistudio.google.com/apikey) e entre com sua conta Google.",
      "Clique no botão 'Create API Key' (Criar chave de API).",
      "Selecione um projeto existente do Google Cloud ou crie um novo com 1 clique.",
      "Copie a chave gerada (iniciada por 'AIza...') e cole no campo de chave abaixo.",
    ],
    dica: "O Gemini oferece excelente velocidade, contexto gigante e plano gratuito generoso para testes e produção.",
  },
  openai: {
    id: "openai",
    titulo: "OpenAI (GPT)",
    site: "https://platform.openai.com/api-keys",
    rotuloSite: "OpenAI Platform",
    prefixoChave: "sk-…",
    modelosDestaque: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o1", "o3-mini"],
    passos: [
      "Acesse a plataforma da OpenAI (platform.openai.com/api-keys) e faça login.",
      "No menu lateral, selecione 'API Keys'.",
      "Clique em '+ Create new secret key', dê um nome descritivo (ex.: 'Nexus CRM') e confirme.",
      "Copie a chave imediatamente (iniciada por 'sk-...') e cole no campo abaixo (ela não será mostrada novamente).",
    ],
    dica: "Certifique-se de adicionar créditos pré-pagos em 'Settings › Billing' na OpenAI para que a API responda.",
  },
  anthropic: {
    id: "anthropic",
    titulo: "Anthropic (Claude)",
    site: "https://console.anthropic.com/settings/keys",
    rotuloSite: "Anthropic Console",
    prefixoChave: "sk-ant-…",
    modelosDestaque: ["claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus"],
    passos: [
      "Acesse o Anthropic Console (console.anthropic.com/settings/keys) e faça login.",
      "Vá na seção 'API Keys' nas configurações.",
      "Clique no botão 'Create Key', dê um nome (ex.: 'CRM Vendas') e gere a chave.",
      "Copie o token gerado (iniciado por 'sk-ant-...') e cole no campo de credencial.",
    ],
    dica: "O Claude é a referência em interpretação de instruções complexas e execução de ferramentas de CRM.",
  },
  openrouter: {
    id: "openrouter",
    titulo: "Llama & OpenRouter (Meta, Grok, Mistral)",
    site: "https://openrouter.ai/keys",
    rotuloSite: "OpenRouter Console",
    prefixoChave: "sk-or-v1-…",
    modelosDestaque: ["meta-llama/llama-3.3-70b-instruct", "meta-llama/llama-3.1-8b-instruct:free", "x-ai/grok-2", "mistralai/mistral-large"],
    passos: [
      "Acesse a OpenRouter (openrouter.ai/keys) e faça login com Google ou GitHub.",
      "Clique em 'Create Key' e digite um nome para a credencial.",
      "Copie a chave criada (iniciada por 'sk-or-v1-...') e salve no CRM.",
      "Com esta única chave, você pode alternar entre modelos Llama (inclusive versões gratuitas ':free'), Grok e centenas de outros.",
    ],
    dica: "A OpenRouter é o caminho ideal para usar modelos Llama e Grok sem precisar hospedar infraestrutura própria.",
  },
  "openai-assinatura": {
    id: "openai-assinatura",
    titulo: "Copilot / ChatGPT (Assinatura)",
    site: "https://chatgpt.com/",
    rotuloSite: "ChatGPT / Copilot",
    prefixoChave: "Login OAuth (sem chave manual)",
    modelosDestaque: ["gpt-4o", "gpt-4o-mini", "o1"],
    passos: [
      "No seletor de provedor, escolha 'OpenAI pela assinatura (ChatGPT)'.",
      "Não é necessário colar texto de chave de API manual.",
      "Clique no botão oficial de conexão para autenticar via login seguro da OpenAI (Sign in with ChatGPT).",
      "Os tokens serão gerenciados automaticamente com a sua assinatura Plus ou Team.",
    ],
    dica: "Permite aproveitar assinaturas existentes do ChatGPT Plus ou planos corporativos sem cobrança por token de API.",
  },
  deepseek: {
    id: "deepseek",
    titulo: "DeepSeek",
    site: "https://platform.deepseek.com/api_keys",
    rotuloSite: "DeepSeek Platform",
    prefixoChave: "sk-…",
    modelosDestaque: ["deepseek-chat", "deepseek-reasoner (R1)", "deepseek-v3"],
    passos: [
      "Acesse a plataforma da DeepSeek (platform.deepseek.com/api_keys) e faça login.",
      "Vá na aba 'API Keys' no painel principal.",
      "Clique em 'Create API Key', copie o valor gerado e cole no campo de chave.",
    ],
    dica: "Excelente opção ultrabarata com desconto automático para cache de contexto de atendimento.",
  },
  custom: {
    id: "custom",
    titulo: "Provedor Personalizado (Grok xAI, Groq, Local)",
    site: "https://console.groq.com/keys",
    rotuloSite: "Console do seu Provedor (ex.: Groq ou xAI)",
    prefixoChave: "gsk_… / xai-… / sk-…",
    modelosDestaque: ["llama-3.3-70b-versatile (Groq)", "grok-2 (xAI)", "vLLM / Ollama"],
    passos: [
      "Para Groq: Acesse console.groq.com/keys, crie uma chave e use a Base URL 'https://api.groq.com/openai/v1'.",
      "Para xAI (Grok): Acesse console.x.ai, crie uma chave e use a Base URL 'https://api.x.ai/v1'.",
      "Cole a Base URL no campo 'Endereço (base URL)' e a chave gerada no campo 'Chave'.",
    ],
    dica: "Compatível com qualquer servidor ou API que siga o padrão OpenAI /v1/chat/completions.",
  },
};

/**
 * Retorna o guia de passo a passo correspondente ao provedor ou modelo selecionado.
 */
export function obterGuiaDoProvedor(identificador: string): GuiaProvedor {
  const normalizado = identificador.toLowerCase();

  if (normalizado.includes("gemini") || normalizado === "google") {
    return GUIAS_PROVEDORES.google!;
  }
  if (normalizado.includes("claude") || normalizado === "anthropic") {
    return GUIAS_PROVEDORES.anthropic!;
  }
  if (normalizado.includes("llama") || normalizado === "openrouter") {
    return GUIAS_PROVEDORES.openrouter!;
  }
  if (normalizado.includes("grok") || normalizado.includes("x-ai")) {
    return GUIAS_PROVEDORES.openrouter!; // Grok é atendido via OpenRouter ou Custom
  }
  if (normalizado === "openai-assinatura" || normalizado.includes("copilot") || normalizado.includes("chatgpt")) {
    return GUIAS_PROVEDORES["openai-assinatura"]!;
  }
  if (normalizado.includes("deepseek")) {
    return GUIAS_PROVEDORES.deepseek!;
  }
  if (normalizado.includes("gpt") || normalizado === "openai") {
    return GUIAS_PROVEDORES.openai!;
  }

  return GUIAS_PROVEDORES[identificador] ?? GUIAS_PROVEDORES.custom!;
}

