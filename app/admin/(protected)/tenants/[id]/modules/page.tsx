import { TenantModulesClient } from "./_client";

interface TenantModulesPageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "Módulos da Empresa — Admin",
};

export default async function TenantModulesPage({ params }: TenantModulesPageProps) {
  const { id } = await params;
  return <TenantModulesClient id={id} />;
}
