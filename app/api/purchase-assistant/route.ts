import { NextResponse } from "next/server";
import { runPurchaseAssistant, type PurchaseAssistantRequest } from "@/lib/purchase-assistant";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requireAuthenticatedProfile } from "@/lib/server-auth";

export const runtime = "nodejs";

function normalizeSector(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const retrySeconds = checkRateLimit(`purchase-assistant:${auth.userId}`, 30, 60_000);
    if (retrySeconds !== null) return rateLimitResponse(retrySeconds);

    const normalizedSector = normalizeSector(auth.profile.sector || "");
    const canUseAssistant = auth.profile.role === "admin" || normalizedSector.startsWith("compras");

    if (!canUseAssistant) {
      return NextResponse.json({ error: "Assistente liberado apenas para Admin ou setor Compras." }, { status: 403 });
    }

    const body = await request.json() as Partial<PurchaseAssistantRequest>;
    const message = typeof body.message === "string" ? body.message : "";

    if (message.length > 2000) {
      return NextResponse.json({ error: "Mensagem muito longa. Envie um pedido mais direto." }, { status: 400 });
    }

    const result = await runPurchaseAssistant({
      message,
      history: Array.isArray(body.history) ? body.history : [],
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel consultar o assistente.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
