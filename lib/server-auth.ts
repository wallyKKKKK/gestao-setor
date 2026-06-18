import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isPerfumePurchasingSector } from "@/lib/permissions";
import type { Profile, UserRole } from "@/lib/types";

type AuthResult =
  | { ok: true; userId: string; email: string; profile: Profile }
  | { ok: false; response: NextResponse };

function unauthorized(message = "Sessao invalida ou expirada.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = "Acesso negado.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
}

function isSupremeAdminEmail(email: string | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();
  const configuredEmail = process.env.NEXT_PUBLIC_SUPREME_ADMIN_EMAIL?.trim().toLowerCase();

  return Boolean(normalizedEmail && (normalizedEmail === configuredEmail || normalizedEmail === "admin@wally.system"));
}

export async function requireAuthenticatedProfile(request: Request): Promise<AuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return { ok: false, response: unauthorized() };
  }

  const supabase = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData.user) {
    return { ok: false, response: unauthorized() };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, response: forbidden("Perfil nao encontrado.") };
  }

  const typedProfile = profile as Profile;
  if (typedProfile.is_active === false || typedProfile.account_status === "pending" || typedProfile.account_status === "rejected") {
    return { ok: false, response: forbidden("Conta sem permissao para acessar este recurso.") };
  }

  return { ok: true, userId: userData.user.id, email: userData.user.email || "", profile: typedProfile };
}

export async function requireRole(request: Request, roles: UserRole[]) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth;

  if (!roles.includes(auth.profile.role)) {
    return { ok: false as const, response: forbidden() };
  }

  return auth;
}

export async function requireSelfOrRole(request: Request, targetUserId: string, roles: UserRole[]) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth;

  if (auth.userId !== targetUserId && !roles.includes(auth.profile.role)) {
    return { ok: false as const, response: forbidden() };
  }

  return auth;
}

export async function requirePerfumePurchasingOrSupreme(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth;

  const isSupremeAdmin = auth.profile.role === "admin" && isSupremeAdminEmail(auth.email);
  const isPerfumePurchasing = isPerfumePurchasingSector(auth.profile.sector || "");

  if (!isSupremeAdmin && !isPerfumePurchasing) {
    return { ok: false as const, response: forbidden("Acesso liberado apenas para Admin Supremo ou setor Compras Perfumaria.") };
  }

  return auth;
}
