import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { fetchPurchaseAssistantExportRows } from "@/lib/purchase-assistant";
import { requireAuthenticatedProfile } from "@/lib/server-auth";

export const runtime = "nodejs";

function normalizeSector(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "itens";
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const normalizedSector = normalizeSector(auth.profile.sector || "");
    const canUseAssistant = auth.profile.role === "admin" || normalizedSector.startsWith("compras");

    if (!canUseAssistant) {
      return NextResponse.json({ error: "Exportacao liberada apenas para Admin ou setor Compras." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { query?: string };
    const query = String(body.query || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Informe a descricao, EAN, fornecedor ou marca para exportar." }, { status: 400 });
    }

    const rows = await fetchPurchaseAssistantExportRows(query);
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{
      EAN: "",
      SKU: "",
      Descricao: "Nenhum item disponivel encontrado para o filtro.",
      Fornecedor: "",
      Estoque: "",
      Preco: "",
    }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Itens disponiveis");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fileName = `itens-disponiveis-${safeFileName(query)}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel exportar a planilha.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
