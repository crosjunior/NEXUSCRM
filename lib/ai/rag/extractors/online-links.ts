/**
 * Helper and extractor for Google Drive and OneDrive online file links.
 *
 * Supports:
 * - Google Docs (exports to text)
 * - Google Sheets (exports to CSV)
 * - Google Drive files (PDF, DOCX, XLSX, TXT, MD, CSV) via direct download endpoint
 * - OneDrive / SharePoint shareable links (public links)
 */

export interface OnlineLinkInfo {
  url: string;
  provider: "gdrive" | "onedrive" | "web" | "outro";
  directUrl: string;
  name?: string;
  ext?: string;
}

export interface OnlineLinkValidationResult {
  ok: boolean;
  url: string;
  provider?: "gdrive" | "onedrive" | "web" | "outro";
  name?: string;
  ext?: string;
  sizeBytes?: number;
  error?: string;
}

/** Detecta se o link é do Google Drive, OneDrive ou Página da Web/Artigo. */
export function detectProvider(url: string): "gdrive" | "onedrive" | "web" {
  const u = url.toLowerCase();
  if (u.includes("drive.google.com") || u.includes("docs.google.com")) {
    return "gdrive";
  }
  if (u.includes("1drv.ms") || u.includes("onedrive.live.com") || u.includes("sharepoint.com")) {
    return "onedrive";
  }
  return "web";
}

/**
 * Converte HTML de websites, artigos e blogs em texto Markdown legível.
 */
export function extrairTextoDeHtml(html: string): { titulo: string; texto: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titulo = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "Página da Web";

  let limpo = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const articleMatch =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(limpo) ||
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(limpo);

  if (articleMatch?.[1] && articleMatch[1].length > 300) {
    limpo = articleMatch[1];
  } else {
    limpo = limpo
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ");
  }

  limpo = limpo
    .replace(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/gi, "\n\n# $1\n")
    .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, "\n\n## $1\n")
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));

  const linhas = limpo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return {
    titulo,
    texto: linhas.join("\n\n").trim(),
  };
}

/**
 * Converte URLs de visualização do Google Drive/Docs/Sheets para URLs de download direto ou export.
 */
export function resolveDirectUrl(rawUrl: string): { directUrl: string; ext?: string; defaultName?: string } {
  const url = rawUrl.trim();

  // 1. Google Docs: https://docs.google.com/document/d/{ID}/...
  const docMatch = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (docMatch?.[1]) {
    const id = docMatch[1];
    return {
      directUrl: `https://docs.google.com/document/d/${id}/export?format=txt`,
      ext: "txt",
      defaultName: "Google Doc",
    };
  }

  // 2. Google Sheets: https://docs.google.com/spreadsheets/d/{ID}/...
  const sheetMatch = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (sheetMatch?.[1]) {
    const id = sheetMatch[1];
    return {
      directUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
      ext: "csv",
      defaultName: "Google Planilha",
    };
  }

  // 3. Google Drive File: https://drive.google.com/file/d/{ID}/view... or /open?id={ID}
  const fileMatch =
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url) ||
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/.exec(url) ||
    /drive\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/.exec(url);
  if (fileMatch?.[1]) {
    const id = fileMatch[1];
    return {
      directUrl: `https://drive.google.com/uc?export=download&id=${id}`,
      defaultName: "Arquivo Google Drive",
    };
  }

  // 4. OneDrive / SharePoint
  if (url.includes("1drv.ms") || url.includes("sharepoint.com") || url.includes("onedrive.live.com")) {
    if (!url.includes("download=1") && !url.includes("download=true")) {
      const sep = url.includes("?") ? "&" : "?";
      return {
        directUrl: `${url}${sep}download=1`,
        defaultName: "Arquivo OneDrive",
      };
    }
    return {
      directUrl: url,
      defaultName: "Arquivo OneDrive",
    };
  }

  return { directUrl: url };
}

/**
 * Testa o acesso de leitura a um link online.
 * Verifica se o arquivo está acessível publicamente ou se requer autenticação/permissão.
 */
export async function testOnlineLinkAccess(rawUrl: string): Promise<OnlineLinkValidationResult> {
  const url = rawUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      ok: false,
      url,
      error: "O endereço precisa iniciar com https:// ou http://",
    };
  }

  const provider = detectProvider(url);
  const { directUrl, ext: defaultExt, defaultName } = resolveDirectUrl(url);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(directUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return {
          ok: false,
          url,
          provider,
          error: "Arquivo não disponível para leitura pública. Libere o acesso de compartilhamento ('Qualquer pessoa com o link').",
        };
      }
      return {
        ok: false,
        url,
        provider,
        error: `O servidor retornou status de erro ${res.status}.`,
      };
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const contentLength = Number(res.headers.get("content-length") ?? "0");

    // Extrai nome do arquivo do Content-Disposition se disponível
    let filename = defaultName ?? "Arquivo Online";
    const filenameMatch = /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i.exec(contentDisposition);
    if (filenameMatch?.[1]) {
      try {
        filename = decodeURIComponent(filenameMatch[1].replace(/["']/g, "").trim());
      } catch {
        filename = filenameMatch[1].replace(/["']/g, "").trim();
      }
    }

    // Links da Web (sites, blogs, artigos)
    if (provider === "web" && contentType.includes("text/html")) {
      const sampleText = await res.text();
      const { titulo, texto } = extrairTextoDeHtml(sampleText);
      if (texto.length < 20) {
        return {
          ok: false,
          url,
          provider,
          error: "A página web não contém texto legível ou bloqueia leitura automatizada.",
        };
      }
      return {
        ok: true,
        url,
        provider,
        name: titulo || "Página da Web",
        ext: "html",
        sizeBytes: texto.length,
      };
    }

    // Google Drive retorna HTML quando o acesso é restrito ou exige login
    if (provider === "gdrive" && contentType.includes("text/html")) {
      // Baixa uma amostra para checar se é página de login / permissão
      const sampleText = (await res.text()).slice(0, 4000);
      if (
        sampleText.includes("accounts.google.com") ||
        sampleText.includes("ServiceLogin") ||
        sampleText.includes("Acesso negado") ||
        sampleText.includes("Access Denied") ||
        sampleText.includes("Você precisa de permissão") ||
        sampleText.includes("You need permission") ||
        sampleText.includes("request-access")
      ) {
        return {
          ok: false,
          url,
          provider,
          error: "Arquivo privado no Google Drive. Libere o acesso para 'Qualquer pessoa com o link' poder ler.",
        };
      }
    }

    // OneDrive / SharePoint retorna HTML de login se privado
    if (provider === "onedrive" && contentType.includes("text/html")) {
      const sampleText = (await res.text()).slice(0, 4000);
      if (
        sampleText.includes("login.microsoftonline.com") ||
        sampleText.includes("login.live.com") ||
        sampleText.includes("Entrar na sua conta") ||
        sampleText.includes("Sign in to your account") ||
        sampleText.includes("Access denied")
      ) {
        return {
          ok: false,
          url,
          provider,
          error: "Arquivo privado no OneDrive. Libere o link para acesso público de leitura.",
        };
      }
    }

    // Determina extensão
    let detectedExt = defaultExt;
    if (!detectedExt) {
      const matchExt = /\.([a-zA-Z0-9]+)$/.exec(filename);
      if (matchExt?.[1]) {
        detectedExt = matchExt[1].toLowerCase();
      } else if (contentType.includes("pdf")) {
        detectedExt = "pdf";
      } else if (contentType.includes("spreadsheet") || contentType.includes("excel")) {
        detectedExt = "xlsx";
      } else if (contentType.includes("word") || contentType.includes("document")) {
        detectedExt = "docx";
      } else if (contentType.includes("csv")) {
        detectedExt = "csv";
      } else if (contentType.includes("markdown")) {
        detectedExt = "md";
      } else if (contentType.includes("text/plain")) {
        detectedExt = "txt";
      }
    }

    return {
      ok: true,
      url,
      provider,
      name: filename,
      ext: detectedExt ?? "txt",
      sizeBytes: contentLength > 0 ? contentLength : undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return {
        ok: false,
        url,
        provider,
        error: "Tempo limite esgotado ao tentar acessar o link. Verifique a URL.",
      };
    }
    return {
      ok: false,
      url,
      provider,
      error: "Não foi possível conectar ao arquivo online. Verifique a permissão do link.",
    };
  }
}

/** Baixa o conteúdo do link online para Buffer durante a indexação. */
export async function downloadOnlineContent(
  url: string,
): Promise<{ buffer: Buffer; name: string; ext: string }> {
  const { directUrl, ext: defaultExt, defaultName } = resolveDirectUrl(url);

  const res = await fetch(directUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar conteúdo online (status ${res.status}): ${url}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const contentDisposition = res.headers.get("content-disposition") ?? "";
  let name = defaultName ?? "Arquivo Online";

  const fnMatch = /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i.exec(contentDisposition);
  if (fnMatch?.[1]) {
    try {
      name = decodeURIComponent(fnMatch[1].replace(/["']/g, "").trim());
    } catch {
      name = fnMatch[1].replace(/["']/g, "").trim();
    }
  }

  let ext = defaultExt;
  if (!ext) {
    const matchExt = /\.([a-zA-Z0-9]+)$/.exec(name);
    if (matchExt?.[1]) ext = matchExt[1].toLowerCase();
    else if (contentType.includes("pdf")) ext = "pdf";
    else if (contentType.includes("spreadsheet") || contentType.includes("excel")) ext = "xlsx";
    else if (contentType.includes("presentation") || contentType.includes("powerpoint")) ext = "pptx";
    else if (contentType.includes("word") || contentType.includes("document")) ext = "docx";
    else if (contentType.includes("csv")) ext = "csv";
    else if (contentType.includes("markdown")) ext = "md";
    else if (contentType.includes("text/html")) ext = "html";
    else ext = "txt";
  }

  if (contentType.includes("text/html") || ext === "html") {
    const html = await res.text();
    const { titulo, texto } = extrairTextoDeHtml(html);
    return {
      buffer: Buffer.from(texto, "utf-8"),
      name: titulo || name,
      ext: "md",
    };
  }

  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), name, ext: ext ?? "txt" };
}
