"use client";
import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors font-semibold"
    >
      Logout
    </button>
  );
} 