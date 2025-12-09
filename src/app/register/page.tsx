"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const DEPARTMENTS = [
  "Alumni Relations",
  "Finance",
  "Student Services",
];

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState("SUPERADMIN");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    adminId: "",
    department: DEPARTMENTS[0],
    company: "",
  });
  const [companies, setCompanies] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch company names from API
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(data.companies || []));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleRoleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRole(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, role }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.status === 400 && data.message?.includes("already registered")) {
      setStatus("An account with this email already exists. Please log in.");
    } else if (res.ok) {
      setStatus("Registration successful! Redirecting to login...");
      setTimeout(() => router.push("/login"), 1500);
    } else {
      setStatus(data.message || "Registration failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <form
        onSubmit={handleSubmit}
        className="bg-[#111111] border border-white/10 p-8 rounded-xl w-full max-w-md flex flex-col gap-6 shadow-xl"
      >
        <h2 className="text-2xl tracking-tight text-blue-400 mb-2 text-center">Register</h2>
        <div className="flex gap-6 justify-center">
          <label className="flex items-center gap-2 text-blue-300 text-sm tracking-tight">
            <input
              type="radio"
              name="role"
              value="SUPERADMIN"
              checked={role === "SUPERADMIN"}
              onChange={handleRoleChange}
              className="accent-blue-500"
            />
            SuperAdmin
          </label>
          <label className="flex items-center gap-2 text-blue-300 text-sm tracking-tight">
            <input
              type="radio"
              name="role"
              value="DEPARTMENTADMIN"
              checked={role === "DEPARTMENTADMIN"}
              onChange={handleRoleChange}
              className="accent-blue-500"
            />
            Admin
          </label>
        </div>
        <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          name="name"
          placeholder="Name"
          value={form.name}
          onChange={handleChange}
          required
        />
        <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          name="email"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
        />
        <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          name="adminId"
          placeholder="Admin ID"
          value={form.adminId}
          onChange={handleChange}
          required
        />
        {role === "SUPERADMIN" && (
          <select
            name="company"
            value={form.company}
            onChange={handleChange}
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            required
          >
            <option value="" disabled className="text-black">Select Company</option>
            {companies.map((company) => (
              <option key={company} value={company} className="text-black">{company}</option>
            ))}
          </select>
        )}
        {role === "DEPARTMENTADMIN" && (
          <select
            name="department"
            value={form.department}
            onChange={handleChange}
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept} className="text-black">{dept}</option>
            ))}
          </select>
        )}
        <input
            className="px-4 py-3 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 placeholder:text-gray-500 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
        />
        <button
          type="submit"
          className="bg-blue-600 text-white hover:bg-blue-700 text-sm tracking-tight py-3 rounded-lg transition-all duration-200 mt-2 disabled:opacity-40"
          disabled={loading}
        >
          {loading ? "Registering..." : "Register"}
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