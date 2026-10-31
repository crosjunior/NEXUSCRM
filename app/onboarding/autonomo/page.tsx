import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { AutonomousSetupWizard } from "@/components/onboarding/AutonomousSetupWizard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Configuração Autônoma com IA · NexusCRMAgent",
};

export default async function OnboardingAutonomoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <AutonomousSetupWizard
        organizationId={activeOrg.orgId}
        initialOrgName={activeOrg.name}
        onFinishedRedirect="/onboarding/done"
      />
    </div>
  );
}
