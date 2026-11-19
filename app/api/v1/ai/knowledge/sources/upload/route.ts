import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/knowledge/sources/upload
 *
 * Envio e gestão de arquivos (PDF, Word DOCX, Excel XLSX, Markdown, CSV ou texto)
 * e links online (Google Drive, OneDrive) para o acervo da organização.
 *
 * Suporta até 30 arquivos por base de conhecimento e até 500 MB de tamanho total cumulativo.
 * Permite tanto criação de novo material quanto edição de base existente (passando source_id).
 *
 * Auth: sessão por cookie, papel >= manager.
 * `organization_id` sai do JWT — NUNCA do corpo.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  BUCKET_DE_CONHECIMENTO,
  ErroDeExtracao,
  extrairTextoDoArquivo,
  resolverExtensao,
} from "@/lib/ai/rag/ingest/documento";

export const dynamic = "force-dynamic";

export const TAMANHO_MAXIMO_TOTAL = 500 * 1024 * 1024; // 500 MB
export const LIMITE_MAXIMO_ARQUIVOS = 30;

const nameSchema = z.string().trim().min(2).max(120);
const agentIdSchema = z.string().uuid();
const sourceIdSchema = z.string().uuid();

const MIME_POR_EXTENSAO = {
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

interface ItemArquivo {
  id: string;
  name: string;
  source_type: "upload" | "gdrive" | "onedrive";
  blob_path?: string;
  ext?: string;
  size_bytes?: number;
  mime_type?: string;
  url?: string;
  direct_url?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("invalid_request", t("Falha ao processar o envio do formulário."), 400, { requestId });
  }

  const nameRaw = formData.get("name");
  const agentIdRaw = formData.get("agent_id");
  const sourceIdRaw = formData.get("source_id");
  const linksRaw = formData.get("links");
  const existingFilesRaw = formData.get("existing_files");

  // Arquivos enviados
  const uploadedFiles: File[] = [];
  for (const entry of formData.getAll("files")) {
    if (entry instanceof File && entry.size > 0) uploadedFiles.push(entry);
  }
  for (const entry of formData.getAll("file")) {
    if (entry instanceof File && entry.size > 0 && !uploadedFiles.includes(entry)) {
      uploadedFiles.push(entry);
    }
  }

  // Links online parseados
  let linksArray: Array<{
    url: string;
    name?: string;
    ext?: string;
    sizeBytes?: number;
    provider?: "gdrive" | "onedrive" | "outro";
    directUrl?: string;
  }> = [];
  if (linksRaw && typeof linksRaw === "string") {
    try {
      linksArray = JSON.parse(linksRaw);
    } catch {
      return fail("validation_failed", t("Formato inválido para links online."), 422, { requestId });
    }
  }

  // Arquivos já existentes (ao editar)
  let existingFiles: ItemArquivo[] = [];
  if (existingFilesRaw && typeof existingFilesRaw === "string") {
    try {
      existingFiles = JSON.parse(existingFilesRaw);
    } catch {
      return fail("validation_failed", t("Formato inválido para lista de arquivos existentes."), 422, { requestId });
    }
  }

  const nameParsed = nameSchema.safeParse(nameRaw);
  if (!nameParsed.success) {
    return fail("validation_failed", t("Dê um nome ao material (2 a 120 caracteres)."), 422, {
      requestId,
    });
  }
  const name = nameParsed.data;

  let agentId: string | null = null;
  if (agentIdRaw !== null && String(agentIdRaw).length > 0) {
    const agentIdParsed = agentIdSchema.safeParse(agentIdRaw);
    if (!agentIdParsed.success) {
      return fail("validation_failed", t("Campo 'agent_id' deve ser UUID válido."), 422, { requestId });
    }
    const supabase = await createClient();
    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("id")
      .eq("id", agentIdParsed.data)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (agentErr || !agent) {
      return fail("not_found", t("Assistente não encontrado nesta organização."), 404, { requestId });
    }
    agentId = agentIdParsed.data;
  }

  let sourceId: string | null = null;
  if (sourceIdRaw !== null && String(sourceIdRaw).length > 0) {
    const sParsed = sourceIdSchema.safeParse(sourceIdRaw);
    if (!sParsed.success) {
      return fail("validation_failed", t("Campo 'source_id' inválido."), 422, { requestId });
    }
    sourceId = sParsed.data;
  }

  // Total de arquivos = novos uploads + links online + arquivos existentes mantidos
  const totalItens = uploadedFiles.length + linksArray.length + existingFiles.length;
  if (totalItens === 0) {
    return fail("invalid_request", t("Adicione ao menos um arquivo ou link válido."), 400, { requestId });
  }

  if (totalItens > LIMITE_MAXIMO_ARQUIVOS) {
    return fail(
      "validation_failed",
      t(`O limite é de até ${LIMITE_MAXIMO_ARQUIVOS} arquivos por base de conhecimento.`),
      422,
      { requestId },
    );
  }

  // Calcula tamanho total cumulativo
  let totalBytes = 0;
  for (const f of uploadedFiles) totalBytes += f.size;
  for (const f of existingFiles) totalBytes += f.size_bytes ?? 0;
  for (const l of linksArray) totalBytes += l.sizeBytes ?? 0;

  if (totalBytes > TAMANHO_MAXIMO_TOTAL) {
    return fail("payload_too_large", t("O tamanho total dos arquivos ultrapassa o limite de 500 MB."), 413, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const novosArquivosSalvos: ItemArquivo[] = [];
  const blobsCriadosParaLimpeza: string[] = [];

  try {
    for (const file of uploadedFiles) {
      const ext = resolverExtensao(file.name, file.type);
      if (!ext) {
        throw new ErroDeExtracao(
          "Não sei ler esse tipo de arquivo. Envie PDF, DOCX, XLSX, Markdown (.md), CSV (.csv) ou texto (.txt).",
          file.name,
        );
      }

      const blobId = randomUUID();
      const blobPath = `${activeOrg.orgId}/${blobId}.${ext}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const contentType = MIME_POR_EXTENSAO[ext] || "application/octet-stream";
      const { error: uploadErr } = await admin.storage
        .from(BUCKET_DE_CONHECIMENTO)
        .upload(blobPath, fileBuffer, { contentType, upsert: false });

      if (uploadErr) {
        console.error("[conhecimento-upload] upload storage falhou:", uploadErr.message);
        throw new Error(`Erro ao guardar o arquivo ${file.name}.`);
      }

      blobsCriadosParaLimpeza.push(blobPath);

      // Valida extração imediata
      try {
        await extrairTextoDoArquivo(blobPath, ext);
      } catch (extractErr) {
        if (extractErr instanceof ErroDeExtracao) {
          throw new ErroDeExtracao(
            `Erro ao ler ${file.name}: ${extractErr.message}`,
            extractErr.detalhe,
          );
        }
        throw new Error(`Falha ao ler o arquivo ${file.name}.`);
      }

      novosArquivosSalvos.push({
        id: randomUUID(),
        name: file.name,
        source_type: "upload",
        blob_path: blobPath,
        ext,
        size_bytes: file.size,
        mime_type: contentType,
      });
    }
  } catch (err) {
    // Se falhar algum arquivo, limpa os blobs enviados nesta requisição
    if (blobsCriadosParaLimpeza.length > 0) {
      await admin.storage.from(BUCKET_DE_CONHECIMENTO).remove(blobsCriadosParaLimpeza);
    }
    if (err instanceof ErroDeExtracao) {
      return fail("unprocessable_entity", t(err.message), 422, { requestId });
    }
    return fail("internal_error", err instanceof Error ? t(err.message) : "Erro ao ler o arquivo.", 500, {
      requestId,
    });
  }

  // Prepara itens de links online
  const itensLinks: ItemArquivo[] = linksArray.map((l) => ({
    id: randomUUID(),
    name: l.name ?? "Arquivo Online",
    source_type: l.provider === "onedrive" ? "onedrive" : "gdrive",
    ext: l.ext ?? "txt",
    size_bytes: l.sizeBytes,
    url: l.url,
    direct_url: l.directUrl,
  }));

  // Lista consolidada final de arquivos
  const todosArquivos: ItemArquivo[] = [...existingFiles, ...novosArquivosSalvos, ...itensLinks];
  const primeiroArquivo = todosArquivos[0];

  const metadataAtualizado = {
    files: todosArquivos,
    total_files: todosArquivos.length,
    total_size_bytes: totalBytes,
    // Compatibilidade reversa com leitores legados de arquivo único:
    filename: primeiroArquivo?.name ?? name,
    blob_path: primeiroArquivo?.blob_path,
    ext: primeiroArquivo?.ext,
    size_bytes: primeiroArquivo?.size_bytes,
    updated_at: new Date().toISOString(),
  };

  let finalSourceId = sourceId;

  if (sourceId) {
    // Modo Edição: atualiza base existente
    const { error: updErr } = await admin
      .from("ai_knowledge_sources")
      .update({
        name,
        source_metadata: metadataAtualizado,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    if (updErr) {
      console.error("[conhecimento-upload] update falhou:", updErr.message);
      return fail("internal_error", "Erro ao atualizar a base de conhecimento.", 500, { requestId });
    }

    void audit({
      action: "ai.knowledge_source_updated",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "ai_knowledge_source",
      resourceId: sourceId,
      requestId,
      metadata: { total_files: todosArquivos.length, total_size_bytes: totalBytes },
    });
  } else {
    // Modo Criação: insere nova base
    const { data: ks, error: ksErr } = await admin
      .from("ai_knowledge_sources")
      .insert({
        organization_id: activeOrg.orgId,
        agent_id: agentId,
        source_type: "documento",
        name,
        status: "ready",
        is_active: true,
        ingested_at: new Date().toISOString(),
        source_metadata: metadataAtualizado,
      })
      .select("id")
      .single();

    if (ksErr || !ks) {
      if (blobsCriadosParaLimpeza.length > 0) {
        await admin.storage.from(BUCKET_DE_CONHECIMENTO).remove(blobsCriadosParaLimpeza);
      }
      if (ksErr?.code === "23505") {
        return fail(
          "knowledge_source_name_in_use",
          `Já existe um material chamado "${name}". Escolha outro nome.`,
          409,
          { requestId },
        );
      }
      console.error("[conhecimento-upload] insert falhou:", ksErr?.message);
      return fail("internal_error", "Erro ao registrar o material.", 500, { requestId });
    }

    finalSourceId = (ks as { id: string }).id;

    void audit({
      action: "ai.knowledge_source_created",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "ai_knowledge_source",
      resourceId: finalSourceId,
      requestId,
      metadata: { total_files: todosArquivos.length, total_size_bytes: totalBytes },
    });
  }

  // Emite evento para o indexador disparar a indexação com embedding
  if (finalSourceId) {
    const { error: emitErr } = await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: finalSourceId,
      p_payload: { knowledge_source_id: finalSourceId, agent_id: agentId, source_type: "documento" },
      p_organization_id: activeOrg.orgId,
    } as never);

    if (emitErr) {
      console.warn("[conhecimento-upload] emit_event falhou (não bloqueia):", emitErr.message);
    }
  }

  const temChave = await temChaveDeEmbedding(activeOrg.orgId);

  return ok(
    {
      id: finalSourceId,
      files: todosArquivos,
      total_files: todosArquivos.length,
      total_size_bytes: totalBytes,
      indexacao_habilitada: temChave,
    },
    { status: sourceId ? 200 : 201, requestId },
  );
}
