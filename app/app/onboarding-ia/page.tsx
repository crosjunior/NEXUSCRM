import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { AutonomousSetupWizard } from "@/components/onboarding/AutonomousSetupWizard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Assistente de Configuração Autônoma · NexusCRMAgent",
};

export default async function OnboardingIaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) {
    redirect("/login");
  }

  return (
    <div className="container max-w-5xl py-8 px-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Assistente de Configuração Autônoma</h1>
        <p className="text-sm text-muted-foreground">
          Parametrize sua empresa no NexusCRMAgent enviando apenas seus materiais, site ou redes sociais.
        </p>
      </div>

      <AutonomousSetupWizard
        organizationId={activeOrg.orgId}
        initialOrgName={activeOrg.name}
        onFinishedRedirect="/app/inbox"
      />
    </div>
  );
}
