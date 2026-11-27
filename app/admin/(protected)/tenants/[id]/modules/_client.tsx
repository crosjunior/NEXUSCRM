"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MODULOS_TENANT_CATALOGO,
  MODULOS_TENANT_TODOS,
  RECURSOS_TENANT_CATALOGO,
  RECURSOS_TENANT_TODOS,
  resolverDependenciasAoAtivar,
  resolverDependenciasAoDesativar,
  type ModuloTenant,
  type ModuloTenantInfo,
  type RecursoTenantInfo,
} from "@/lib/tenants/modulos-contratados";
import {
  Brain,
  CalendarBlank,
  ChartBar,
  CheckCircle,
  Funnel,
  Inbox,
  PlugsConnected,
  BookOpen,
  Warning,
  ArrowsClockwise,
  Check,
} from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

interface TenantModulesResponse {
  data: {
    organization_id: string;
    modulos_habilitados: ModuloTenant[];
    recursos_habilitados?: string[];
    catalogo: ModuloTenantInfo[];
    todos_modulos: ModuloTenant[];
    todos_recursos: string[];
  };
}

const ICONES_MODULOS: Record<ModuloTenant, React.ElementType> = {
  crm: Funnel,
  inbox: Inbox,
  atendimento: CalendarBlank,
  ai_agents: Brain,
  knowledge_base: BookOpen,
  dashboard: ChartBar,
  connections: PlugsConnected,
};

export function TenantModulesClient({ id }: { id: string }) {
  const t = useT();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "tenant", id, "modules"],
    queryFn: () => apiClient.get<TenantModulesResponse>(`/api/v1/admin/tenants/${id}/modules`),
    staleTime: 30_000,
  });

  const [modulosSelecionados, setModulosSelecionados] = useState<Set<ModuloTenant>>(
    () => new Set(MODULOS_TENANT_TODOS),
  );
  const [recursosSelecionados, setRecursosSelecionados] = useState<Set<string>>(
    () => new Set(RECURSOS_TENANT_TODOS),
  );
  const [alterado, setAlterado] = useState(false);

  useEffect(() => {
    if (data?.data) {
      if (data.data.modulos_habilitados) {
        setModulosSelecionados(new Set(data.data.modulos_habilitados));
      }
      if (data.data.recursos_habilitados) {
        setRecursosSelecionados(new Set(data.data.recursos_habilitados));
      } else {
        // Se ainda não salvo, habilita todos os recursos dos módulos que estão ativos
        const mods = new Set(data.data.modulos_habilitados ?? MODULOS_TENANT_TODOS);
        const recs = Object.values(RECURSOS_TENANT_CATALOGO)
          .filter((r) => mods.has(r.moduloId))
          .map((r) => r.id);
        setRecursosSelecionados(new Set(recs));
      }
      setAlterado(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: { modulos_habilitados: ModuloTenant[]; recursos_habilitados: string[] }) =>
      apiClient.patch(`/api/v1/admin/tenants/${id}/modules`, payload),
    onSuccess: () => {
      toast.success(t("Módulos e recursos da empresa atualizados com sucesso!"));
      setAlterado(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", id] });
    },
    onError: (err: Error) => {
      toast.error(t("Erro ao salvar módulos da empresa."), {
        description: err.message,
      });
    },
  });

  /** Alterna o módulo inteiro e todos os seus recursos */
  function toggleModulo(moduloId: ModuloTenant) {
    const recursosDoMod = Object.values(RECURSOS_TENANT_CATALOGO).filter(
      (r) => r.moduloId === moduloId,
    );
    const estaAtivo = modulosSelecionados.has(moduloId);

    const proxsModulos = new Set(modulosSelecionados);
    const proxsRecursos = new Set(recursosSelecionados);

    if (estaAtivo) {
      // Desativar módulo e todos os seus recursos
      proxsModulos.delete(moduloId);
      const removidosDependentes: string[] = [];

      for (const rec of recursosDoMod) {
        if (proxsRecursos.has(rec.id)) {
          const { recursosRemovidos } = resolverDependenciasAoDesativar(rec.id, proxsRecursos);
          removidosDependentes.push(...recursosRemovidos.filter((r) => r !== rec.id));
        }
      }

      if (removidosDependentes.length > 0) {
        const nomes = [...new Set(removidosDependentes)]
          .map((rid) => RECURSOS_TENANT_CATALOGO[rid]?.nome ?? rid)
          .join(", ");
        toast.warning(
          t(`A desativação deste módulo também desativou recursos dependentes em outros módulos: ${nomes}`),
        );
      }
    } else {
      // Ativar módulo e todos os seus recursos
      proxsModulos.add(moduloId);
      const adicionadosAutomaticos: string[] = [];

      for (const rec of recursosDoMod) {
        const { recursosAdicionados, modulosAdicionados } = resolverDependenciasAoAtivar(
          rec.id,
          proxsRecursos,
          proxsModulos,
        );
        adicionadosAutomaticos.push(
          ...recursosAdicionados.filter((rid) => RECURSOS_TENANT_CATALOGO[rid]?.moduloId !== moduloId),
        );
        for (const m of modulosAdicionados) proxsModulos.add(m);
      }

      if (adicionadosAutomaticos.length > 0) {
        const nomes = [...new Set(adicionadosAutomaticos)]
          .map((rid) => RECURSOS_TENANT_CATALOGO[rid]?.nome ?? rid)
          .join(", ");
        toast.info(
          t(`Ativamos dependências necessárias em outros módulos: ${nomes}`),
        );
      }
    }

    setModulosSelecionados(proxsModulos);
    setRecursosSelecionados(proxsRecursos);
    setAlterado(true);
  }

  /** Alterna um recurso específico, resolvendo suas dependências */
  function toggleRecurso(recursoId: string) {
    const recurso = RECURSOS_TENANT_CATALOGO[recursoId];
    if (!recurso) return;

    const estaAtivo = recursosSelecionados.has(recursoId);
    const proxsRecursos = new Set(recursosSelecionados);
    const proxsModulos = new Set(modulosSelecionados);

    if (estaAtivo) {
      // Desativar recurso e dependentes em cadeia
      const { recursosRemovidos } = resolverDependenciasAoDesativar(recursoId, proxsRecursos);
      const dependentes = recursosRemovidos.filter((id) => id !== recursoId);

      if (dependentes.length > 0) {
        const nomes = dependentes
          .map((rid) => RECURSOS_TENANT_CATALOGO[rid]?.nome ?? rid)
          .join(", ");
        toast.warning(
          t(`"${recurso.nome}" foi desativado. Recursos dependentes também foram desativados: ${nomes}`),
        );
      }

      // Se o módulo deste recurso não tiver mais nenhum recurso ativo, desativa o módulo
      const recursosRestantes = Object.values(RECURSOS_TENANT_CATALOGO).filter(
        (r) => r.moduloId === recurso.moduloId && proxsRecursos.has(r.id),
      );
      if (recursosRestantes.length === 0) {
        proxsModulos.delete(recurso.moduloId);
      }
    } else {
      // Ativar recurso e dependências necessárias em cadeia
      const { recursosAdicionados, modulosAdicionados } = resolverDependenciasAoAtivar(
        recursoId,
        proxsRecursos,
        proxsModulos,
      );

      const dependenciasAtivadas = recursosAdicionados.filter((id) => id !== recursoId);
      if (dependenciasAtivadas.length > 0) {
        const nomes = dependenciasAtivadas
          .map((rid) => RECURSOS_TENANT_CATALOGO[rid]?.nome ?? rid)
          .join(", ");
        toast.info(
          t(`"${recurso.nome}" requer outras funcionalidades. Ativamos automaticamente: ${nomes}`),
        );
      }
    }

    setModulosSelecionados(proxsModulos);
    setRecursosSelecionados(proxsRecursos);
    setAlterado(true);
  }

  function marcarTodosDoModulo(moduloId: ModuloTenant) {
    const recursosDoMod = Object.values(RECURSOS_TENANT_CATALOGO).filter(
      (r) => r.moduloId === moduloId,
    );
    const proxsModulos = new Set(modulosSelecionados);
    const proxsRecursos = new Set(recursosSelecionados);

    proxsModulos.add(moduloId);
    for (const rec of recursosDoMod) {
      resolverDependenciasAoAtivar(rec.id, proxsRecursos, proxsModulos);
    }

    setModulosSelecionados(proxsModulos);
    setRecursosSelecionados(proxsRecursos);
    setAlterado(true);
  }

  function desmarcarTodosDoModulo(moduloId: ModuloTenant) {
    toggleModulo(moduloId);
  }

  function marcarTodos() {
    setModulosSelecionados(new Set(MODULOS_TENANT_TODOS));
    setRecursosSelecionados(new Set(RECURSOS_TENANT_TODOS));
    setAlterado(true);
  }

  function desmarcarTodos() {
    setModulosSelecionados(new Set());
    setRecursosSelecionados(new Set());
    setAlterado(true);
  }

  function salvar() {
    mutation.mutate({
      modulos_habilitados: [...modulosSelecionados],
      recursos_habilitados: [...recursosSelecionados],
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data?.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center text-sm text-destructive">
        <p>{t("Não foi possível carregar os módulos da empresa.")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
          <ArrowsClockwise className="mr-2 h-4 w-4" />
          {t("Tentar novamente")}
        </Button>
      </div>
    );
  }

  const totalModulos = MODULOS_TENANT_TODOS.length;
  const modulosAtivos = modulosSelecionados.size;
  const totalRecursos = RECURSOS_TENANT_TODOS.length;
  const recursosAtivos = recursosSelecionados.size;

  return (
    <div className="space-y-6">
      {/* Header e Ações rápidas */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border bg-card p-6 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("Módulos & Funcionalidades da Empresa")}
            </h2>
            <Badge variant={modulosAtivos === totalModulos ? "default" : "secondary"}>
              {modulosAtivos} de {totalModulos} módulos
            </Badge>
            <Badge variant="outline" className="text-xs">
              {recursosAtivos} de {totalRecursos} recursos liberados
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            {t(
              "Controle os pilares e recursos liberados para esta empresa conforme o plano ou assinatura. Desative módulos completos ou recursos individuais; as dependências são gerenciadas automaticamente e os itens desativados são removidos dos menus de acesso.",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={marcarTodos}
            disabled={mutation.isPending}
          >
            {t("Liberar Todos")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={desmarcarTodos}
            disabled={mutation.isPending}
          >
            {t("Desmarcar Todos")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={salvar}
            disabled={!alterado || mutation.isPending}
            className="min-w-28"
          >
            {mutation.isPending ? t("Salvando...") : t("Salvar Alterações")}
          </Button>
        </div>
      </div>

      {alterado && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          <Warning className="h-5 w-5 shrink-0" />
          <span>
            {t(
              "Você fez alterações na liberação de módulos ou recursos. Clique em 'Salvar Alterações' para aplicá-las à empresa.",
            )}
          </span>
        </div>
      )}

      {/* Grid de Módulos com Recursos Individuais */}
      <div className="grid gap-6 md:grid-cols-2">
        {MODULOS_TENANT_TODOS.map((moduloId) => {
          const mod = MODULOS_TENANT_CATALOGO[moduloId];
          const moduloAtivo = modulosSelecionados.has(moduloId);
          const Icone = ICONES_MODULOS[moduloId] ?? CheckCircle;
          const recursosDoModulo = mod.recursos;
          const recursosAtivosNoModulo = recursosDoModulo.filter((r) =>
            recursosSelecionados.has(r.id),
          ).length;

          return (
            <Card
              key={moduloId}
              className={`transition-all duration-200 border rounded-xl flex flex-col justify-between ${
                moduloAtivo
                  ? "border-brand-500/30 bg-card shadow-theme-xs hover:shadow-theme-sm"
                  : "border-border/60 bg-muted/20 opacity-80"
              }`}
            >
              <div>
                <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`rounded-xl p-2.5 transition-colors ${
                        moduloAtivo
                          ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icone className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-semibold">{t(mod.nome)}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {t(mod.pilar)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {recursosAtivosNoModulo} de {recursosDoModulo.length} ativos
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {moduloAtivo ? t("Liberado") : t("Oculto")}
                    </span>
                    <Switch
                      checked={moduloAtivo}
                      onCheckedChange={() => toggleModulo(moduloId)}
                      disabled={mutation.isPending}
                      aria-label={`Liberar ${mod.nome}`}
                    />
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-0">
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground">
                    {t(mod.descricao)}
                  </CardDescription>

                  {/* Seção interativa de recursos individuais */}
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
                      <span className="font-semibold text-xs text-foreground">
                        {t("Recursos individuais:")}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => marcarTodosDoModulo(moduloId)}
                          disabled={mutation.isPending}
                          className="text-brand-600 dark:text-brand-400 hover:underline font-medium cursor-pointer"
                        >
                          {t("Todos")}
                        </button>
                        <span className="text-muted-foreground">•</span>
                        <button
                          type="button"
                          onClick={() => desmarcarTodosDoModulo(moduloId)}
                          disabled={mutation.isPending}
                          className="text-muted-foreground hover:underline cursor-pointer"
                        >
                          {t("Nenhum")}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {recursosDoModulo.map((recurso: RecursoTenantInfo) => {
                        const recAtivo = recursosSelecionados.has(recurso.id);
                        const temDependencias = recurso.dependencias.length > 0;

                        return (
                          <div
                            key={recurso.id}
                            className={`flex items-start justify-between gap-3 p-2.5 rounded-lg transition-all ${
                              recAtivo
                                ? "bg-card border border-border/70 shadow-theme-xs"
                                : "bg-muted/40 border border-transparent opacity-65"
                            }`}
                          >
                            <div className="space-y-0.5 pr-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-medium leading-none text-foreground">
                                  {t(recurso.nome)}
                                </span>
                                {temDependencias && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] py-0 px-1 font-normal text-muted-foreground"
                                  >
                                    {t("Requer:")}{" "}
                                    {recurso.dependencias
                                      .map((depId) => RECURSOS_TENANT_CATALOGO[depId]?.nome ?? depId)
                                      .join(", ")}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                {t(recurso.descricao)}
                              </p>
                            </div>

                            <Switch
                              checked={recAtivo}
                              onCheckedChange={() => toggleRecurso(recurso.id)}
                              disabled={mutation.isPending}
                              aria-label={`Ativar ${recurso.nome}`}
                              className="shrink-0 mt-0.5"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
