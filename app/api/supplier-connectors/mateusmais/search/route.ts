import { NextResponse } from "next/server";
import { normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { isMateusMaisConnectorConfigured, searchMateusMaisConnector } from "@/lib/supplier-web-connectors";

export const runtime = "nodejs";

function canUseSupplierConnector(role: string, sector: string) {
  return role === "admin" || normalizePermissionSector(sector).startsWith("compras");
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canUseSupplierConnector(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Compras." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { query?: string; persist?: boolean };
    const query = String(body.query || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Informe o produto, EAN ou codigo para buscar." }, { status: 400 });
    }

    if (!isMateusMaisConnectorConfigured()) {
      return NextResponse.json({
        code: "MATEUS_MAIS_NOT_CONFIGURED",
        error: "Conector Mateus Mais ainda nao configurado.",
        nextStep: "Defina MATEUS_MAIS_SEARCH_URL no servidor.",
      }, { status: 400 });
    }

    const offers = await searchMateusMaisConnector({
      query,
      persist: body.persist !== false,
      importedBy: auth.userId,
    });

    return NextResponse.json({ offers, count: offers.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel consultar Mateus Mais.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
