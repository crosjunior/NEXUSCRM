import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST() {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const admin = createAdminClient();

  const { error } = await admin
    .from("calendar_connections")
    .delete()
    .eq("organization_id", org.orgId)
    .eq("user_id", user.id)
    .eq("provider", "outlook");

  if (error) {
    return fail("internal_error", "Falha ao desconectar conta Outlook.", 500, { requestId });
  }

  void audit({
    action: "agenda.outlook.conexao_desconectada",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "calendar_connections",
    metadata: { provider: "outlook" },
    requestId,
  });

  return ok({ disconnected: true }, { requestId });
}
