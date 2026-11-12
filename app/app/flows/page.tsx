import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { InstagramFlowsManager } from "@/components/automations/InstagramFlowsManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fluxos de Atendimento" };

export default async function FlowsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Fluxos de Atendimento", idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Crie e gerencie fluxos visuais e regras de resposta automática para comentários, menções em stories e mensagens diretas no Instagram e WhatsApp.",
            idioma,
          )}
        </p>
      </header>

      <InstagramFlowsManager />
    </div>
  );
}
