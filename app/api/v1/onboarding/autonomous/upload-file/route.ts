import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok, fail } from "@/lib/api/wrappers";
import { extractPdfText } from "@/lib/ai/rag/extractors/pdf";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // Autorização canônica: apenas admin da organização
  const authz = await requireRole("admin", { requestId, resource: "onboarding.autonomous" });
  if (!authz.ok) return authz.response;

  const supportBlock = await requireSupportWrite(authz.org.orgId);
  if (supportBlock) return supportBlock;

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return fail("missing_file", "Nenhum arquivo enviado no formulário.", 400, { requestId });
    }

    const uploadedFile = file as File;
    const name = uploadedFile.name;
    const type = uploadedFile.type || "application/octet-stream";
    const size = uploadedFile.size;

    let text: string | undefined;
    let base64_data: string | undefined;

    const arrayBuffer = await uploadedFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      try {
        const extracted = await extractPdfText(buffer);
        text = extracted.trim() || undefined;
      } catch {
        // Fallback defensivo: se for PDF escaneado ou protegido
        text = `[Documento PDF: ${name} (${Math.round(size / 1024)} KB) - Conteúdo em imagem escaneada]`;
      }
    } else if (
      type.startsWith("text/") ||
      name.toLowerCase().endsWith(".md") ||
      name.toLowerCase().endsWith(".csv") ||
      name.toLowerCase().endsWith(".txt")
    ) {
      text = buffer.toString("utf-8");
    } else if (type.startsWith("image/")) {
      // Para imagens, mantemos o base64 para o Gemini identificar logo e identidade visual
      base64_data = `data:${type};base64,${buffer.toString("base64")}`;
    }

    return ok(
      {
        name,
        type,
        size,
        text,
        base64_data,
        extracted_length: text ? text.length : 0,
      },
      { requestId },
    );
  } catch (err) {
    return fail(
      "upload_error",
      err instanceof Error ? err.message : "Falha ao processar arquivo.",
      500,
      { requestId },
    );
  }
}
