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
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <DepartmentAdminHeader companyName={companyName} departmentName={departmentName} userName={userName} />
      <div className="flex flex-1 relative">
        {/* Sidebar */}
        <aside className={`bg-[#111111] border-r border-white/5 flex flex-col py-6 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
        }`}>
          <div className="flex items-center justify-between px-6 mb-6">
            <h2 className="text-white text-base tracking-tight">Documents</h2>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="text-gray-400 hover:text-blue-400 transition-colors p-1.5 rounded-md hover:bg-blue-500/10"
              aria-label="Collapse sidebar"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
          <button
            className={`px-6 py-2.5 text-left text-sm tracking-tight transition-all duration-200 mx-2 rounded-lg mb-1 ${
              activeTab === "Internal Documents"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
            }`}
            onClick={() => setActiveTab("Internal Documents")}
          >
            Internal Documents
          </button>
          <button
            className={`px-6 py-2.5 text-left text-sm tracking-tight transition-all duration-200 mx-2 rounded-lg mb-1 ${
              activeTab === "External Documents"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
            }`}
            onClick={() => setActiveTab("External Documents")}
          >
            External Documents
          </button>
          <button
            className={`px-6 py-2.5 text-left text-sm tracking-tight transition-all duration-200 mx-2 rounded-lg mb-1 ${
              activeTab === "FAQ Generator"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
            }`}
            onClick={() => setActiveTab("FAQ Generator")}
          >
            FAQ Generator
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
        <main className="flex-1 flex flex-col min-w-0 p-8 overflow-auto bg-[#0a0a0a]">
          {activeTab === "Internal Documents" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Docbot Client Link - Always Visible */}
              {companyId && departmentId && (
                <div className="mb-6 bg-[#111111] border border-white/10 rounded-xl p-6 flex-shrink-0">
                  <h2 className="text-sm tracking-tight mb-4">Chatbot link</h2>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      readOnly
                      value={`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`}
                      className="flex-1 bg-blue-500/10 border border-white/10 text-blue-300 text-xs tracking-tight px-4 py-2.5 rounded-lg focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`https://docbot.meaningfulinnovations.org/company/${companyId}/department/${departmentId}`);
                        alert('Link copied to clipboard!');
                      }}
                      className="px-4 py-2.5 bg-blue-600 text-white hover:bg-blue-700 text-xs tracking-tight rounded-lg transition-all duration-200 whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 tracking-tight">Share this link with users to access the Docbot client.</div>
                </div>
              )}

              {internalNamespace ? (
                <div className="flex-1 flex flex-col min-h-0">
                <TabbedDocumentPanel namespace={internalNamespace} departmentId={departmentId} />
                </div>
              ) : (
                <div className="text-red-400 text-sm tracking-tight bg-white/5 border border-red-500/20 rounded-lg p-6">Internal namespace not configured for your department.</div>
              )}
            </div>
          )}
          {activeTab === "External Documents" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Docbot Client Link - Not Configured for External */}
              {companyId && departmentId && (
                <div className="mb-6 bg-[#111111] border border-white/10 rounded-xl p-6 flex-shrink-0">
                  <h2 className="text-sm tracking-tight mb-4">Chatbot link</h2>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      readOnly
                      value="Docbot client not configured"
                      className="flex-1 bg-blue-500/10 border border-white/10 text-gray-500 text-xs tracking-tight px-4 py-2.5 rounded-lg focus:outline-none"
                    />
                    <button
                      disabled
                      className="px-4 py-2.5 bg-blue-500/10 text-gray-500 text-xs tracking-tight rounded-lg transition-colors whitespace-nowrap cursor-not-allowed"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 tracking-tight">Docbot client is not available for external documents.</div>
                </div>
              )}

              {externalNamespace ? (
                <div className="flex-1 flex flex-col min-h-0">
                <TabbedDocumentPanel namespace={externalNamespace} departmentId={departmentId} />
                </div>
              ) : (
                <div className="text-red-400 text-sm tracking-tight bg-white/5 border border-red-500/20 rounded-lg p-6">External namespace not configured for your department.</div>
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