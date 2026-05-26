"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);

  const processAuth = async () => {
    let finalEmail = identifier;

    if (identifier.toUpperCase() === "ADMIN") {
      finalEmail = "admin@wally.system";
    }

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email: finalEmail, password, options: { data: { full_name: identifier } } })
      : await supabase.auth.signInWithPassword({ email: finalEmail, password });

    if (error) alert("Acesso Negado: Credenciais Inválidas");
    else window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4 text-center font-sans">
      <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-b-[24px] border-blue-600 shadow-2xl">
        <div className="mb-8 flex justify-center">
          <Image src="/icon.png" alt="Logo" width={80} height={80} className="w-20 h-20 rounded-[24px] shadow-lg bg-blue-600 p-1" />
        </div>

        <h1 className="text-5xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">
          WALLY<br/>
          <span className="text-blue-600 text-2xl tracking-[0.2em] font-medium opacity-80 uppercase not-italic">Acesso Restrito</span>
        </h1>

        <div className="space-y-4 mt-12">
          <input
            className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder:text-slate-300 uppercase"
            placeholder="USUÁRIO OU E-MAIL"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
          />
          <input
            className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder:text-slate-300"
            type="password"
            placeholder="SENHA"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          <button
            onClick={processAuth}
            className="w-full bg-[#0F172A] text-white p-6 rounded-[28px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl mt-4"
          >
            Entrar no Sistema
          </button>

          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-[8px] font-black text-slate-200 uppercase tracking-widest text-center mt-6 hover:text-slate-400 transition-colors"
          >
            {isSignUp ? "Voltar para Login" : "Solicitar novo acesso à TI"}
          </button>
        </div>
      </div>
    </div>
  );
}
