import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";
import type { InterfaceSettings } from "@/lib/navigation/interface";
import type { ModuloTenant } from "@/lib/tenants/modulos-contratados";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { Role } from "@/lib/auth/types";
import { permissaoDaCapacidade } from "@/lib/extensions/capacidades";
import { portasLegiveis } from "@/lib/extensions/portas-legiveis";
import { localize, type ExtensionManifest } from "@/lib/extensions/manifest";
import type { ExtensionGuideView } from "@/lib/extensions/view";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";
import { hubSections, type NavGroupId } from "@/lib/navigation/registry";
import { BookOpen, Lightbulb, ListChecks, Warning } from "@/lib/ui/icons";

interface NavHubProps {
  interfaceSettings?: InterfaceSettings;
  /**
   * Módulos opcionais ligados na instalação. OBRIGATÓRIO: quando era opcional,
   * ausente queria dizer "não filtra", e o hub de IA mostrava a porta de um
   * módulo desligado — o clique dava 404 (revisão do #1573, B1).
   */
  modulosLigados: readonly ModuloOpcional[];
  /** Capacidades que a organização ligou. Ausente = o hub não filtra por capacidade. */
  capacidadesLigadas?: readonly CapacidadeDaOrganizacao[];
  /** Módulos de negócio contratados pelo tenant. */
  modulosTenant?: readonly ModuloTenant[];
  /** Recursos individuais liberados para o tenant. */
  recursosTenant?: readonly string[];
  group: NavGroupId;
  isPlatformAdmin: boolean;
  role: Role | null;
  title: string;
  subtitle: string;
  extensionGuides?: ExtensionGuideView[];
  extensionsUnavailable?: boolean;
  /**
   * Idioma da interface. `traduzir` é pura — roda em Server Component sem
   * provider. O default mantém os demais hubs (ex.: /app/ai) como estão até
   * que a página deles passe o locale; o que não tem entrada no dicionário
   * degrada para pt-BR, que é o comportamento de antes.
   */
  locale?: Idioma;
}

const EXTENSION_ICONS: Record<ExtensionManifest["display"]["icon"], typeof ListChecks> = {
  ListChecks,
  BookOpen,
  Lightbulb,
};

const DICAS_JORNADA: Record<string, { titulo: string; passos: string[] }> = {
  ia: {
    titulo: "Passo a passo recomendado para colocar sua IA no ar:",
    passos: [
      "1. Credenciais & Modelos: conecte seu provedor preferido em Credenciais",
      "2. Instruções do Agente: defina a personalidade, tom de voz e regras de atendimento",
      "3. Base de Conhecimento: adicione manuais, produtos e PDFs para o agente consultar",
      "4. Atendimento & Casos: ative nos canais e acompanhe as conversas em tempo real",
    ],
  },
  crm: {
    titulo: "Passo a passo recomendado para acelerar suas vendas:",
    passos: [
      "1. Funil de Vendas: ajuste as fases de negociação conforme seu processo comercial",
      "2. Contatos & Leads: importe ou cadastre seus clientes e empresas",
      "3. Produtos & Catálogo: cadastre seus itens com preços para facilitar cotações",
      "4. Propostas Comerciais: envie propostas em PDF diretamente pelo WhatsApp",
    ],
  },
  atendimento: {
    titulo: "Passo a passo recomendado para a operação de atendimento:",
    passos: [
      "1. Agenda & Horários: defina os tipos de agendamento e compromissos",
      "2. Respostas Rápidas: crie mensagens prontas com atalhos para agilizar o suporte",
      "3. Radar de Clientes: monitore contatos que esfriaram para resgate ativo",
    ],
  },
  configuracao: {
    titulo: "Gestão completa da organização:",
    passos: [
      "1. Marca & Identidade: configure logotipo e cores da sua empresa",
      "2. Equipe & Acessos: convide operadores e defina papéis de acesso",
      "3. Canais & WhatsApp: conecte e monitore os números de atendimento",
    ],
  },
};

/**
 * Vitrine de um grupo do registro de navegação.
 *
 * O sidebar carrega o uso diário; o hub carrega o inventário — todas as telas
 * do grupo, cada uma com a frase que explica para que serve. Era isso que
 * faltava: telas como Conhecimento e Credenciais existiam só como aba dentro de
 * `/app/ai`, invisíveis para quem ainda não estava lá.
 *
 * As seções vêm do campo `section` do registro e são a JORNADA de quem usa o
 * grupo (montar → ensinar → acompanhar), não uma taxonomia técnica. Reordenar a
 * jornada é reordenar o array do registro.
 */
/**
 * `aria-labelledby` separa múltiplos ids por ESPAÇO — então um id com espaço
 * ("hub-ia-Ensinar o agente") vira três referências quebradas e a seção fica sem
 * rótulo acessível. O slug é o que mantém a região anunciável.
 */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function NavHub({
  group,
  isPlatformAdmin,
  role,
  title,
  subtitle,
  interfaceSettings,
  modulosLigados,
  capacidadesLigadas,
  modulosTenant,
  recursosTenant,
  locale = IDIOMA_PADRAO,
  extensionGuides = [],
  extensionsUnavailable = false,
}: NavHubProps) {
  const secoes = hubSections(
    group,
    isPlatformAdmin,
    role,
    interfaceSettings,
    modulosLigados,
    capacidadesLigadas,
    modulosTenant,
    recursosTenant,
  );

  const dica = DICAS_JORNADA[group];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir(title, locale)}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{traduzir(subtitle, locale)}</p>}
      </header>

      {dica && (
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 shadow-theme-xs">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            <Lightbulb size={16} aria-hidden />
            <span>{traduzir(dica.titulo, locale)}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            {dica.passos.map((passo, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border/40 bg-card/60 p-2.5 text-xs text-muted-foreground transition-colors hover:border-brand-500/40 hover:text-foreground"
              >
                {traduzir(passo, locale)}
              </div>
            ))}
          </div>
        </div>
      )}

      {secoes.map(({ section, items }) => (
        <section
          key={section}
          aria-labelledby={`hub-${group}-${slug(section)}`}
          className="space-y-3"
        >
          <h2
            id={`hub-${group}-${slug(section)}`}
            className="text-xs font-medium tracking-wider text-muted-foreground uppercase"
          >
            {traduzir(section, locale)}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group block">
                  <Card className="flex h-full items-start gap-3.5 rounded-xl border border-border/60 bg-card p-4 shadow-theme-xs transition-all hover:border-brand-500/40 hover:shadow-theme-sm">
                    <div className="rounded-lg bg-brand-50 p-2 text-brand-600 transition-colors group-hover:bg-brand-500 group-hover:text-white dark:bg-brand-500/15 dark:text-brand-400 dark:group-hover:bg-brand-500 dark:group-hover:text-white">
                      <Icon
                        size={20}
                        weight="regular"
                        aria-hidden
                        className="shrink-0"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {traduzir(item.label, locale)}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {traduzir(item.description, locale)}
                      </p>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {group === "crm" && (extensionGuides.length > 0 || extensionsUnavailable) ? (
        <section aria-labelledby="hub-crm-orientacoes-instaladas" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2
                id="hub-crm-orientacoes-instaladas"
                className="text-xs font-medium tracking-wider text-muted-foreground uppercase"
              >
                {traduzir("Orientações instaladas", locale)}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {traduzir(
                  "Guias adicionados depois da instalação, sem acesso aos dados do CRM.",
                  locale,
                )}
              </p>
            </div>
            <Link
              href="/app/extensions"
              className="text-xs font-medium text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden"
            >
              {traduzir("Gerenciar extensões", locale)}
            </Link>
          </div>

          {extensionsUnavailable ? (
            <Card className="flex gap-3 border-warning/40 bg-warning-bg p-4">
              <Warning
                size={20}
                weight="duotone"
                aria-hidden
                className="mt-0.5 shrink-0 text-warning-fg"
              />
              <div>
                <h3 className="text-sm font-semibold">
                  {traduzir("Não foi possível conferir as orientações instaladas", locale)}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {traduzir(
                    "Abra Extensões para tentar novamente e ver o estado registrado no servidor.",
                    locale,
                  )}
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {extensionGuides.flatMap((guide) =>
                // `?? []`: módulo de DADOS não contribui card; ele aparece na ficha do contato,
                // não no hub. Sem a guarda, o hub quebraria ao encontrar um instalado.
                (guide.manifest.contributions.crm_cards ?? []).map((contribution) => {
                  const Icon = EXTENSION_ICONS[contribution.icon];
                  const compact = guide.configuration.density === "compact";
                  return (
                    <Link
                      key={`${guide.installation_id}:${contribution.id}`}
                      href={`/app/extensions/${encodeURIComponent(guide.installation_id)}?card=${encodeURIComponent(contribution.id)}`}
                      data-testid={`extension-contribution-${guide.installation_id}-${contribution.id}`}
                      className="block rounded-lg focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:outline-hidden"
                    >
                      <Card
                        className={`flex h-full gap-3 transition-colors hover:border-border-strong ${compact ? "p-3" : "p-4"}`}
                      >
                        <Icon
                          size={20}
                          weight="duotone"
                          aria-hidden
                          className="mt-0.5 shrink-0 text-accent"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            {localize(guide.manifest.display.title, locale).text}
                          </p>
                          <h3 className="mt-0.5 text-sm font-semibold">
                            {localize(contribution.title, locale).text}
                          </h3>
                          {guide.configuration.show_description ? (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {localize(contribution.description, locale).text}
                            </p>
                          ) : null}
                          {localize(contribution.title, locale).fallback ||
                          (guide.configuration.show_description &&
                            localize(contribution.description, locale).fallback) ? (
                            <p className="mt-1 text-[11px] text-warning-fg">
                              {traduzir("Texto disponível em português.", locale)}
                            </p>
                          ) : null}
                          <p className="mt-2 text-[11px] text-text-subtle">
                            {portasLegiveis(
                              [permissaoDaCapacidade(contribution.action.capability)],
                              (texto) => traduzir(texto, locale),
                            )}
                          </p>
                        </div>
                      </Card>
                    </Link>
                  );
                }),
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
