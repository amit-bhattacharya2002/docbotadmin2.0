"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    const res = await signIn("credentials", {
      redirect: false,
      email: form.email,
      password: form.password,
    });
    setLoading(false);
    if (res?.ok) {
      router.push("/dashboard");
    } else {
      setStatus("Invalid email or password.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <form
        onSubmit={handleSubmit}
        className="bg-[#111111] border border-white/10 p-8 rounded-xl w-full max-w-md flex flex-col gap-6 shadow-xl"
      >
        <h2 className="text-2xl tracking-tight text-center mb-2"><span className="text-blue-400">Docbot</span> <span className="text-white">Login</span></h2>
        <div className="flex flex-col gap-4">
          <label className="text-gray-400 text-xs tracking-tight" htmlFor="email">
            Email
          </label>
          <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            required
            id="email"
          />
          <label className="text-gray-400 text-xs tracking-tight" htmlFor="password">
            Password
          </label>
          <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            name="password"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
            required
            id="password"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-600 text-white hover:bg-blue-700 text-sm tracking-tight py-3 rounded-lg transition-all duration-200 mt-2 disabled:opacity-40"
          disabled={loading}
        >
          {loading ? "Logging in..." : "Login"}
        </button>
        {status && (
          <div className="text-center text-xs tracking-tight mt-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg py-2 px-4">
            {status}
          </div>
        )}
      </form>
    </div>
  );
} 