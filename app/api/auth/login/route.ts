import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function isEmailLike(value: string) {
  return value.includes("@");
}

async function assertProfileCanAccess(userId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw error;

  if (profile?.is_active === false) {
    throw new Error("Conta bloqueada. Fale com um administrador.");
  }

  if (profile?.account_status === "pending") {
    throw new Error("Conta aguardando aprovação do administrador.");
  }

  if (profile?.account_status === "rejected") {
    throw new Error("Conta não aprovada. Fale com um administrador.");
  }
}

async function resolveLoginEmail(identifier: string) {
  const cleanIdentifier = identifier.trim();

  if (isEmailLike(cleanIdentifier)) {
    return cleanIdentifier;
  }

  if (cleanIdentifier.toUpperCase() === "ADMIN") {
    return "admin@wally.system";
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("full_name", cleanIdentifier)
    .limit(2);

  if (error) throw error;

  if (!profiles || profiles.length === 0) {
    throw new Error("Usuário não encontrado.");
  }

  if (profiles.length > 1) {
    throw new Error("Existe mais de um usuário com esse nome. Entre com o e-mail.");
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(profiles[0].id);
  if (userError) throw userError;

  if (!userData.user.email) {
    throw new Error("Usuário sem e-mail cadastrado.");
  }

  return userData.user.email;
}

export async function POST(request: Request) {
  try {
    const { identifier, password } = await request.json();

    if (!identifier || !password) {
      return NextResponse.json({ error: "Preencha usuário e senha." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Configuração de autenticação ausente." }, { status: 500 });
    }

    const email = await resolveLoginEmail(identifier);
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
    }

    await assertProfileCanAccess(data.user.id);

    return NextResponse.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível entrar.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
