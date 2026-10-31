"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  Globe,
  MapPin,
  FolderOpen,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
  ShoppingBag,
  Clock,
  ArrowRight,
  ShieldCheck,
  Palette,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  Image as ImageIcon,
  Type,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { slugifyEmpresa } from "@/lib/tenants/slug-pure";
import type {
  AutonomousExtractionInput,
  AutonomousExtractionOutput,
  GapItem,
} from "@/lib/onboarding/autonomous-types";

interface Props {
  organizationId: string;
  initialOrgName?: string;
  initialSlug?: string;
  onFinishedRedirect?: string;
}

type WizardStep = "upload" | "processing" | "gaps" | "review" | "success";

function InstagramIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
    </svg>
  );
}

// Catálogo de cores conhecidas para busca e seleção rápida
const CORES_CONHECIDAS: Array<{ name: string; hex: string; category: string }> = [
  { name: "Azul Marinho Nobre", hex: "#001b4a", category: "Azuis" },
  { name: "Dourado Mendes", hex: "#e1b63c", category: "Dourados" },
  { name: "Azul Ciano Corporativo", hex: "#009fe3", category: "Azuis" },
  { name: "Azul Royal Institucional", hex: "#1e3470", category: "Azuis" },
  { name: "Azul Celeste Vivo", hex: "#159cd8", category: "Azuis" },
  { name: "Azul Noturno", hex: "#066aab", category: "Azuis" },
  { name: "Verde Esmeralda", hex: "#10b981", category: "Verdes" },
  { name: "Verde Floresta", hex: "#065f46", category: "Verdes" },
  { name: "Verde Oliva", hex: "#506d48", category: "Verdes" },
  { name: "Laranja Vibrante", hex: "#f97316", category: "Laranjas" },
  { name: "Dourado Ouro", hex: "#d97706", category: "Dourados" },
  { name: "Vermelho Rubi", hex: "#dc2626", category: "Vermelhos" },
  { name: "Vinho Marsala", hex: "#881337", category: "Vermelhos" },
  { name: "Roxo Real", hex: "#7c3aed", category: "Roxos" },
  { name: "Grafite Escuro", hex: "#1e293b", category: "Neutros" },
  { name: "Preto Nobre", hex: "#0f172a", category: "Neutros" },
  { name: "Cinza Titânio", hex: "#475569", category: "Neutros" },
  { name: "Prata Alumínio", hex: "#94a3b8", category: "Neutros" },
];

const FONTES_GOOGLE_TITULOS = [
  "Lato",
  "Inter",
  "Montserrat",
  "Poppins",
  "Playfair Display",
  "Outfit",
  "Roboto",
  "Plus Jakarta Sans",
  "Cinzel",
  "Merriweather",
  "Raleway",
  "Oswald",
];

const FONTES_GOOGLE_TEXTOS = [
  "Lato",
  "Inter",
  "Open Sans",
  "Roboto",
  "DM Sans",
  "Nunito",
  "Work Sans",
  "Source Sans 3",
];

export function AutonomousSetupWizard({
  organizationId,
  initialOrgName,
  initialSlug,
  onFinishedRedirect = "/app/inbox",
}: Props) {
  const [step, setStep] = useState<WizardStep>("upload");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagram, setInstagram] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [driveLinks, setDriveLinks] = useState("");
  const [freeformNotes, setFreeformNotes] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; type: string; size?: number; text?: string; base64_data?: string }>>([]);
  const [showManual, setShowManual] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  // Estado da extração e edição
  const [blueprint, setBlueprint] = useState<AutonomousExtractionOutput | null>(null);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // Estado do Modal/Popover de Cores
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null);
  const [colorSearchTerm, setColorSearchTerm] = useState("");
  const [customHexInput, setCustomHexInput] = useState("");

  // Handlers de Upload de Logo Dedicado
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setLogoPreview(b64);
      if (blueprint) {
        setBlueprint({
          ...blueprint,
          brand_identity: {
            ...blueprint.brand_identity,
            logo_url: b64,
          },
        });
      }
      toast.success("Logotipo carregado com sucesso!");
    };
    reader.readAsDataURL(file);
  };

  // Handlers de Upload e Extração de Arquivos em Tempo Real
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploadingFiles(true);
    const toastId = toast.loading(`Processando ${selectedFiles.length} arquivo(s)...`);

    try {
      const processed: typeof files = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const f = selectedFiles[i];
        if (!f) continue;

        if (
          f.type.startsWith("text/") ||
          f.name.endsWith(".md") ||
          f.name.endsWith(".csv") ||
          f.name.endsWith(".txt")
        ) {
          const text = await f.text();
          processed.push({ name: f.name, type: f.type || "text/plain", size: f.size, text });
          continue;
        }

        const formData = new FormData();
        formData.append("file", f);

        try {
          const res = await fetch("/api/v1/onboarding/autonomous/upload-file", {
            method: "POST",
            body: formData,
          });

          if (res.ok) {
            const json = await res.json();
            if (json.data) {
              processed.push({
                name: json.data.name || f.name,
                type: json.data.type || f.type,
                size: json.data.size || f.size,
                text: json.data.text,
                base64_data: json.data.base64_data,
              });
              // Se for imagem e parecer logotipo, atualiza preview do logo
              if (
                json.data.base64_data &&
                (f.name.toLowerCase().includes("logo") || f.name.toLowerCase().includes("marca"))
              ) {
                setLogoPreview(json.data.base64_data);
              }
              continue;
            }
          }
        } catch {
          // Degrada para leitura direta se endpoint falhar
        }

        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(f);
        });

        processed.push({
          name: f.name,
          type: f.type,
          size: f.size,
          base64_data: f.type.startsWith("image/") ? base64 : undefined,
        });
      }

      setFiles((prev) => [...prev, ...processed]);
      toast.success(`${processed.length} arquivo(s) adicionados e preparados!`, { id: toastId });
    } catch {
      toast.error("Erro ao carregar alguns arquivos.", { id: toastId });
    } finally {
      setUploadingFiles(false);
      e.target.value = "";
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Disparo da Análise de IA
  const handleStartExtraction = async () => {
    if (!websiteUrl && !instagram && !freeformNotes && files.length === 0 && !driveLinks) {
      toast.error("Por favor, envie ao menos um site, documento ou instrução sobre a empresa.");
      return;
    }

    setStep("processing");

    const payloadFiles: NonNullable<AutonomousExtractionInput["files"]> = files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      text: f.text,
      base64_data: f.type.startsWith("image/") ? f.base64_data : undefined,
    }));

    if (logoPreview && !payloadFiles.some((f) => f.name === "logo_empresa.png")) {
      payloadFiles.unshift({
        name: "logo_empresa.png",
        type: "image/png",
        size: undefined,
        text: undefined,
        base64_data: logoPreview,
      });
    }

    const payload: AutonomousExtractionInput = {
      website_url: websiteUrl.trim() || undefined,
      instagram: instagram.trim() || undefined,
      google_maps_url: googleMapsUrl.trim() || undefined,
      drive_links: driveLinks ? driveLinks.split("\n").map((l) => l.trim()).filter(Boolean) : undefined,
      freeform_notes: freeformNotes.trim() || undefined,
      files: payloadFiles,
    };

    try {
      const res = await fetch("/api/v1/onboarding/autonomous/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "Falha na análise dos dados.");
      }

      const json = await res.json();
      const rawBlueprint = json?.data?.blueprint || json?.data || json;

      if (!rawBlueprint || typeof rawBlueprint !== "object" || !("brand_identity" in rawBlueprint)) {
        throw new Error("Não foi possível carregar a identidade da empresa a partir dos materiais.");
      }

      const extractedBlueprint: AutonomousExtractionOutput = rawBlueprint as AutonomousExtractionOutput;

      // Garantir que as cores e fontes estejam bem formatadas
      const brand = extractedBlueprint.brand_identity;
      const initialColors = brand.colors && brand.colors.length > 0
        ? brand.colors
        : [brand.primary_color || "#001b4a", brand.secondary_color || "#e1b63c", brand.accent_color || "#009fe3"];

      extractedBlueprint.brand_identity.colors = initialColors.slice(0, 5);
      extractedBlueprint.brand_identity.font_primary = brand.font_primary || "Lato";
      extractedBlueprint.brand_identity.font_secondary = brand.font_secondary || "Inter";

      if (logoPreview && !extractedBlueprint.brand_identity.logo_url) {
        extractedBlueprint.brand_identity.logo_url = logoPreview;
      }

      setBlueprint(extractedBlueprint);

      if (extractedBlueprint.gaps_found && extractedBlueprint.gaps_found.length > 0) {
        setStep("gaps");
      } else {
        setStep("review");
      }

      toast.success("Dados analisados com sucesso pelo motor de IA!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao processar extração.";
      toast.error(msg);
      setStep("upload");
    }
  };

  // Gerenciamento de Cores
  const handleSelectColor = (hex: string) => {
    if (!blueprint) return;
    const currentColors = [...(blueprint.brand_identity.colors || ["#001b4a", "#e1b63c"])];

    if (editingColorIndex !== null && editingColorIndex < currentColors.length) {
      currentColors[editingColorIndex] = hex;
    } else if (currentColors.length < 5) {
      currentColors.push(hex);
    }

    setBlueprint({
      ...blueprint,
      brand_identity: {
        ...blueprint.brand_identity,
        colors: currentColors,
        primary_color: currentColors[0] || "#001b4a",
        secondary_color: currentColors[1] || currentColors[0] || "#e1b63c",
        accent_color: currentColors[2] || currentColors[1] || "#009fe3",
      },
    });

    setEditingColorIndex(null);
    setColorSearchTerm("");
    setCustomHexInput("");
    toast.success(`Cor ${hex} definida!`);
  };

  const handleRemoveColor = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!blueprint) return;
    const currentColors = (blueprint.brand_identity.colors || []).filter((_, i) => i !== idx);
    if (currentColors.length === 0) currentColors.push("#001b4a");

    setBlueprint({
      ...blueprint,
      brand_identity: {
        ...blueprint.brand_identity,
        colors: currentColors,
        primary_color: currentColors[0] || "#001b4a",
        secondary_color: currentColors[1] || currentColors[0] || "#e1b63c",
        accent_color: currentColors[2] || currentColors[1] || "#009fe3",
      },
    });
  };

  // Atualização dos Gaps
  const handleAdvanceFromGaps = () => {
    if (!blueprint) return;

    const updated = { ...blueprint };
    if (gapAnswers["operating_hours"]) {
      updated.business_rules.operating_hours = gapAnswers["operating_hours"];
    }
    if (gapAnswers["company_name"]) {
      updated.brand_identity.name = gapAnswers["company_name"];
      updated.brand_identity.slug = slugifyEmpresa(gapAnswers["company_name"]);
    }
    setBlueprint(updated);
    setStep("review");
  };

  // Aplicação e ativação final do Blueprint
  const handleApplyBlueprint = async () => {
    if (!blueprint) return;
    setIsApplying(true);
    const toastId = toast.loading("Ativando configurações no NexusCRMAgent...");

    try {
      const res = await fetch("/api/v1/onboarding/autonomous/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blueprint }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "Falha ao ativar o blueprint.");
      }

      toast.success("NexusCRMAgent configurado e pronto para operar!", { id: toastId });
      setStep("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao aplicar configurações.";
      toast.error(msg, { id: toastId });
    } finally {
      setIsApplying(false);
    }
  };

  const tenantDirectUrl = blueprint
    ? `${typeof window !== "undefined" ? window.location.origin : "https://crm.nexusia.work"}/${blueprint.brand_identity.slug}`
    : "";

  const copyTenantLink = () => {
    if (!tenantDirectUrl) return;
    navigator.clipboard.writeText(tenantDirectUrl);
    setCopiedLink(true);
    toast.success("Link do tenant copiado para a área de transferência!");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const copyMarkdown = () => {
    if (!blueprint?.master_knowledge_markdown) return;
    navigator.clipboard.writeText(blueprint.master_knowledge_markdown);
    toast.success("Base de conhecimento completa copiada em Markdown!");
  };

  // Cores filtradas pela busca
  const filteredCores = CORES_CONHECIDAS.filter(
    (c) =>
      c.name.toLowerCase().includes(colorSearchTerm.toLowerCase()) ||
      c.hex.toLowerCase().includes(colorSearchTerm.toLowerCase()) ||
      c.category.toLowerCase().includes(colorSearchTerm.toLowerCase())
  );

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* CABEÇALHO DO ASSISTENTE */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-primary font-medium text-xs tracking-wide uppercase">
          <Sparkles className="size-4" />
          <span>Configuração Autônoma NexusCRMAgent</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Assistente de Configuração Inteligente
        </h1>
        <p className="text-sm text-muted-foreground">
          Envie os materiais que já possui (site, Instagram, PDFs de propostas, fotos de panfletos, links no Drive). Nossa inteligência artificial extrai toda a identidade, regras comerciais e ativa o CRM pronto para operar.
        </p>
      </div>

      {/* ETAPA 1: ENVIO DE MATERIAIS */}
      {step === "upload" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
          {/* Logo Dedicado */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 font-semibold text-sm">
              <ImageIcon className="size-4 text-primary" />
              <span>Logotipo da Empresa (PNG, SVG, JPG ou WebP)</span>
            </Label>
            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 border border-border rounded-lg bg-surface/30">
              {logoPreview ? (
                <div className="relative size-20 rounded-lg border border-border bg-background p-1 flex items-center justify-center shrink-0">
                  <img src={logoPreview} alt="Logo Preview" className="max-h-full max-w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setLogoPreview(null)}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground size-5 rounded-full flex items-center justify-center text-xs"
                    title="Remover"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="size-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                  <ImageIcon className="size-6" />
                </div>
              )}
              <div className="flex-1 space-y-1 text-center sm:text-left">
                <p className="text-xs text-muted-foreground">
                  Selecione o logo oficial da empresa para a tela de login personalizada e branding do WhatsApp.
                </p>
                <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium cursor-pointer transition-colors">
                  <Upload className="size-3.5" />
                  <span>{logoPreview ? "Alterar Logotipo" : "Selecionar Logotipo"}</span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          {/* Links Principais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="website_url" className="flex items-center gap-1.5">
                <Globe className="size-3.5 text-muted-foreground" />
                <span>Site Oficial</span>
              </Label>
              <Input
                id="website_url"
                placeholder="https://grupomendes.com.br/"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                Lemos o HTML, paleta no CSS, fontes do Google e logotipo diretamente.
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instagram" className="flex items-center gap-1.5">
                <InstagramIcon className="size-3.5 text-muted-foreground" />
                <span>Instagram Comercial</span>
              </Label>
              <Input
                id="instagram"
                placeholder="https://www.instagram.com/grupomendesoficial/"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                Para capturar o tom de voz e integrar leads do Direct.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="google_maps_url" className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted-foreground" />
                <span>Google Maps / Google Meu Negócio</span>
              </Label>
              <Input
                id="google_maps_url"
                placeholder="Link da localização da empresa"
                value={googleMapsUrl}
                onChange={(e) => setGoogleMapsUrl(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="drive_links" className="flex items-center gap-1.5">
                <FolderOpen className="size-3.5 text-muted-foreground" />
                <span>Pasta de Arquivos (Google Drive / OneDrive)</span>
              </Label>
              <Input
                id="drive_links"
                placeholder="Link compartilhado de pasta ou arquivos"
                value={driveLinks}
                onChange={(e) => setDriveLinks(e.target.value)}
              />
            </div>
          </div>

          {/* Área de Arquivos (Drop-Zone) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <FileText className="size-3.5 text-muted-foreground" />
              <span>Arquivos de Apresentação, Tabelas e Fichas Técnicas (PDF, Markdown, Imagens, CSV)</span>
            </Label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border hover:border-primary/50 bg-surface/30 rounded-lg p-6 cursor-pointer transition-colors relative">
              {uploadingFiles ? (
                <div className="flex flex-col items-center gap-2 text-primary">
                  <Loader2 className="size-8 animate-spin" />
                  <span className="text-sm font-medium">Extraindo texto dos documentos no servidor...</span>
                  <span className="text-xs text-muted-foreground">Por favor aguarde alguns instantes</span>
                </div>
              ) : (
                <>
                  <Upload className="size-8 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">Clique para selecionar ou arraste arquivos aqui</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    Suporta múltiplos PDFs, imagens, Markdown (.md), CSV e TXT (sem limite de arquivos)
                  </span>
                </>
              )}
              <input
                type="file"
                multiple
                disabled={uploadingFiles}
                accept=".pdf,.md,.txt,.csv,image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            {/* Lista de Arquivos Carregados */}
            {files.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                  Arquivos prontos para análise ({files.length}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-md border border-border bg-surface text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="size-4 shrink-0 text-primary" />
                        <span className="truncate font-medium">{file.name}</span>
                        {file.text && (
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-mono shrink-0">
                            Texto Extraído
                          </span>
                        )}
                        {file.base64_data && (
                          <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-mono shrink-0">
                            Imagem
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="text-destructive hover:underline text-[11px] shrink-0 ml-2"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notas Livres e Cenários */}
          <div className="space-y-1.5">
            <Label htmlFor="freeform_notes">Observações do Negócio e Cenários Especiais</Label>
            <Textarea
              id="freeform_notes"
              rows={3}
              placeholder="Ex.: 'Empresa: Grupo Mendes. Foco em imóveis e loteamentos de alto padrão. Condições de 20% entrada e restante em até 60x direto. Horário comercial seg a sex 8h às 18h.'"
              value={freeformNotes}
              onChange={(e) => setFreeformNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <Button onClick={handleStartExtraction} className="gap-2 bg-primary text-primary-foreground font-semibold px-6">
              <Sparkles className="size-4" />
              <span>Iniciar Análise e Parametrização Autônoma</span>
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ETAPA 2: PROCESSAMENTO */}
      {step === "processing" && (
        <div className="rounded-xl border bg-card p-12 text-center shadow-sm space-y-6">
          <div className="inline-flex p-4 rounded-full bg-primary/10 text-primary animate-pulse">
            <Sparkles className="size-10" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-bold">Analisando materiais com Google Gemini Flash...</h3>
            <p className="text-xs text-muted-foreground">
              Estamos realizando o web scraping do site oficial, analisando a paleta de cores no CSS, fontes do Google, logotipo e processando o texto de todos os documentos anexados.
            </p>
          </div>
          <div className="space-y-2.5 max-w-sm mx-auto text-left text-xs">
            <div className="flex items-center gap-2 text-primary font-medium">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Extraindo cores e tipografia do site...</span>
            </div>
            <div className="flex items-center gap-2 text-primary font-medium">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Lendo fichas técnicas, tabelas e propostas comerciais...</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground animate-pulse font-medium">
              <span className="size-2 rounded-full bg-primary" />
              <span>Estruturando base de conhecimento e funil de vendas...</span>
            </div>
          </div>
        </div>
      )}

      {/* ETAPA 3: GAPS E PERGUNTAS COMPLEMENTARES */}
      {step === "gaps" && blueprint && (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-amber-500 font-medium text-xs">
              <AlertCircle className="size-4" />
              <span>Ajustes Finais Recomendados</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight">Complete algumas informações pontuais</h2>
            <p className="text-xs text-muted-foreground">
              A IA mapeou a maior parte dos dados, mas precisa de confirmação para os pontos abaixo.
            </p>
          </div>

          <div className="space-y-4">
            {blueprint.gaps_found.map((gap, idx) => (
              <div key={idx} className="p-4 rounded-lg border border-border bg-surface/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{gap.title}</span>
                  <span className="text-[11px] text-muted-foreground italic">{gap.why_needed}</span>
                </div>
                <p className="text-xs text-muted-foreground">{gap.description}</p>
                <Input
                  placeholder={gap.example_value}
                  value={gapAnswers[gap.field] || ""}
                  onChange={(e) => setGapAnswers({ ...gapAnswers, [gap.field]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setStep("review")}>
              Pular e Revisar
            </Button>
            <Button onClick={handleAdvanceFromGaps} className="gap-2">
              <span>Salvar e Revisar Blueprint</span>
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ETAPA 4: REVISÃO COMPLETA E EDIÇÃO */}
      {step === "review" && blueprint && (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-border">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 font-semibold text-xs mb-1">
                <CheckCircle2 className="size-4" />
                <span>Blueprint Parametrizado com Sucesso</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Revise a Configuração do CRM</h2>
              <p className="text-xs text-muted-foreground">
                Todos os dados foram extraídos. Você pode editar o nome, cores, fontes e logotipo antes de ativar.
              </p>
            </div>
            <div className="text-left sm:text-right p-2.5 rounded-lg bg-surface border border-border">
              <span className="text-[11px] text-muted-foreground block">Link Direto via Tenant:</span>
              <span className="font-mono text-xs font-bold text-primary">/{blueprint.brand_identity.slug}</span>
            </div>
          </div>

          {/* CARD DA IDENTIDADE VISUAL EDITÁVEL */}
          <div className="rounded-xl border border-border p-5 bg-surface/40 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-primary" />
                <h3 className="text-sm font-bold">Identidade Visual da Marca</h3>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {blueprint.brand_identity.font_primary || "Lato"} / {blueprint.brand_identity.font_secondary || "Inter"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Logo Preview & Upload */}
              <div className="space-y-1.5">
                <Label className="text-xs">Logotipo Oficial</Label>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
                  {blueprint.brand_identity.logo_url ? (
                    <img
                      src={blueprint.brand_identity.logo_url}
                      alt="Logo"
                      className="size-12 object-contain rounded bg-muted/40 p-1 shrink-0"
                    />
                  ) : (
                    <div className="size-12 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                      <ImageIcon className="size-5" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-primary hover:underline cursor-pointer block font-medium">
                      <span>Alterar Arquivo</span>
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    <Input
                      placeholder="Ou cole a URL do Logo"
                      value={blueprint.brand_identity.logo_url || ""}
                      onChange={(e) =>
                        setBlueprint({
                          ...blueprint,
                          brand_identity: { ...blueprint.brand_identity, logo_url: e.target.value },
                        })
                      }
                      className="h-7 text-[11px]"
                    />
                  </div>
                </div>
              </div>

              {/* Nome da Empresa */}
              <div className="space-y-1.5">
                <Label htmlFor="edit_org_name" className="text-xs font-semibold">
                  Nome Oficial da Empresa (Com espaços e acentos)
                </Label>
                <Input
                  id="edit_org_name"
                  value={blueprint.brand_identity.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setBlueprint({
                      ...blueprint,
                      brand_identity: {
                        ...blueprint.brand_identity,
                        name: newName,
                        slug: slugifyEmpresa(newName),
                      },
                    });
                  }}
                  placeholder="Ex.: Grupo Mendes"
                  className="font-semibold text-sm"
                />
                <span className="text-[11px] text-muted-foreground">
                  Exibido na tela de login e nas mensagens com o cliente.
                </span>
              </div>

              {/* Slug do Tenant */}
              <div className="space-y-1.5">
                <Label htmlFor="edit_org_slug" className="text-xs font-semibold">
                  Slug do Tenant (Acesso URL)
                </Label>
                <Input
                  id="edit_org_slug"
                  value={blueprint.brand_identity.slug}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const cleanSlug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
                    setBlueprint({
                      ...blueprint,
                      brand_identity: {
                        ...blueprint.brand_identity,
                        slug: cleanSlug,
                      },
                    });
                  }}
                  placeholder="grupomendes"
                  className="font-mono text-xs text-primary font-bold"
                />
                <span className="text-[11px] text-muted-foreground">
                  Acesso: <strong>crm.nexusia.work/{blueprint.brand_identity.slug}</strong>
                </span>
              </div>
            </div>

            {/* PALETA DE CORES (ATÉ 5 CORES COM SELETOR INTERATIVO) */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Palette className="size-3.5 text-primary" />
                  <span>Paleta de Cores da Marca (até 5 cores no total)</span>
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Clique na cor para alterar pelo nome ou código
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(blueprint.brand_identity.colors || ["#001b4a", "#e1b63c", "#009fe3"]).map((hex, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setEditingColorIndex(idx);
                      setCustomHexInput(hex);
                    }}
                    className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5 bg-background hover:border-primary/60 cursor-pointer transition-all shadow-sm"
                    title={`Clique para alterar a cor ${idx + 1}`}
                  >
                    <span
                      className="size-5 rounded-full border border-black/10 shrink-0"
                      style={{ backgroundColor: hex }}
                    />
                    <span className="font-mono text-xs font-semibold">{hex}</span>
                    <span className="text-[10px] text-muted-foreground font-sans">
                      {idx === 0 ? "(Primária)" : idx === 1 ? "(Secundária)" : idx === 2 ? "(Destaque)" : ""}
                    </span>
                    {(blueprint.brand_identity.colors?.length || 0) > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleRemoveColor(idx, e)}
                        className="text-muted-foreground hover:text-destructive text-xs ml-1"
                        title="Remover cor"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {(blueprint.brand_identity.colors?.length || 0) < 5 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingColorIndex(blueprint.brand_identity.colors?.length || 0);
                      setCustomHexInput("#001b4a");
                    }}
                    className="gap-1.5 text-xs h-8"
                  >
                    <Plus className="size-3.5" />
                    <span>Adicionar Cor</span>
                  </Button>
                )}
              </div>
            </div>

            {/* SELEÇÃO DE DUAS FONTES DO GOOGLE */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Type className="size-3.5 text-primary" />
                  <span>Fonte Primária (Títulos e Destaques)</span>
                </Label>
                <select
                  value={blueprint.brand_identity.font_primary || "Lato"}
                  onChange={(e) =>
                    setBlueprint({
                      ...blueprint,
                      brand_identity: {
                        ...blueprint.brand_identity,
                        font_primary: e.target.value,
                        typography_style: `${e.target.value} / ${blueprint.brand_identity.font_secondary || "Inter"}`,
                      },
                    })
                  }
                  className="w-full text-xs rounded-md border border-input bg-background px-3 py-2"
                >
                  {FONTES_GOOGLE_TITULOS.map((f) => (
                    <option key={f} value={f}>
                      {f} (Google Fonts)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Type className="size-3.5 text-muted-foreground" />
                  <span>Fonte Secundária (Textos e Leituras)</span>
                </Label>
                <select
                  value={blueprint.brand_identity.font_secondary || "Inter"}
                  onChange={(e) =>
                    setBlueprint({
                      ...blueprint,
                      brand_identity: {
                        ...blueprint.brand_identity,
                        font_secondary: e.target.value,
                        typography_style: `${blueprint.brand_identity.font_primary || "Lato"} / ${e.target.value}`,
                      },
                    })
                  }
                  className="w-full text-xs rounded-md border border-input bg-background px-3 py-2"
                >
                  {FONTES_GOOGLE_TEXTOS.map((f) => (
                    <option key={f} value={f}>
                      {f} (Google Fonts)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* PRODUTOS, SERVIÇOS E FUNIL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Catálogo de Produtos / Empreendimentos */}
            <div className="rounded-xl border border-border p-4 bg-surface/40 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold">
                    Catálogo Extraído ({blueprint.catalog.length})
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground">{blueprint.niche}</span>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {blueprint.catalog.map((item, idx) => (
                  <div key={idx} className="p-2.5 rounded bg-background border border-border text-xs flex justify-between items-start">
                    <div className="space-y-0.5">
                      <span className="font-semibold block">{item.name}</span>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{item.description}</p>
                      <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono">
                        {item.category}
                      </span>
                    </div>
                    <span className="font-bold text-primary text-xs shrink-0 ml-2">
                      {item.price_cents > 0
                        ? (item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "Sob Consulta"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Funil de Vendas */}
            <div className="rounded-xl border border-border p-4 bg-surface/40 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold">
                    Funil sob Medida ({blueprint.sales_funnel.stages.length} etapas)
                  </h3>
                </div>
                <span className="text-[11px] text-muted-foreground">Horário: {blueprint.business_rules.operating_hours}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {blueprint.sales_funnel.stages.map((st, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-background"
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: st.color || "#3b82f6" }} />
                    <span>
                      {idx + 1}. {st.name}
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-2.5 rounded bg-background border border-border text-xs space-y-1 mt-2">
                <span className="font-semibold block">Gatilhos de Transbordo Humano:</span>
                <p className="text-[11px] text-muted-foreground">
                  {blueprint.human_handoff.trigger_keywords.join(", ")}
                </p>
              </div>
            </div>
          </div>

          {/* BASE DE CONHECIMENTO MESTRE EM MARKDOWN (EXPANDIDA E COMPLETA) */}
          <div className="rounded-xl border border-border p-5 bg-surface/40 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <h3 className="text-sm font-bold">Base de Conhecimento Mestre Extraída (Markdown Oficial)</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">
                  {blueprint.master_knowledge_markdown.length.toLocaleString("pt-BR")} caracteres extraídos
                </span>
                <Button size="sm" variant="outline" onClick={copyMarkdown} className="gap-1.5 text-xs h-7">
                  <Copy className="size-3.5" />
                  <span>Copiar Markdown</span>
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Abaixo está o acervo integral compilado a partir de todos os seus 18 arquivos, sites e tabelas. Este documento alimenta o cérebro do agente de IA e os atendentes.
            </p>

            <Textarea
              rows={12}
              value={blueprint.master_knowledge_markdown}
              onChange={(e) => setBlueprint({ ...blueprint, master_knowledge_markdown: e.target.value })}
              className="font-mono text-xs bg-background leading-relaxed whitespace-pre-wrap"
            />
          </div>

          {/* BOTÕES DE AÇÃO */}
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setStep("upload")} disabled={isApplying}>
              Voltar e Adicionar Mais Materiais
            </Button>
            <Button
              onClick={handleApplyBlueprint}
              disabled={isApplying}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 shadow-md"
            >
              <Sparkles className="size-4" />
              <span>{isApplying ? "Ativando no Servidor..." : "Ativar NexusCRMAgent com 1 Clique"}</span>
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ETAPA 5: SUCESSO & ATIVAÇÃO CONCLUÍDA */}
      {step === "success" && blueprint && (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm space-y-6">
          <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-12" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-2xl font-bold tracking-tight">
              {blueprint.brand_identity.name} está Configurado e no Ar! 🚀
            </h2>
            <p className="text-xs text-muted-foreground">
              Seu assistente de vendas, catálogo de produtos, funil comercial e base de conhecimento estão operando.
            </p>
          </div>

          {/* Link direto do Tenant */}
          <div className="max-w-md mx-auto p-4 rounded-xl border border-primary/20 bg-primary/5 text-left space-y-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span>🔗 Link de Acesso Direto da Empresa (Tenant):</span>
            </span>
            <div className="flex items-center gap-2">
              <Input readOnly value={tenantDirectUrl} className="font-mono text-xs bg-background font-bold text-primary" />
              <Button size="sm" variant="outline" onClick={copyTenantLink} className="gap-1.5 shrink-0">
                {copiedLink ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                <span>{copiedLink ? "Copiado!" : "Copiar"}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Ao entrar por este link, sua equipe verá a tela de login personalizada com o nome e logo do {blueprint.brand_identity.name}.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3 pt-4">
            <Button asChild variant="outline">
              <a href="/onboarding/connect-whatsapp" className="gap-2">
                <span>Conectar WhatsApp (QR Code)</span>
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button asChild className="bg-primary text-primary-foreground font-semibold px-6">
              <a href={onFinishedRedirect} className="gap-2">
                <span>Ir para a Caixa de Entrada (Inbox)</span>
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* MODAL / POPOVER DE SELEÇÃO DE COR */}
      {editingColorIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-primary" />
                <h3 className="font-bold text-sm">
                  {editingColorIndex < (blueprint?.brand_identity.colors?.length || 0)
                    ? `Alterar Cor ${editingColorIndex + 1}`
                    : "Adicionar Nova Cor"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingColorIndex(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Input customizado com color picker nativo e digitação */}
            <div className="space-y-1.5">
              <Label className="text-xs">Digite o Código #HEX ou Escolha no Seletor:</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customHexInput.startsWith("#") && customHexInput.length === 7 ? customHexInput : "#001b4a"}
                  onChange={(e) => setCustomHexInput(e.target.value)}
                  className="size-9 rounded border border-border cursor-pointer p-0.5 shrink-0 bg-transparent"
                />
                <Input
                  value={customHexInput}
                  onChange={(e) => setCustomHexInput(e.target.value)}
                  placeholder="#001b4a ou #e1b63c"
                  className="font-mono text-xs uppercase"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (/^#[0-9a-fA-F]{3,8}$/.test(customHexInput)) {
                      handleSelectColor(customHexInput);
                    } else {
                      toast.error("Formato hexadecimal inválido (ex: #001b4a)");
                    }
                  }}
                  className="shrink-0 text-xs"
                >
                  Confirmar
                </Button>
              </div>
            </div>

            {/* Busca por Nome de Cor */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar cor (ex: dourado, azul, marinho, verde)..."
                  value={colorSearchTerm}
                  onChange={(e) => setColorSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>

              {/* Grid de Cores Reconhecidas */}
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {filteredCores.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => handleSelectColor(c.hex)}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-primary/60 bg-surface text-left transition-colors"
                  >
                    <span className="size-4 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: c.hex }} />
                    <div className="overflow-hidden">
                      <span className="text-xs font-medium block truncate">{c.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{c.hex}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingColorIndex(null)} className="text-xs">
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
