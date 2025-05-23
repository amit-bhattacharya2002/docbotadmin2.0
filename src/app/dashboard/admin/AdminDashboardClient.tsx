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
}: {
  companyName: string;
  departmentName: string;
  userName: string;
  internalNamespace: string;
  externalNamespace: string;
}) {
  const [activeTab, setActiveTab] = useState("Internal Documents");

  return (
    <div className="min-h-screen flex flex-col bg-black">
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
            Internal Documents
          </button>
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "External Documents"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("External Documents")}
          >
            External Documents
          </button>
        </aside>
        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto">
          {activeTab === "Internal Documents" && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Internal Documents</h2>
              {internalNamespace ? (
                <TabbedDocumentPanel namespace={internalNamespace} />
              ) : (
                <div className="text-red-500 bg-white/10 rounded-2xl p-8">Internal namespace not configured for your department.</div>
              )}
            </div>
          )}
          {activeTab === "External Documents" && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">External Documents</h2>
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