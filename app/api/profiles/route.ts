import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import type { AccountStatus, UserRole } from "@/lib/types";

const VALID_ROLES = new Set<UserRole>(["membro", "gerente", "admin"]);
const VALID_ACCOUNT_STATUSES = new Set<AccountStatus>(["pending", "approved", "rejected"]);

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({})) as {
      profileId?: string;
      fullName?: string;
      role?: UserRole;
      sector?: string;
      accountStatus?: AccountStatus;
      isActive?: boolean;
    };

    const profileId = cleanText(body.profileId);
    if (!profileId) {
      return NextResponse.json({ error: "Perfil nao informado." }, { status: 400 });
    }

    const isAdmin = auth.profile.role === "admin";
    const isSelf = auth.userId === profileId;
    const payload: Record<string, unknown> = {};

    if (body.fullName !== undefined) {
      if (!isAdmin && !isSelf) {
        return NextResponse.json({ error: "Voce so pode alterar o proprio nome." }, { status: 403 });
      }

      const fullName = cleanText(body.fullName);
      if (fullName.length < 3 || fullName.length > 120) {
        return NextResponse.json({ error: "Informe um nome entre 3 e 120 caracteres." }, { status: 400 });
      }

      payload.full_name = fullName;
    }

    if (body.role !== undefined) {
      if (!isAdmin) {
        return NextResponse.json({ error: "Apenas administradores podem alterar cargo." }, { status: 403 });
      }
      if (!VALID_ROLES.has(body.role)) {
        return NextResponse.json({ error: "Cargo invalido." }, { status: 400 });
      }
      if (isSelf && body.role !== "admin") {
        return NextResponse.json({ error: "Voce nao pode remover seu proprio cargo de administrador." }, { status: 400 });
      }
      payload.role = body.role;
    }

    if (body.sector !== undefined) {
      if (!isAdmin) {
        return NextResponse.json({ error: "Apenas administradores podem alterar setor." }, { status: 403 });
      }

      const sector = cleanText(body.sector);
      if (!sector || sector.length > 80) {
        return NextResponse.json({ error: "Setor invalido." }, { status: 400 });
      }
      payload.sector = sector;
    }

    if (body.accountStatus !== undefined) {
      if (!isAdmin) {
        return NextResponse.json({ error: "Apenas administradores podem aprovar ou rejeitar contas." }, { status: 403 });
      }
      if (!VALID_ACCOUNT_STATUSES.has(body.accountStatus)) {
        return NextResponse.json({ error: "Status de conta invalido." }, { status: 400 });
      }
      if (isSelf && body.accountStatus !== "approved") {
        return NextResponse.json({ error: "Voce nao pode bloquear a propria conta." }, { status: 400 });
      }
      payload.account_status = body.accountStatus;
    }

    if (body.isActive !== undefined) {
      if (!isAdmin) {
        return NextResponse.json({ error: "Apenas administradores podem ativar ou bloquear contas." }, { status: 403 });
      }
      if (isSelf && body.isActive === false) {
        return NextResponse.json({ error: "Voce nao pode bloquear a propria conta." }, { status: 400 });
      }
      payload.is_active = Boolean(body.isActive);
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "Nenhuma alteracao enviada." }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .update(payload)
      .eq("id", profileId)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar perfil.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
