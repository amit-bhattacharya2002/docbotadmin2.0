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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-700">
      <form
        onSubmit={handleSubmit}
        className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-xl w-full max-w-md flex flex-col gap-6 border border-white/20"
      >
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Register</h2>
        <div className="flex gap-6 justify-center">
          <label className="flex items-center gap-2 text-white">
            <input
              type="radio"
              name="role"
              value="SUPERADMIN"
              checked={role === "SUPERADMIN"}
              onChange={handleRoleChange}
              className="accent-blue-600"
            />
            SuperAdmin
          </label>
          <label className="flex items-center gap-2 text-white">
            <input
              type="radio"
              name="role"
              value="DEPARTMENTADMIN"
              checked={role === "DEPARTMENTADMIN"}
              onChange={handleRoleChange}
              className="accent-blue-600"
            />
            Admin
          </label>
        </div>
        <input
          className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          name="name"
          placeholder="Name"
          value={form.name}
          onChange={handleChange}
          required
        />
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
            className="px-4 py-3 rounded-lg bg-white/20 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="" disabled>Select Company</option>
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
            className="px-4 py-3 rounded-lg bg-white/20 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept} className="text-black">{dept}</option>
            ))}
          </select>
        )}
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
          {loading ? "Registering..." : "Register"}
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