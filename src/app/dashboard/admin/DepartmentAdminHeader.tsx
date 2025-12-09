"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

export default function DepartmentAdminHeader({ companyName, departmentName, userName }: { companyName: string; departmentName: string; userName?: string }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({ callbackUrl: "/login" });
    setLoggingOut(false);
  };

  return (
    <header className="flex items-center h-16 justify-between px-8 bg-[#111111] border-b border-white/5 relative z-50">
      <div className="flex items-center gap-3 text-white">
        <span className="text-lg tracking-tight">{companyName}</span>
        <span className="text-gray-500">/</span>
        <span className="text-lg tracking-tight text-white">{departmentName}</span>
      </div>
      <div className="relative">
        <button
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 rounded-lg text-blue-400 hover:bg-blue-500/20 transition-all duration-200 border border-blue-500/20"
          onClick={() => setDropdownOpen((open) => !open)}
        >
          <span className="text-sm tracking-tight">{userName || "User"}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 text-blue-300 border-b border-white/5 text-sm tracking-tight">{userName || "User"}</div>
            <button
              className="w-full px-4 py-3 text-left text-red-400 hover:bg-blue-500/10 transition-colors text-sm tracking-tight disabled:opacity-60"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
} 