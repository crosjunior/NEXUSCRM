"use server";

import { revalidatePath } from "next/cache";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  obterContextoOrganizacao,
  gerarBlueprintComIA,
  salvarEPublicarAgenteWizard,
  type AgentWizardInput,
  type AgentWizardGeneratedBlueprint,
  type WizardOrganizationContext,
} from "@/lib/ai/agents/wizard-service";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string; details?: unknown };

async function ensureManagerOrAdmin() {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false as const, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false as const, error: "forbidden_tenant" };
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false as const, error: "forbidden_role" };
  }
  return { ok: true as const, authUser, activeOrg };
}

/**
 * Carrega os dados da organização (bases de conhecimento, funis, canais e branding)
 */
export async function loadWizardContextAction(): Promise<ActionResult<WizardOrganizationContext>> {
  const guard = await ensureManagerOrAdmin();
  if (!guard.ok) return guard;

  try {
    const data = await obterContextoOrganizacao(guard.activeOrg.orgId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : "Erro ao carregar contexto",
    };
  }
}

/**
 * Gera via Gemini o blueprint e system prompt com base nas escolhas do usuário
 */
export async function generateAgentBlueprintAction(
  input: AgentWizardInput,
): Promise<ActionResult<AgentWizardGeneratedBlueprint>> {
  const guard = await ensureManagerOrAdmin();
  if (!guard.ok) return guard;

  try {
    const blueprint = await gerarBlueprintComIA(guard.activeOrg.orgId, input);
    return { ok: true, data: blueprint };
  } catch (err) {
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "Erro ao gerar configuração com IA",
    };
  }
}

/**
 * Cria e publica o agente com 1 clique
 */
export async function createAndPublishAgentWizardAction(params: {
  input: AgentWizardInput;
  blueprint: AgentWizardGeneratedBlueprint;
}): Promise<ActionResult<{ agentId: string; versionId: string }>> {
  const guard = await ensureManagerOrAdmin();
  if (!guard.ok) return guard;

  try {
    const res = await salvarEPublicarAgenteWizard({
      organizationId: guard.activeOrg.orgId,
      userId: guard.authUser.id,
      input: params.input,
      blueprint: params.blueprint,
    });

    if (!res.ok) {
      return { ok: false, error: "publish_failed", message: res.error };
    }

    revalidatePath("/app/ai/agents");
    return { ok: true, data: { agentId: res.agentId, versionId: res.versionId } };
  } catch (err) {
    return {
      ok: false,
      error: "save_failed",
      message: err instanceof Error ? err.message : "Erro ao salvar e publicar agente",
    };
  }
}
