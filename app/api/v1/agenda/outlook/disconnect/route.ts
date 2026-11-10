import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST() {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();

  const { error } = await admin
    .from("calendar_connections")
    .delete()
    .eq("organization_id", authz.orgId)
    .eq("user_id", authz.userId)
    .eq("provider", "outlook");

  if (error) {
    return fail("database_error", "Falha ao desconectar conta Outlook.", 500, { requestId });
  }

  void audit({
    action: "calendar.disconnected",
    actorUserId: authz.userId,
    organizationId: authz.orgId,
    resourceType: "calendar_connection",
    resourceId: "outlook",
    requestId,
  });

  return ok({ disconnected: true }, { requestId });
}
