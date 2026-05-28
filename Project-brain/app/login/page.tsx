"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Lock, User } from "lucide-react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    try {
      const res = await fetch("http://localhost:8002/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("brain_token", data.access_token);
        window.location.href = "/view";
      } else {
        alert("Access Denied: Invalid Credentials");
      }
    } catch (error) {
      console.error(error);
      alert("System Offline: Cannot reach the Brain API");
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950">
      <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.1)_0%,transparent_50%)]" />

      <div className="z-10 w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-10 shadow-2xl backdrop-blur-xl">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 text-6xl drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">ðŸ§ </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">PROJECT BRAIN</h1>
          <p className="text-sm text-cyan-400">Secure Authentication Protocol</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="relative">
            <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              required
              placeholder="System ID"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 py-4 pl-12 pr-4 text-white outline-none transition-colors focus:border-cyan-400"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              required
              placeholder="Passcode"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 py-4 pl-12 pr-4 text-white outline-none transition-colors focus:border-cyan-400"
            />
          </div>

          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 py-4 text-lg font-bold text-black transition-all hover:bg-cyan-400">
            Initialize Brain <ArrowRight className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}

