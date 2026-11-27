import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ator: "aaaaaaaa-0000-4000-8000-000000000001",
  linhaDoAdmin: null as Record<string, unknown> | null,
  mfaEmDivida: vi.fn(async () => false),
  erroNoUpdate: null as { code?: string; message: string } | null,
  updates: [] as unknown[],
  audit: vi.fn(),
  orgAtual: { id: "bbbbbbbb-0000-4000-8000-000000000001", slug: "acme", settings: {} } as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDividaEstrita: h.mfaEmDivida }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: h.ator } } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) },
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.maybeSingle = async () => ({ data: h.linhaDoAdmin, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.maybeSingle = async () => ({ data: h.orgAtual, error: null });
      c.update = (valores: unknown) => {
        h.updates.push(valores);
        return c;
      };
      c.eq = () => c;
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: h.erroNoUpdate }).then(resolve);
      return c;
    },
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

import { GET, PATCH } from "./route";

const TENANT = "bbbbbbbb-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ id: TENANT }) };

const admin = (scope: string) => ({ user_id: h.ator, scope, mfa_required: false, revoked_at: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.linhaDoAdmin = admin("full");
  h.mfaEmDivida.mockResolvedValue(false);
  h.erroNoUpdate = null;
  h.updates = [];
  h.orgAtual = { id: TENANT, slug: "acme", settings: {} };
});

describe("GET /api/v1/admin/tenants/[id]/modules", () => {
  it("retorna todos os módulos liberados por padrão para org sem restrição", async () => {
    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT}/modules`);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.modulos_habilitados).toHaveLength(7);
    expect(json.data.catalogo).toHaveLength(7);
  });

  it("retorna apenas os módulos liberados quando configurados", async () => {
    h.orgAtual = {
      id: TENANT,
      slug: "acme",
      settings: { modulos_habilitados: ["crm", "inbox"] },
    };
    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT}/modules`);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.modulos_habilitados).toEqual(["crm", "inbox"]);
  });
});

describe("PATCH /api/v1/admin/tenants/[id]/modules", () => {
  it("grava os novos módulos em settings preservando dados existentes", async () => {
    h.orgAtual = {
      id: TENANT,
      slug: "acme",
      settings: { branding: { cor: "#ff0000" } },
    };

    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT}/modules`, {
      method: "PATCH",
      body: JSON.stringify({ modulos_habilitados: ["crm", "connections"] }),
      headers: { "content-type": "application/json" },
    });

    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toEqual({
      settings: {
        branding: { cor: "#ff0000" },
        modulos_habilitados: ["crm", "connections"],
      },
    });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "org.updated",
        organizationId: TENANT,
      }),
    );
  });

  it("recusa payload inválido com 400 validation_failed", async () => {
    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT}/modules`, {
      method: "PATCH",
      body: JSON.stringify({ modulos_habilitados: ["modulo_inexistente"] }),
      headers: { "content-type": "application/json" },
    });

    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
});
