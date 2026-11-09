"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Sparkle,
  Robot,
  ChatsCircle,
  Users,
  ShieldCheck,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  CalendarDots,
  Funnel,
  UserCircle,
  CircleNotch,
  Check,
  Warning,
  Lightning,
} from "@/lib/ui/icons";
import {
  generateAgentBlueprintAction,
  createAndPublishAgentWizardAction,
} from "./_actions";
import type {
  WizardOrganizationContext,
  AgentWizardInput,
  AgentWizardGeneratedBlueprint,
} from "@/lib/ai/agents/wizard-service";

interface Props {
  context: WizardOrganizationContext;
}

export function AgentWizard({ context }: Props) {
  const router = useRouter();
  const t = useT();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado do Formulário Wizard
  const [form, setForm] = useState<AgentWizardInput>({
    agentName: `Sofia - Atendente ${context.organizationName}`,
    channelSessionId: context.channels[0]?.id || null,
    targetAudience:
      context.brandIdentity?.target_audience ||
      t("Clientes e leads interessados nos serviços e produtos da empresa"),
    primaryObjective: "hybrid",
    objectiveDescription: t(
      "Atender com cordialidade, tirar dúvidas sobre o negócio, qualificar o interesse do lead e agendar reunião ou direcionar para um consultor.",
    ),
    toneOfVoice: "consultative",
    customTone: "",
    useEmojis: "moderate",
    knowledgeSourceIds: context.knowledgeSources.map((k) => k.id),
    pipelineIds: context.pipelines.map((p) => p.id),
    capabilities: {
      searchKnowledge: context.knowledgeSources.length > 0,
      manageLeads: true,
      moveStages: context.pipelines.length > 0,
      scheduleAppointments: true,
      humanHandoff: true,
    },
    guardrails: {
      splitMessages: true,
      declareAiAssistant: true,
      protectPricing: true,
      handoffKeywords: [
        "falar com humano",
        "atendente humano",
        "pessoa real",
        "reclamação",
        "falar com alguém",
        "especialista",
      ],
    },
  });

  // Blueprint Gerado pela IA
  const [blueprint, setBlueprint] = useState<AgentWizardGeneratedBlueprint | null>(null);
  const [keywordInput, setKeywordInput] = useState("");

  const totalSteps = 5;

  const objectives = [
    {
      id: "hybrid",
      title: t("Atendimento Completo Híbrido"),
      desc: t("Tira dúvidas, qualifica o interesse do lead e direciona para fechamento ou agendamento."),
      badge: t("Mais Recomendado"),
    },
    {
      id: "sales_qualification",
      title: t("Vendas e Qualificação de Leads"),
      desc: t("Focado em identificar necessidades, apresentar produtos/imóveis e converter contatos."),
    },
    {
      id: "scheduling",
      title: t("Agendamento de Visitas / Reuniões"),
      desc: t("Verifica disponibilidade de horários e agenda direto na sua equipe."),
    },
    {
      id: "support_faq",
      title: t("Suporte e Dúvidas Frequentes"),
      desc: t("Respostas precisas e instantâneas sobre regras, tabela de preços e serviços."),
    },
  ];

  const tones = [
    {
      id: "consultative",
      title: t("Consultivo & Acolhedor"),
      desc: t("Empático e atencioso. Ouve as necessidades do cliente e orienta a melhor escolha."),
    },
    {
      id: "direct",
      title: t("Direto & Focado em Vendas"),
      desc: t("Objetivo, ágil e persuasivo. Enfatiza soluções práticas e benefícios rapidamente."),
    },
    {
      id: "friendly",
      title: t("Amigável & Descontraído"),
      desc: t("Comunicação calorosa, natural e próxima, excelente para público jovem ou B2C."),
    },
    {
      id: "formal",
      title: t("Corporativo & Especialista"),
      desc: t("Polido, técnico e respeitoso. Ideal para relações B2B de alto ticket ou institucionais."),
    },
  ];

  const emojiOptions = [
    {
      id: "moderate",
      label: t("Moderado (Recomendado)"),
      desc: t("1 a 2 emojis pontuais por mensagem"),
    },
    {
      id: "none",
      label: t("Sem Emojis"),
      desc: t("Apenas texto limpo e direto"),
    },
    {
      id: "expressive",
      label: t("Expressivo"),
      desc: t("Estilo mais visual e dinâmico"),
    },
  ];

  const capabilityOptions = [
    {
      key: "searchKnowledge",
      title: t("Consultar a Base de Conhecimento da Empresa"),
      desc: t("Permite ao agente pesquisar em PDFs, manuais e apresentações para responder dúvidas sem inventar nada."),
      icon: BookOpen,
    },
    {
      key: "manageLeads",
      title: t("Cadastrar e Atualizar Contatos no CRM"),
      desc: t("Cria automaticamente novos leads com nome, telefone e preferências extraídas do bate-papo."),
      icon: UserCircle,
    },
    {
      key: "moveStages",
      title: t("Avançar o Lead no Funil de Vendas"),
      desc: t("Move o card no quadro Kanban (ex: de 'Primeiro Contato' para 'Qualificado' ou 'Negociação')."),
      icon: Funnel,
    },
    {
      key: "scheduleAppointments",
      title: t("Agendar Compromissos e Reuniões"),
      desc: t("Consulta os horários disponíveis na agenda e marca compromissos diretamente com o cliente."),
      icon: CalendarDots,
    },
    {
      key: "humanHandoff",
      title: t("Solicitar Atendimento Humano"),
      desc: t("Chama um consultor da sua equipe caso o cliente peça para falar com uma pessoa."),
      icon: Users,
    },
  ];

  const guardrailOptions = [
    {
      key: "splitMessages",
      title: t("Dividir Respostas em Balões Naturais (Humanização)"),
      desc: t("Em vez de enviar um texto gigante, envia 2 ou 3 mensagens curtas sequenciais, exatamente como uma pessoa digitaria no WhatsApp."),
    },
    {
      key: "protectPricing",
      title: t("Proteção Antialucinação de Preços e Prazos"),
      desc: t("Impede a IA de inventar descontos, preços de imóveis ou prazos que não constem oficialmente nos documentos enviados."),
    },
    {
      key: "declareAiAssistant",
      title: t("Transparência Amigável"),
      desc: t("Caso o cliente pergunte diretamente se está falando com um robô ou IA, o assistente confirma de forma simpática e solícita."),
    },
  ];

  const handleAddKeyword = () => {
    if (!keywordInput.trim()) return;
    const kw = keywordInput.trim().toLowerCase();
    if (!form.guardrails.handoffKeywords.includes(kw)) {
      setForm((prev) => ({
        ...prev,
        guardrails: {
          ...prev.guardrails,
          handoffKeywords: [...prev.guardrails.handoffKeywords, kw],
        },
      }));
    }
    setKeywordInput("");
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    setForm((prev) => ({
      ...prev,
      guardrails: {
        ...prev.guardrails,
        handoffKeywords: prev.guardrails.handoffKeywords.filter((k) => k !== kwToRemove),
      },
    }));
  };

  const handleGenerateBlueprint = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const res = await generateAgentBlueprintAction(form);
      if (!res.ok) {
        setErrorMsg(res.message || t("Não foi possível gerar a configuração com a IA."));
        return;
      }
      setBlueprint(res.data);
      setCurrentStep(5);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("Erro desconhecido na geração"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!blueprint) return;
    setIsPublishing(true);
    setErrorMsg(null);
    try {
      const res = await createAndPublishAgentWizardAction({
        input: form,
        blueprint,
      });
      if (!res.ok) {
        setErrorMsg(res.message || t("Erro ao publicar o agente."));
        return;
      }
      router.push("/app/ai/agents");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("Erro desconhecido ao publicar"));
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-16">
      {/* Barra de Progresso Superior */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            {t("Passo")} {currentStep} {t("de")} {totalSteps}
          </span>
          <span>
            {currentStep === 1 && t("Identidade & Objetivo")}
            {currentStep === 2 && t("Tom de Voz & Público")}
            {currentStep === 3 && t("Superpoderes & Conhecimento")}
            {currentStep === 4 && t("Humanização & Segurança")}
            {currentStep === 5 && t("Revisão e Ativação")}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((step) => (
            <div
              key={step}
              className={`h-2 rounded-full transition-all duration-300 ${
                step <= currentStep
                  ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
          <Warning size={20} aria-hidden className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* PASSO 1: Identidade e Objetivo */}
      {currentStep === 1 && (
        <Card className="border-border/60 bg-card/80 backdrop-blur shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <Robot size={18} aria-hidden />
              </span>
              <CardTitle className="text-xl">{t("Identidade e Propósito do Atendente")}</CardTitle>
            </div>
            <CardDescription>
              {t("Defina como o agente vai se apresentar aos seus clientes no WhatsApp e Instagram.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("Nome do Agente")}</label>
              <Input
                value={form.agentName}
                onChange={(e) => setForm({ ...form, agentName: e.target.value })}
                placeholder={t("Ex: Sofia - Consultora Virtual")}
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">
                {t("Um nome humano ou amigável aumenta em até 35% o engajamento e a taxa de resposta dos leads.")}
              </p>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">{t("Qual é o objetivo principal do atendimento?")}</label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {objectives.map((obj) => (
                  <div
                    key={obj.id}
                    onClick={() => setForm({ ...form, primaryObjective: obj.id as AgentWizardInput["primaryObjective"] })}
                    className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
                      form.primaryObjective === obj.id
                        ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                        : "border-border/60 bg-background/30 hover:border-emerald-500/50 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="font-semibold text-foreground">{obj.title}</div>
                      {obj.badge && (
                        <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-[10px]">
                          {obj.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{obj.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("Descreva com suas palavras o que ele deve fazer:")}</label>
              <Textarea
                rows={3}
                value={form.objectiveDescription}
                onChange={(e) => setForm({ ...form, objectiveDescription: e.target.value })}
                placeholder={t("Ex: Quero que ele atenda as pessoas que entrarem em contato pelo WhatsApp, apresente nossos empreendimentos/serviços, explique valores gerais e pegue o interesse para passar para a equipe comercial.")}
                className="bg-background/50"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* PASSO 2: Tom de Voz e Público */}
      {currentStep === 2 && (
        <Card className="border-border/60 bg-card/80 backdrop-blur shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
                <Users size={18} aria-hidden />
              </span>
              <CardTitle className="text-xl">{t("Tom de Voz e Público-Alvo")}</CardTitle>
            </div>
            <CardDescription>
              {t("Como o agente deve conversar para criar conexão com o perfil ideal dos seus clientes.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <label className="block text-sm font-medium">{t("Escolha o Tom de Voz")}</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tones.map((tone) => (
                  <div
                    key={tone.id}
                    onClick={() => setForm({ ...form, toneOfVoice: tone.id as AgentWizardInput["toneOfVoice"] })}
                    className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
                      form.toneOfVoice === tone.id
                        ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                        : "border-border/60 bg-background/30 hover:border-emerald-500/50 hover:bg-muted/30"
                    }`}
                  >
                    <div className="font-semibold text-foreground">{tone.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{tone.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("Quem é o Público-Alvo principal?")}</label>
              <Input
                value={form.targetAudience}
                onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                placeholder={t("Ex: Famílias buscando imóveis de alto padrão, investidores ou empresários")}
                className="bg-background/50"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("Intensidade no uso de Emojis")}</label>
              <div className="flex gap-3">
                {emojiOptions.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setForm({ ...form, useEmojis: item.id as AgentWizardInput["useEmojis"] })}
                    className={`flex-1 cursor-pointer rounded-lg border p-3 text-center transition-all ${
                      form.useEmojis === item.id
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border/60 bg-background/30 hover:border-emerald-500/30"
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PASSO 3: Superpoderes e Conhecimento */}
      {currentStep === 3 && (
        <Card className="border-border/60 bg-card/80 backdrop-blur shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <Lightning size={18} aria-hidden />
              </span>
              <CardTitle className="text-xl">{t("Superpoderes e Conhecimento do Agente")}</CardTitle>
            </div>
            <CardDescription>
              {t("Escolha quais ferramentas do CRM o agente terá autorização para utilizar durante a conversa.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <label className="block text-sm font-medium">{t("Capacidades e Ações Permitidas:")}</label>
              <div className="space-y-3">
                {capabilityOptions.map((cap) => {
                  const Icon = cap.icon;
                  const isChecked = (form.capabilities as Record<string, boolean>)[cap.key];
                  return (
                    <div
                      key={cap.key}
                      onClick={() =>
                        setForm({
                          ...form,
                          capabilities: {
                            ...form.capabilities,
                            [cap.key]: !isChecked,
                          },
                        })
                      }
                      className={`flex cursor-pointer items-start justify-between rounded-xl border p-4 transition-all duration-200 ${
                        isChecked
                          ? "border-emerald-500/80 bg-emerald-500/10"
                          : "border-border/60 bg-background/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-lg p-2 ${isChecked ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                          <Icon size={16} aria-hidden />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">{cap.title}</div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{cap.desc}</p>
                        </div>
                      </div>
                      <Switch
                        checked={isChecked}
                        onCheckedChange={(val) =>
                          setForm({
                            ...form,
                            capabilities: { ...form.capabilities, [cap.key]: val },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {context.knowledgeSources.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <BookOpen size={14} aria-hidden className="text-emerald-400" />
                  {t("Bases de Conhecimento Conectadas")} ({context.knowledgeSources.length})
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {context.knowledgeSources.map((kb) => (
                    <Badge key={kb.id} variant="secondary" className="gap-1.5 py-1 px-2.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Check size={12} aria-hidden />
                      {kb.title}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PASSO 4: Regras de Ouro e Humanização */}
      {currentStep === 4 && (
        <Card className="border-border/60 bg-card/80 backdrop-blur shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                <ShieldCheck size={18} aria-hidden />
              </span>
              <CardTitle className="text-xl">{t("Humanização e Regras de Segurança")}</CardTitle>
            </div>
            <CardDescription>
              {t("Evite respostas robóticas no WhatsApp e garanta que a IA atue sempre dentro dos limites seguros da sua marca.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              {guardrailOptions.map((guard) => {
                const isChecked = Boolean((form.guardrails as Record<string, unknown>)[guard.key]);
                return (
                  <div
                    key={guard.key}
                    onClick={() =>
                      setForm({
                        ...form,
                        guardrails: {
                          ...form.guardrails,
                          [guard.key]: !isChecked,
                        },
                      })
                    }
                    className={`flex cursor-pointer items-start justify-between rounded-xl border p-4 transition-all duration-200 ${
                      isChecked
                        ? "border-amber-500/60 bg-amber-500/10"
                        : "border-border/60 bg-background/30 hover:border-border"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{guard.title}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{guard.desc}</p>
                    </div>
                    <Switch
                      checked={isChecked}
                      onCheckedChange={(val) =>
                        setForm({
                          ...form,
                          guardrails: { ...form.guardrails, [guard.key]: val },
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium">{t("Palavras-Chave para Chamar Humano")}</label>
              <p className="text-xs text-muted-foreground">
                {t("Se o cliente enviar qualquer uma dessas palavras ou intenções, o agente transfere a conversa para o time humano.")}
              </p>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddKeyword())}
                  placeholder={t("Digite uma palavra ou frase e aperte Enter...")}
                  className="bg-background/50"
                />
                <Button type="button" variant="outline" onClick={handleAddKeyword}>
                  {t("Adicionar")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {form.guardrails.handoffKeywords.map((kw) => (
                  <Badge
                    key={kw}
                    variant="outline"
                    className="cursor-pointer gap-1.5 py-1 px-2.5 text-xs hover:border-red-500/60 hover:bg-red-500/10"
                    onClick={() => handleRemoveKeyword(kw)}
                  >
                    {kw}
                    <span className="text-[10px] text-muted-foreground">×</span>
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PASSO 5: Revisão e Publicação com IA */}
      {currentStep === 5 && blueprint && (
        <Card className="border-emerald-500/40 bg-card/90 backdrop-blur shadow-lg shadow-emerald-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Sparkle size={18} aria-hidden />
                </span>
                <CardTitle className="text-xl">{t("Agente Pronto para Entrar em Produção!")}</CardTitle>
              </div>
              <Badge className="bg-emerald-500 text-black font-semibold">
                {t("Parametrizado via IA")}
              </Badge>
            </div>
            <CardDescription>
              {t("A IA consolidou todo o contexto do")} {context.organizationName} {t("e estruturou as regras ideais para o seu atendimento.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Destaque das Regras e Papel */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-1">
                <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">{t("Papel Estratégico")}</div>
                <div className="text-sm font-medium">{blueprint.summary.role}</div>
                <p className="text-xs text-muted-foreground pt-1">{blueprint.summary.approach}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-2">
                <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">{t("Diretrizes Principais")}</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {blueprint.summary.keyRules.map((rule, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <CheckCircle size={14} aria-hidden className="text-emerald-400 shrink-0 mt-0.5" />
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Visualização e Edição do System Prompt */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium flex items-center gap-2">
                  <ChatsCircle size={16} aria-hidden className="text-emerald-400" />
                  {t("Instruções do Agente (System Prompt Gerado)")}
                </label>
                <span className="text-xs text-muted-foreground">{t("Você pode ajustar o texto abaixo se desejar")}</span>
              </div>
              <Textarea
                rows={12}
                value={blueprint.systemPrompt}
                onChange={(e) => setBlueprint({ ...blueprint, systemPrompt: e.target.value })}
                className="font-mono text-xs leading-relaxed bg-background/80 border-border/80"
              />
            </div>

            {/* Ferramentas Ativadas */}
            <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("Superpoderes Ativados no WhatsApp")} ({blueprint.suggestedTools.length}):
              </div>
              <div className="flex flex-wrap gap-2">
                {blueprint.suggestedTools.map((tool) => (
                  <Badge key={tool} variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs">
                    ⚡ {tool}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Barra de Navegação Inferior */}
      <div className="flex items-center justify-between pt-2">
        {currentStep > 1 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCurrentStep((prev) => prev - 1)}
            disabled={isGenerating || isPublishing}
            className="gap-2"
          >
            <ArrowLeft size={16} aria-hidden />
            {t("Voltar")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/app/ai/agents")}
            className="text-muted-foreground"
          >
            {t("Cancelar")}
          </Button>
        )}

        {currentStep < 4 && (
          <Button
            type="button"
            onClick={() => setCurrentStep((prev) => prev + 1)}
            className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
          >
            {t("Continuar")}
            <ArrowRight size={16} aria-hidden />
          </Button>
        )}

        {currentStep === 4 && (
          <Button
            type="button"
            onClick={handleGenerateBlueprint}
            disabled={isGenerating}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-md shadow-emerald-500/20 px-6"
          >
            {isGenerating ? (
              <>
                <CircleNotch size={16} aria-hidden className="animate-spin" />
                {t("Criando Agente com IA...")}
              </>
            ) : (
              <>
                <Sparkle size={16} aria-hidden />
                {t("Gerar Configuração com IA")}
              </>
            )}
          </Button>
        )}

        {currentStep === 5 && (
          <Button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing}
            className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 px-8 font-semibold"
          >
            {isPublishing ? (
              <>
                <CircleNotch size={16} aria-hidden className="animate-spin" />
                {t("Publicando no WhatsApp...")}
              </>
            ) : (
              <>
                <Check size={16} aria-hidden />
                {t("Publicar e Ativar com 1 Clique")}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
