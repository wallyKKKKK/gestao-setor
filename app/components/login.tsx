"use client";

import Image from "next/image";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

type AuthView = "login" | "signup" | "forgot" | "reset";

// Keep native input painting consistent even when the app theme is dark.
const loginInputStyle: CSSProperties = {
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
  backgroundColor: "#edf3fc",
  colorScheme: "light",
};

function hasPasswordRecoveryParam() {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get("type") === "recovery" || hash.get("type") === "recovery" || search.get("recovery") === "1";
}

function isEmailLike(value: string) {
  return value.includes("@");
}

function getSignUpErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("already registered") || normalized.includes("already been registered") || normalized.includes("user already")) {
    return "Este e-mail ja esta cadastrado. Tente entrar pela tela de login ou use outro e-mail.";
  }

  if (normalized.includes("password")) {
    return `Senha nao aceita pelo sistema. Tente uma senha mais forte. Detalhe: ${message}`;
  }

  if (normalized.includes("email") && normalized.includes("invalid")) {
    return "E-mail invalido. Confira se foi digitado corretamente.";
  }

  if (normalized.includes("signup") || normalized.includes("signups") || normalized.includes("disabled")) {
    return `Cadastro de novas contas bloqueado no Supabase. Detalhe: ${message}`;
  }

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Muitas tentativas em sequencia. Aguarde alguns minutos e tente novamente.";
  }

  if (normalized.includes("database") || normalized.includes("profile") || normalized.includes("trigger")) {
    return `A conta nao foi criada por erro no banco/perfil automatico. Detalhe: ${message}`;
  }

  return `Nao foi possivel criar a conta. Detalhe: ${message}`;
}

export function Login() {
  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authView, setAuthView] = useState<AuthView>(() => (hasPasswordRecoveryParam() ? "reset" : "login"));
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState(() => (hasPasswordRecoveryParam() ? "Informe uma nova senha para concluir a recuperacao." : ""));
  const isSignUp = authView === "signup";
  const isForgotPassword = authView === "forgot";
  const isResetPassword = authView === "reset";

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setAuthView("reset");
        setErrorMessage("");
        setSuccessMessage("Informe uma nova senha para concluir a recuperacao.");
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  const switchAuthView = (view: AuthView) => {
    setAuthView(view);
    clearMessages();
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
  };

  const processAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearMessages();

    if (isForgotPassword) {
      if (!identifier.trim() || !isEmailLike(identifier.trim())) {
        setErrorMessage("Informe o e-mail cadastrado para receber o link de recuperacao.");
        return;
      }
    } else if (isResetPassword) {
      if (!password.trim() || !confirmPassword.trim()) {
        setErrorMessage("Informe e confirme a nova senha.");
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage("As senhas nao conferem.");
        return;
      }

      if (password.length < 6) {
        setErrorMessage("Use uma senha com pelo menos 6 caracteres.");
        return;
      }
    } else if (!identifier.trim() || !password.trim()) {
      setErrorMessage(isSignUp ? "Preencha e-mail e senha para continuar." : "Preencha usuario e senha para continuar.");
      return;
    }

    setIsLoading(true);

    try {
      if (isForgotPassword) {
        const redirectTo = `${window.location.origin}${window.location.pathname}?recovery=1`;
        const { error } = await supabase.auth.resetPasswordForEmail(identifier.trim(), { redirectTo });

        if (error) {
          const normalized = error.message.toLowerCase();
          setErrorMessage(normalized.includes("rate") || normalized.includes("too many")
            ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
            : `Nao foi possivel enviar o e-mail de recuperacao. Detalhe: ${error.message}`);
          return;
        }

        setSuccessMessage("Enviamos um link para o e-mail informado. Abra o link para criar uma nova senha.");
        return;
      }

      if (isResetPassword) {
        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
          setErrorMessage(`Nao foi possivel atualizar a senha. Detalhe: ${error.message}`);
          return;
        }

        await supabase.auth.signOut();
        window.history.replaceState({}, document.title, window.location.pathname);
        setIdentifier("");
        setPassword("");
        setConfirmPassword("");
        setAuthView("login");
        setSuccessMessage("Senha alterada. Entre novamente com a nova senha.");
        return;
      }

      if (isSignUp) {
        if (!fullName.trim()) {
          setErrorMessage("Informe o nome completo.");
          return;
        }

        if (!isEmailLike(identifier.trim())) {
          setErrorMessage("Use um e-mail para criar a conta.");
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: identifier.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });

        if (error) {
          setErrorMessage(getSignUpErrorMessage(error.message || "Erro desconhecido no cadastro."));
          return;
        }

        await supabase.auth.signOut();
        setAuthView("login");
        setIdentifier("");
        setFullName("");
        setPassword("");
        setSuccessMessage("Conta criada. Aguarde a aprovacao do administrador.");
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.session) {
        setErrorMessage(data?.error || "Credenciais invalidas.");
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (error) {
        setErrorMessage("Nao foi possivel iniciar a sessao.");
        return;
      }

      window.location.reload();
    } catch {
      setErrorMessage("Falha de conexao. Confira a internet, as variaveis da Vercel/Supabase ou tente reiniciar o servidor.");
    } finally {
      setIsLoading(false);
    }
  };

  const fieldClass = "login-field flex h-12 items-center overflow-hidden rounded-md border border-slate-300 bg-[#edf3fc] focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-100";
  const inputClass = "min-w-0 flex-1 bg-transparent px-3 text-base text-slate-900 outline-none placeholder:text-slate-400";
  const iconClass = "flex h-full w-12 shrink-0 items-center justify-center border-r border-slate-300 bg-white text-slate-400";

  return (
    <main className="login-screen flex min-h-dvh items-center justify-center bg-[#06213a] bg-cover bg-center px-4 py-8 font-sans text-slate-900 sm:px-8" style={{ backgroundImage: "url('/login-background.webp')" }}>
      <div className="grid w-full max-w-[1040px] grid-cols-1 overflow-hidden rounded-[36px] shadow-[0_24px_80px_rgba(0,0,0,0.24)] lg:min-h-[564px] lg:grid-cols-2">
        <section aria-label="WALLY Gestão operacional" className="hidden flex-col justify-between bg-white/65 px-12 py-12 backdrop-blur-md lg:flex">
          <div className="flex items-center gap-2 text-sm font-medium text-[#16557d]"><ShieldCheck size={17} /> Gestão operacional</div>
          <div className="flex flex-col items-center py-4 text-center">
            <Image src="/icon.png" alt="WALLY Task Manager" width={184} height={184} priority className="h-[184px] w-[184px] rounded-[28px]" />
            <div className="mt-7 w-full border-t border-white/80 pt-4">
              <h1 className="text-xl font-medium text-[#103f67]">Sua operação em um só lugar.</h1>
              <p className="mt-2 text-sm text-[#215779]">Tarefas, agenda e equipe.</p>
            </div>
          </div>
          <p className="text-xs text-[#215779]">WALLY Task Manager</p>
        </section>

        <section className="login-form-panel flex min-w-0 items-center justify-center bg-white px-6 py-10 sm:px-12 lg:px-16 lg:py-12">
          <form onSubmit={processAuth} className="w-full min-w-0 max-w-[390px]" aria-label="Acesso ao WALLY">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <Image src="/icon.png" alt="WALLY" width={48} height={48} priority className="h-12 w-12 rounded-xl" />
              <span className="text-xl font-semibold text-[#103f67]">WALLY</span>
            </div>
            <h2 className="mb-6 text-2xl font-semibold text-[#0089c9]">
              {isSignUp ? "Criar conta" : isResetPassword ? "Nova senha" : isForgotPassword ? "Recuperar senha" : "Acesso ao sistema"}
            </h2>

            <div className="space-y-5">
              {isSignUp && <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Nome completo</span>
                <div className={fieldClass}>
                  <span className={iconClass}><User size={19} aria-hidden="true" /></span>
                  <input style={loginInputStyle} className={inputClass} placeholder="Seu nome completo" value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" disabled={isLoading} />
                </div>
              </label>}

              {!isResetPassword && <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{isSignUp || isForgotPassword ? "E-mail" : "Usuário ou e-mail"}</span>
                <div className={fieldClass}>
                  <span className={iconClass}><User size={19} aria-hidden="true" /></span>
                  <input style={loginInputStyle} className={inputClass} placeholder={isSignUp || isForgotPassword ? "seu@email.com" : "Seu usuário ou e-mail"} value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete={isSignUp || isForgotPassword ? "email" : "username"} autoCapitalize="none" spellCheck={false} disabled={isLoading} />
                </div>
              </label>}

              {!isForgotPassword && <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{isResetPassword ? "Nova senha" : "Senha"}</span>
                <div className={fieldClass}>
                  <span className={iconClass}><LockKeyhole size={18} aria-hidden="true" /></span>
                  <input style={loginInputStyle} className={inputClass} type={showPassword ? "text" : "password"} placeholder={isResetPassword ? "Nova senha" : "Sua senha"} value={password} onChange={event => setPassword(event.target.value)} autoComplete={isSignUp || isResetPassword ? "new-password" : "current-password"} disabled={isLoading} />
                  <button type="button" disabled={isLoading} title={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword(value => !value)} className="flex h-full w-12 shrink-0 items-center justify-center border-l border-slate-300 bg-white text-slate-400 hover:text-sky-700">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>}

              {isResetPassword && <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Confirmar senha</span>
                <div className={fieldClass}>
                  <span className={iconClass}><LockKeyhole size={18} aria-hidden="true" /></span>
                  <input style={loginInputStyle} className={inputClass} type={showPassword ? "text" : "password"} placeholder="Confirme a nova senha" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={isLoading} />
                </div>
              </label>}
            </div>

            {!isResetPassword && !isForgotPassword && !isSignUp && <div className="mt-2 text-right">
              <button type="button" disabled={isLoading} onClick={() => switchAuthView("forgot")} className="text-xs text-slate-500 underline underline-offset-2 hover:text-sky-700">Esqueci minha senha</button>
            </div>}

            <div className="my-4 min-h-5">
              {errorMessage && <p role="alert" className="text-sm leading-relaxed text-red-700">{errorMessage}</p>}
              {successMessage && <p role="status" className="text-sm leading-relaxed text-emerald-700">{successMessage}</p>}
            </div>

            <button type="submit" disabled={isLoading} className="flex h-[54px] w-full items-center justify-center gap-2 rounded-md bg-[#062c83] px-4 text-base font-medium text-white transition hover:bg-[#0943ad] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-wait disabled:opacity-60">
              {isLoading ? <LoaderCircle size={19} className="animate-spin" /> : <Check size={20} />}
              {isLoading ? "Aguarde..." : isForgotPassword ? "Enviar link de recuperação" : isResetPassword ? "Salvar nova senha" : isSignUp ? "Solicitar acesso" : "Entrar"}
            </button>
            <div className="mt-5 text-center">
              <button type="button" disabled={isLoading} onClick={() => switchAuthView(isSignUp || isForgotPassword || isResetPassword ? "login" : "signup")} className="text-sm text-slate-500 hover:text-sky-700 hover:underline">
                {isSignUp || isForgotPassword || isResetPassword ? "Voltar para login" : "Criar conta"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
