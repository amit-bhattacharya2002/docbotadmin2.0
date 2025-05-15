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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-700">
      <form
        onSubmit={handleSubmit}
        className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-xl w-full max-w-md flex flex-col gap-6 border border-white/20"
      >
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Login</h2>
        <input
          className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          name="email"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
        />
        <input
          className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors mt-2 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Logging in..." : "Login"}
        </button>
        {status && (
          <div className="text-center text-sm mt-2 text-white bg-black/40 rounded-lg py-2 px-4">
            {status}
          </div>
        )}
      </form>
    </div>
  );
} 