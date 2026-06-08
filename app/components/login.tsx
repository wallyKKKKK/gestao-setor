"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

function isEmailLike(value: string) {
  return value.includes("@");
}

export function Login() {
  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const processAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!identifier.trim() || !password.trim()) {
      setErrorMessage(isSignUp ? "Preencha e-mail e senha para continuar." : "Preencha usuário e senha para continuar.");
      return;
    }

    setIsLoading(true);

    try {
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
          setErrorMessage("Não foi possível criar a conta.");
          return;
        }

        await supabase.auth.signOut();
        setIsSignUp(false);
        setIdentifier("");
        setFullName("");
        setPassword("");
        setSuccessMessage("Conta criada. Aguarde a aprovação do administrador.");
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.session) {
        setErrorMessage(data?.error || "Credenciais inválidas.");
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (error) {
        setErrorMessage("Não foi possível iniciar a sessão.");
        return;
      }

      window.location.reload();
    } catch {
      setErrorMessage("Falha de conexão. Confira a internet, as variáveis da Vercel/Supabase ou tente reiniciar o servidor.");
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
            <p className="text-sm font-bold text-white/70">Gestão operacional</p>
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
            Acompanhe rotinas, responsáveis, reuniões e alertas internos em um só lugar.
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
                {isSignUp ? "Novo acesso" : "Entrar"}
              </p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight leading-none text-slate-950">
                {isSignUp ? "Criar conta" : "Bem-vindo"}
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

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">
                  {isSignUp ? "E-mail" : "Usuário ou e-mail"}
                </span>
                <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                  <Mail size={18} className="text-slate-400" />
                  <input
                    className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300 uppercase"
                    placeholder={isSignUp ? "EMAIL@EMPRESA.COM" : "USUÁRIO OU E-MAIL"}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete={isSignUp ? "email" : "username"}
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Senha</span>
                <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 focus-within:border-blue-500 transition-all">
                  <LockKeyhole size={18} className="text-slate-400" />
                  <input
                    className="w-full py-4 bg-transparent font-black text-slate-900 outline-none placeholder:text-slate-300"
                    type={showPassword ? "text" : "password"}
                    placeholder="SENHA"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
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
                {isLoading ? "Validando..." : isSignUp ? "Solicitar acesso" : "Entrar no sistema"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSignUp((value) => !value);
                  setErrorMessage("");
                  setSuccessMessage("");
                  setPassword("");
                }}
                className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center pt-2 hover:text-blue-600 transition-colors"
              >
                {isSignUp ? "Voltar para login" : "Criar conta"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
