"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

type AuthView = "login" | "signup" | "forgot" | "reset";

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

  return (
    <div className="min-h-screen bg-[#E8EEF7] font-sans text-slate-900 flex items-stretch overflow-hidden">
      <section className="hidden lg:flex w-[46%] bg-[#232D4A] text-white p-10 xl:p-14 flex-col justify-between">
        <div className="flex items-center gap-3">
          <Image src="/icon.png" alt="WALLY" width={52} height={52} className="w-[52px] h-[52px] rounded-2xl bg-blue-600 p-1 shadow-lg" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-200">WALLY</p>
            <p className="text-sm font-bold text-white/70">Gestao operacional</p>
          </div>
        </div>

        <div className="space-y-7 max-w-md">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-[10px] font-black uppercase tracking-widest text-blue-100">
            <ShieldCheck size={14} />
            Acesso restrito
          </div>
          <h1 className="text-5xl xl:text-6xl font-black uppercase italic tracking-tight leading-[0.95]">
            Painel de tarefas
          </h1>
          <p className="text-base leading-relaxed text-slate-300 font-medium">
            Acompanhe rotinas, responsaveis, reunioes e alertas internos em um so lugar.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          {["Tarefas", "Agenda", "Alertas"].map((item) => (
            <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/70">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[430px]">
          <div className="lg:hidden mb-8 flex justify-center">
            <Image src="/icon.png" alt="WALLY" width={76} height={76} className="w-[76px] h-[76px] rounded-[24px] shadow-lg bg-blue-600 p-1" />
          </div>

          <form onSubmit={processAuth} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(35,45,74,0.16)] sm:p-8">
            <div className="mb-8">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600 mb-3">
                {isSignUp ? "Novo acesso" : isResetPassword ? "Recuperacao" : isForgotPassword ? "Senha" : "Entrar"}
              </p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight leading-none text-slate-950">
                {isSignUp ? "Criar conta" : isResetPassword ? "Nova senha" : isForgotPassword ? "Recuperar" : "Bem-vindo"}
              </h2>
            </div>

            <div className="space-y-4">
              {isSignUp && (
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Nome completo</span>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                    <User size={18} className="text-slate-400" />
                    <input
                      className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300 uppercase"
                      placeholder="SEU NOME"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </label>
              )}

              {!isResetPassword && (
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">
                    {isSignUp || isForgotPassword ? "E-mail" : "Usuario ou e-mail"}
                  </span>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                    <Mail size={18} className="text-slate-400" />
                    <input
                      className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300 uppercase"
                      placeholder={isSignUp || isForgotPassword ? "EMAIL@EMPRESA.COM" : "USUARIO OU E-MAIL"}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      autoComplete={isSignUp || isForgotPassword ? "email" : "username"}
                    />
                  </div>
                </label>
              )}

              {!isForgotPassword && (
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">
                    {isResetPassword ? "Nova senha" : "Senha"}
                  </span>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                    <LockKeyhole size={18} className="text-slate-400" />
                    <input
                      className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300"
                      type={showPassword ? "text" : "password"}
                      placeholder={isResetPassword ? "NOVA SENHA" : "SENHA"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={isSignUp || isResetPassword ? "new-password" : "current-password"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-white transition-all"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              )}

              {isResetPassword && (
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Confirmar senha</span>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                    <LockKeyhole size={18} className="text-slate-400" />
                    <input
                      className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300"
                      type={showPassword ? "text" : "password"}
                      placeholder="CONFIRME A SENHA"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </label>
              )}

              <div className="min-h-[22px]">
                {errorMessage && (
                  <p className="text-[11px] font-black uppercase tracking-wide text-red-600 px-2">
                    {errorMessage}
                  </p>
                )}
                {successMessage && (
                  <p className="text-[11px] font-black uppercase tracking-wide text-green-700 px-2">
                    {successMessage}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#232D4A] text-white p-5 rounded-2xl font-black uppercase text-sm tracking-[0.18em] hover:bg-blue-600 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading
                  ? "Validando..."
                  : isForgotPassword
                    ? "Enviar link de recuperacao"
                    : isResetPassword
                      ? "Salvar nova senha"
                      : isSignUp
                        ? "Solicitar acesso"
                        : "Entrar no sistema"}
              </button>

              <div className="flex flex-col gap-2 pt-2 text-center">
                {!isResetPassword && !isForgotPassword && (
                  <button
                    type="button"
                    onClick={() => switchAuthView("forgot")}
                    className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    Esqueci minha senha
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => switchAuthView(isSignUp || isForgotPassword || isResetPassword ? "login" : "signup")}
                  className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
                >
                  {isSignUp || isForgotPassword || isResetPassword ? "Voltar para login" : "Criar conta"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
