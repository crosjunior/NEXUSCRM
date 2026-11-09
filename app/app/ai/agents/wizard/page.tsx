import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { obterContextoOrganizacao } from "@/lib/ai/agents/wizard-service";
import { traduzir } from "@/lib/i18n/dicionario";
import { AgentWizard } from "./AgentWizard";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AgentWizardPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const context = await obterContextoOrganizacao(activeOrg.orgId);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-1.5">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          <Sparkles className="h-4 w-4" />
          {t("Assistente Inteligente de IA")}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("Criar Agente de Atendimento com IA")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t("Configure seu atendente para WhatsApp e Instagram em poucos minutos. A inteligência artificial analisa seus materiais e deixa tudo pronto e parametrizado para responder seus clientes.")}
        </p>
      </header>

      <AgentWizard context={context} />
    </div>
  );
}
