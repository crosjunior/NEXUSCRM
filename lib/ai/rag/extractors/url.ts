/**
 * EXTRATOR DE CONTEÚDO WEB PARA RAG (URLs e Links da Web)
 *
 * Converte páginas HTML em Markdown limpo para indexação de base de conhecimento,
 * com proteção estrita contra SSRF (Server-Side Request Forgery) e scraping seguro.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { JSDOM } from "jsdom";

export class UrlExtractError extends Error {
  readonly code: string;
  constructor(message: string, code = "url_extract_failed") {
    super(message);
    this.name = "UrlExtractError";
    this.code = code;
  }
}

/** Verifica se um IP (v4 ou v6) é privado, local ou de metadata de cloud */
export function isPrivateOrReservedIP(ip: string): boolean {
  // IPv4
  if (ip.startsWith("127.")) return true; // loopback
  if (ip.startsWith("10.")) return true; // classe A privada
  if (ip.startsWith("192.168.")) return true; // classe C privada
  if (ip.startsWith("169.254.")) return true; // link-local / cloud metadata (AWS, GCP, Azure)
  if (ip === "0.0.0.0") return true;

  // 172.16.0.0 - 172.31.255.255 (classe B privada)
  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172 && match172[1]) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  // IPv6
  if (ip === "::1" || ip === "::") return true;
  if (ip.toLowerCase().startsWith("fe80:")) return true; // link-local
  if (ip.toLowerCase().startsWith("fc00:") || ip.toLowerCase().startsWith("fd00:")) return true; // unique local

  return false;
}

/** Valida a URL contra SSRF e formatos não suportados */
export async function validarUrlSegura(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new UrlExtractError("URL inválida ou malformada.", "invalid_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlExtractError("Apenas protocolos HTTP e HTTPS são permitidos.", "unsupported_protocol");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UrlExtractError("Acesso a endereços locais não é permitido.", "ssrf_blocked");
  }

  // Se o hostname já é um IP direto
  if (isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new UrlExtractError("Acesso a endereços de rede privada não é permitido.", "ssrf_blocked");
    }
  } else {
    // Resolver DNS para checar se o IP de destino é privado
    try {
      const { address } = await lookup(hostname);
      if (isPrivateOrReservedIP(address)) {
        throw new UrlExtractError("O domínio resolve para um endereço privado proibido.", "ssrf_blocked");
      }
    } catch (err: unknown) {
      if (err instanceof UrlExtractError) throw err;
      throw new UrlExtractError("Não foi possível resolver o domínio da URL.", "dns_lookup_failed");
    }
  }

  return parsed;
}

/**
 * Converte nós DOM selecionados em Markdown estruturado.
 */
function domNodeToMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    // TEXT_NODE
    return node.textContent || "";
  }

  if (node.nodeType !== 1) {
    // Não é ELEMENT_NODE
    return "";
  }

  const el = node as HTMLElement;
  const tagName = el.tagName.toLowerCase();

  // Tags a ignorar completamente
  if (
    [
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "nav",
      "footer",
      "header",
      "button",
      "form",
      "input",
      "select",
      "option",
    ].includes(tagName)
  ) {
    return "";
  }

  const childText = Array.from(el.childNodes)
    .map((child) => domNodeToMarkdown(child))
    .join("");

  const trimmedChildren = childText.trim();
  if (!trimmedChildren && !["br", "hr"].includes(tagName)) return "";

  switch (tagName) {
    case "h1":
      return `\n\n# ${trimmedChildren}\n\n`;
    case "h2":
      return `\n\n## ${trimmedChildren}\n\n`;
    case "h3":
      return `\n\n### ${trimmedChildren}\n\n`;
    case "h4":
    case "h5":
    case "h6":
      return `\n\n#### ${trimmedChildren}\n\n`;
    case "p":
      return `\n\n${trimmedChildren}\n\n`;
    case "li":
      return `\n- ${trimmedChildren}`;
    case "ul":
    case "ol":
      return `\n${childText}\n`;
    case "blockquote":
      return `\n\n> ${trimmedChildren.replace(/\n/g, "\n> ")}\n\n`;
    case "pre":
    case "code":
      return `\n\`\`\`\n${el.textContent || ""}\n\`\`\`\n`;
    case "strong":
    case "b":
      return ` **${trimmedChildren}** `;
    case "em":
    case "i":
      return ` *${trimmedChildren}* `;
    case "a": {
      const href = el.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        return ` [${trimmedChildren}](${href}) `;
      }
      return trimmedChildren;
    }
    case "br":
      return "\n";
    case "hr":
      return "\n---\n";
    default:
      return childText;
  }
}

/**
 * Busca e extrai o conteúdo em Markdown de uma página web.
 */
export async function extractUrlContent(
  rawUrl: string,
  timeoutMs = 12000,
): Promise<{ titulo: string; markdown: string; url: string }> {
  const urlObj = await validarUrlSegura(rawUrl);
  const url = urlObj.toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; NexusBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new UrlExtractError("Tempo limite excedido ao acessar a página (timeout).", "timeout");
    }
    throw new UrlExtractError(`Falha ao conectar com o site: ${err instanceof Error ? err.message : String(err)}`, "fetch_failed");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new UrlExtractError(
      `O site respondeu com código de erro ${response.status} (${response.statusText}).`,
      "http_error",
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new UrlExtractError(
      "O endereço não retornou uma página web ou texto (formato não suportado).",
      "invalid_content_type",
    );
  }

  const html = await response.text();
  if (!html || html.trim().length === 0) {
    throw new UrlExtractError("A página acessada está vazia.", "empty_page");
  }

  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const rawTitle = doc.querySelector("title")?.textContent?.trim() || "";
  const h1Title = doc.querySelector("h1")?.textContent?.trim() || "";
  const titulo = rawTitle || h1Title || urlObj.hostname;

  // Seleciona o conteúdo principal preferencialmente
  const mainTarget =
    doc.querySelector("main") ||
    doc.querySelector("article") ||
    doc.querySelector("#content") ||
    doc.querySelector(".content") ||
    doc.body;

  let rawMarkdown = mainTarget ? domNodeToMarkdown(mainTarget) : "";

  // Limpeza de quebras e espaços repetidos
  rawMarkdown = rawMarkdown
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (rawMarkdown.length < 50) {
    throw new UrlExtractError(
      "Não foi possível extrair texto legível desta página (pouco ou nenhum conteúdo textual encontrado).",
      "insufficient_content",
    );
  }

  const header = `# ${titulo}\n\nFonte original: ${url}\n\n---\n\n`;
  const markdownCompleto = header + rawMarkdown;

  return {
    titulo,
    markdown: markdownCompleto,
    url,
  };
}

