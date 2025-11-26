'use client';
import DepartmentAdminHeader from "./DepartmentAdminHeader";
import TabbedDocumentPanel from "./TabbedDocumentPanel";
import FAQGeneratorPanel from "./FAQGeneratorPanel";
import { useState } from "react";
import { FiMenu, FiX } from "react-icons/fi";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex flex-col ">
      <DepartmentAdminHeader companyName={companyName} departmentName={departmentName} userName={userName} />
      <div className="flex flex-1 relative">
        {/* Sidebar */}
        <aside className={`bg-gray-900 border-r border-white/10 flex flex-col py-8 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
        }`}>
          <div className="flex items-center justify-between px-6 mb-4">
            <h2 className="text-white font-bold text-lg">Documents</h2>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="text-gray-300 hover:text-white transition-colors p-1"
              aria-label="Collapse sidebar"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
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
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "FAQ Generator"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("FAQ Generator")}
          >
            <h2>FAQ Generator</h2>
          </button>
        </aside>
        
        {/* Sidebar Toggle Button (when collapsed) */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute left-0 top-8 z-10 bg-gray-900 border-r border-y border-white/10 text-white p-2 rounded-r-lg hover:bg-gray-800 transition-colors"
            aria-label="Expand sidebar"
          >
            <FiMenu className="w-3 h-3" />
          </button>
        )}
        
        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 p-8 overflow-auto bg-[#101010] ">
          {activeTab === "Internal Documents" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Docbot Client Link - Always Visible */}
              {companyId && departmentId && (
                <div className="mb-6 bg-white/5 border border-white/20 rounded p-3 flex-shrink-0">
                  <h2 className="text-md font-bold text-white mb-2">Docbot Client Link</h2>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`}
                      className="flex-1 bg-white/10 text-white text-xs px-3 py-1 rounded border border-white/20 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`);
                        alert('Link copied to clipboard!');
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded transition-colors whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Share this link with users to access the Docbot client.</div>
                </div>
              )}

              {internalNamespace ? (
                <div className="flex-1 flex flex-col min-h-0">
                <TabbedDocumentPanel namespace={internalNamespace} />
                </div>
              ) : (
                <div className="text-red-500 bg-white/10 rounded-2xl p-8">Internal namespace not configured for your department.</div>
              )}
            </div>
          )}
          {activeTab === "External Documents" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Docbot Client Link - Not Configured for External */}
              {companyId && departmentId && (
                <div className="mb-6 bg-white/5 border border-white/20 rounded p-3 flex-shrink-0">
                  <h2 className="text-md font-bold text-white mb-2">Docbot Client Link</h2>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value="Docbot client not configured"
                      className="flex-1 bg-white/10 text-white text-xs px-3 py-1 rounded border border-white/20 focus:outline-none"
                    />
                    <button
                      disabled
                      className="px-3 py-1 bg-gray-600 text-gray-400 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-not-allowed"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Docbot client is not available for external documents.</div>
                </div>
              )}

              {externalNamespace ? (
                <div className="flex-1 flex flex-col min-h-0">
                <TabbedDocumentPanel namespace={externalNamespace} />
                </div>
              ) : (
                <div className="text-red-500 bg-white/10 rounded-2xl p-8">External namespace not configured for your department.</div>
              )}
            </div>
          )}
          {activeTab === "FAQ Generator" && (
            <div className="flex-1 flex flex-col min-h-0">
              <FAQGeneratorPanel companyName={companyName} departmentName={departmentName} />
            </div>
          )}
        </main>

      </div>

    </div>
  );
} 