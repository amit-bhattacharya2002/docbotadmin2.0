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
    <header className="flex items-center h-[10vh] justify-between px-8 py-4 bg-white/10 backdrop-blur-lg border-b border-white/20">
      <div className="flex items-center justify-center gap-2 text-white text-2xl font-bold">
        <span>{companyName}</span>
        <span className="text-blue-400 font-semibold">Docbot Admin</span>
        <span className="text-gray-300"> \</span>
        <span className="text-xl text-gray-300 font-normal ml-2">{departmentName}</span>
      </div>
      <div className="relative">
        <button
          className="flex items-center gap-2 px-4 py-2 bg-white/20 rounded-lg text-white hover:bg-white/30 focus:outline-none"
          onClick={() => setDropdownOpen((open) => !open)}
        >
          <span>{userName || "User"}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-40 bg-white/90 rounded-lg shadow-lg z-10">
            <div className="px-4 py-2 text-gray-800 border-b">{userName || "User"}</div>
            <button
              className="w-full px-4 py-2 text-left text-red-600 hover:bg-gray-100 rounded-b-lg disabled:opacity-60"
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