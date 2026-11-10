import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import { normalizarHex } from "@/lib/branding/rampa";
import { AutonomousSetupWizard } from "@/components/onboarding/AutonomousSetupWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingIaPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) {
    redirect("/login");
  }

  const supabase = await createClient();

  const [orgRes, agentsRes, kbRes, pipelinesRes, channelsRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, display_name, slug, settings")
      .eq("id", activeOrg.orgId)
      .maybeSingle(),
    supabase
      .from("ai_agents")
      .select("id, name, description, model, system_prompt, is_active, is_default, published_version_id, paused_at, created_at")
      .eq("organization_id", activeOrg.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_knowledge_sources")
      .select("id, name, source_type, source_metadata, is_active, chunks_count, created_at")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_pipelines")
      .select("id, name, crm_stages(id, name, slug, position, is_won, is_lost)")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true }),
    supabase
      .from("channel_sessions")
      .select("id, provider, status, display_name, metadata")
      .eq("organization_id", activeOrg.orgId)
      .order("created_at", { ascending: false }),
  ]);

  const orgRow = orgRes.data;
  const settings = (orgRow?.settings ?? {}) as Record<string, unknown>;
  const branding = (settings.branding ?? {}) as Record<string, unknown>;

  const agents = agentsRes.data ?? [];
  let defaultAgent = agents.find((a) => a.is_default) ?? agents[0] ?? null;

  // AUTO-RECONCILIAÇÃO / AUTO-REPAIR:
  // Se o agente foi criado mas ficou com published_version_id nulo ou desconectado das conversas:
  if (defaultAgent && !defaultAgent.published_version_id) {
    const admin = createAdminClient();
    const { data: latestVer } = await admin
      .from("ai_agent_versions")
      .select("id, channel_session_id")
      .eq("agent_id", defaultAgent.id)
      .eq("organization_id", activeOrg.orgId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVer?.id) {
      const channelSessions = channelsRes.data ?? [];
      const activeSession =
        channelSessions.find((c) => c.status === "connected" || c.status === "active") ??
        channelSessions[0];

      // Atualiza versão se channel_session_id estiver nulo
      if (!latestVer.channel_session_id && activeSession?.id) {
        await admin
          .from("ai_agent_versions")
          .update({
            channel_session_id: activeSession.id,
            status: "published",
          })
          .eq("id", latestVer.id)
          .eq("organization_id", activeOrg.orgId);
      }

      // Publica no ai_agents
      await admin
        .from("ai_agents")
        .update({
          published_version_id: latestVer.id,
          is_active: true,
          paused_at: null,
        })
        .eq("id", defaultAgent.id)
        .eq("organization_id", activeOrg.orgId);

      defaultAgent.published_version_id = latestVer.id;
      defaultAgent.is_active = true;
      defaultAgent.paused_at = null;

      // Vincula canais
      if (channelSessions.length > 0) {
        for (const cs of channelSessions) {
          const meta = (cs.metadata ?? {}) as Record<string, unknown>;
          await admin
            .from("channel_sessions")
            .update({
              metadata: {
                ...meta,
                agent_id: defaultAgent.id,
              },
            })
            .eq("id", cs.id)
            .eq("organization_id", activeOrg.orgId);
        }
      }

      // Ativa o agente nas conversas em andamento que estavam sem resposta
      await admin
        .from("conversations")
        .update({
          active_ai_agent_id: defaultAgent.id,
        })
        .eq("organization_id", activeOrg.orgId)
        .is("active_ai_agent_id", null);
    }
  }

  // AUTO-RECONCILIAÇÃO DA MARCA:
  // Garante que accent_hex e app_name estejam preenchidos no settings.branding
  if (branding && (!branding.accent_hex || !branding.app_name)) {
    const admin = createAdminClient();
    const accentHex = normalizarHex(
      (branding.accent_hex as string) ||
        (branding.accent_color as string) ||
        (branding.primary_color as string) ||
        "#001b4a",
    );
    const updatedBranding = {
      ...branding,
      app_name: (branding.app_name as string) || orgRow?.display_name || activeOrg.name,
      accent_hex: accentHex,
      accent_dark_hex: normalizarHex(
        (branding.accent_dark_hex as string) || (branding.primary_color as string) || accentHex,
      ),
    };
    await admin
      .from("organizations")
      .update({
        settings: {
          ...settings,
          branding: updatedBranding,
        },
      })
      .eq("id", activeOrg.orgId);
    invalidarOrg(activeOrg.orgId);
  }

  const initialConfig = {
    organizationId: activeOrg.orgId,
    orgName: orgRow?.display_name || activeOrg.name,
    slug: orgRow?.slug || "",
    branding: {
      appName: (branding.app_name as string) || orgRow?.display_name || activeOrg.name,
      accentHex:
        (branding.accent_hex as string) ||
        (branding.accent_color as string) ||
        (branding.primary_color as string) ||
        "#001b4a",
      primaryColor: (branding.primary_color as string) || "#001b4a",
      secondaryColor: (branding.secondary_color as string) || "#e1b63c",
      colors: (branding.colors as string[]) || ["#001b4a", "#e1b63c", "#009fe3"],
      fontPrimary: (branding.font_primary as string) || "Lato",
      fontSecondary: (branding.font_secondary as string) || "Inter",
      logoUrl: (branding.logo_path as string) || (branding.logo_url as string) || null,
      websiteUrl: (branding.website_url as string) || "",
      instagram: (branding.instagram as string) || "",
    },
    agents,
    defaultAgent,
    knowledgeSources: kbRes.data ?? [],
    pipelines: pipelinesRes.data ?? [],
    channels: channelsRes.data ?? [],
  };

  return (
    <div className="container max-w-5xl py-8 px-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("Assistente de Configuração Autônoma")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Parametrize sua empresa enviando apenas seus materiais, site ou redes sociais.")}
        </p>
      </div>

      <AutonomousSetupWizard
        organizationId={activeOrg.orgId}
        initialOrgName={orgRow?.display_name || activeOrg.name}
        initialSlug={orgRow?.slug}
        initialConfig={initialConfig}
        onFinishedRedirect="/app/inbox"
      />
    </div>
  );
}
