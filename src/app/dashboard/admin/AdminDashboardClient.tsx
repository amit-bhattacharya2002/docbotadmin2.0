'use client';
import DepartmentAdminHeader from "./DepartmentAdminHeader";
import TabbedDocumentPanel from "./TabbedDocumentPanel";
import { useState } from "react";

export default function AdminDashboardClient({
  companyName,
  departmentName,
  userName,
  internalNamespace,
  externalNamespace,
  companyId,
  departmentId,
}: {
  companyName: string;
  departmentName: string;
  userName: string;
  internalNamespace: string;
  externalNamespace: string;
  companyId: string;
  departmentId: string;
}) {
  const [activeTab, setActiveTab] = useState("Internal Documents");

  return (
    <div className="min-h-screen flex flex-col ">
      <DepartmentAdminHeader companyName={companyName} departmentName={departmentName} userName={userName} />
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900 border-r border-white/10 flex flex-col py-8">
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "Internal Documents"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("Internal Documents")}
          >
            <h2>Internal Documents</h2>
          </button>
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "External Documents"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("External Documents")}
          >
            <h2>External Documents</h2>
          </button>
        </aside>
        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto bg-[#101010] ">
          {activeTab === "Internal Documents" && (
            <div>
              <h2 className="text-xl md:text-4xl text-start font-bold text-white my-10 border-b-2 border-white/20 pb-4">Internal Documents</h2>

              {/* Docbot Client Link - Always Visible */}
              {companyId && departmentId && (
                <div className="mb-6 bg-white/5 border border-white/20 rounded p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`}
                      className="flex-1 bg-white/10 text-white text-xs px-3 py-1.5 rounded border border-white/20 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`);
                        alert('Link copied to clipboard!');
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded transition-colors whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Share this link with users to access the Docbot client.</div>
                </div>
              )}

              {internalNamespace ? (
                <TabbedDocumentPanel namespace={internalNamespace} />
              ) : (
                <div className="text-red-500 bg-white/10 rounded-2xl p-8">Internal namespace not configured for your department.</div>
              )}
            </div>
          )}
          {activeTab === "External Documents" && (
            <div>
              <h2 className="text-xl md:text-4xl text-start font-bold  text-white my-10 border-b-2 border-white/20 pb-4">External Documents</h2>
              {externalNamespace ? (
                <TabbedDocumentPanel namespace={externalNamespace} />
              ) : (
                <div className="text-red-500 bg-white/10 rounded-2xl p-8">External namespace not configured for your department.</div>
              )}
            </div>
          )}
        </main>

      </div>

    </div>
  );
} 