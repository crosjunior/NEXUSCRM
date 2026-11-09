import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { idsDosProvedoresOferecidos } from "@/lib/ai/pontos/provedores-oferecidos";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkle, ArrowRight } from "@/lib/ui/icons";
import { getT } from "@/lib/i18n/server";
import { AgentForm } from "../[id]/_components/AgentForm";

export const dynamic = "force-dynamic";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

/**
 * Os provedores cuja chave veio na INSTALAÇÃO (`.env`), não da tela de
 * Credenciais.
 *
 * Sai de `lerAmbiente`, a mesma leitura que o retrato da instalação usa — uma
 * segunda lista de nomes de variável divergiria no dia em que um provedor novo
 * entrasse.
 */
function provedoresDaInstalacao(): string[] {
  const a = lerAmbiente();
  return Object.entries(a.chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
}

export default async function NewAgentPage() {
  const t = await getT();
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const [orgRes, credentialsRes, channelSessions] = await Promise.all([
    // O provedor que a organização JÁ usa: sem ele, o agente novo nascia
    // `anthropic` e o formulário pedia "Cadastrar credencial anthropic" para
    // quem só tem chave da OpenAI.
    supabase.from("organizations").select("settings").eq("id", activeOrg.orgId).maybeSingle(),
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
  ]);

  const credentials = (credentialsRes.data ?? []) as CredentialRow[];
  const llmDaOrg = (
    orgRes.data?.settings as { llm?: { provider?: string } } | null
  )?.llm;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Sparkle size={20} aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {t("Prefere criar com o Assistente Inteligente de IA?")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Passo a passo conversacional simples e rápido, com parametrização automática baseada nos materiais da sua empresa.")}
            </p>
          </div>
        </div>
        <Link href="/app/ai/agents/wizard" className="shrink-0">
          <Button className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-sm">
            <Sparkle size={14} aria-hidden />
            {t("Usar Assistente de IA")}
            <ArrowRight size={14} aria-hidden />
          </Button>
        </Link>
      </div>

      <AgentForm
        mode="create"
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        provedoresOferecidos={await idsDosProvedoresOferecidos(createAdminClient())}
        provedorPadrao={llmDaOrg?.provider}
        channelSessions={channelSessions}
        organizationTimezone={fusoUtilizavel(activeOrg.timezone)}
      />
    </div>
  );
}
