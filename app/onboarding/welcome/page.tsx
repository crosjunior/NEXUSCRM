import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { WelcomeForm } from "./_form";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { JaEstaPronto } from "../_components/JaEstaPronto";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  // O nome em texto vem do resolvedor do BANCO (`marcaDaSaida`), não do
  // `branding()` — que lê só o `.env`. O banco vence; o `.env` é o piso.
  const marca = await marcaDaSaida(null);

  const supabase = await createClient();
  const retrato = await lerRetratoDaInstalacao({ supabase, orgId: activeOrg.orgId });

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          {traduzir("Boas-vindas ao", idioma)} {marca.nome}
        </h2>
        <p className="text-sm text-muted-foreground">
          {traduzir("Vamos montar quem vai atender seus clientes — e onde ele vai trabalhar.", idioma)}
        </p>
      </header>

      <JaEstaPronto retrato={retrato} idioma={idioma} />

      {/* Opção Rápida: Assistente Autônomo com IA (Zero Fricção) */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <span>✨ Recomendado · Zero Fricção</span>
          </div>
          <h3 className="font-semibold text-base">Configurar Tudo com o Assistente de IA</h3>
          <p className="text-xs text-muted-foreground max-w-lg">
            Envie apenas seus arquivos (PDF, tabelas, panfletos), links de site ou redes sociais e a IA configura seu agente, tom de voz, catálogo e funil automaticamente em 60 segundos.
          </p>
        </div>
        <a
          href="/onboarding/autonomo"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 shrink-0 transition-colors gap-2"
        >
          <span>Usar Assistente Autônomo</span>
          <span>→</span>
        </a>
      </div>

      {/* Ou continuar configuração manual */}
      <div className="relative my-2 text-center text-xs text-muted-foreground">
        <span className="bg-background px-2 relative z-10">ou configure manualmente passo a passo</span>
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
      </div>

      <WelcomeForm defaultOrgName={retrato.empresa.aindaSemNomeProprio ? "" : activeOrg.name} orgId={activeOrg.orgId} />
    </div>
  );
}
