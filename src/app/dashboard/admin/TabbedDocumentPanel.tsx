"use client";
import { useState, useEffect } from "react";

export default function TabbedDocumentPanel({ namespace }: { namespace: string }) {
  const [activeTab, setActiveTab] = useState("Upload Document");
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch documents when Manage tab is active
  useEffect(() => {
    if (activeTab === "Manage Document" && namespace) {
      setLoading(true);
      fetch(`/api/documents?namespace=${encodeURIComponent(namespace)}`)
        .then(res => res.json())
        .then(data => setDocuments(data.documents || []))
        .finally(() => setLoading(false));
    }
  }, [activeTab, namespace]);

  if (!namespace) {
    return <div className="text-red-500">Error: No namespace found for your department.</div>;
  }

  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";

  return (
    <div className="w-full bg-white/10 rounded-2xl shadow-xl p-0 border border-white/20 flex flex-col">
      <div className="flex">
        <button
          className={`flex-1 px-6 py-3 rounded-tl-2xl font-semibold text-lg transition-colors ${activeTab === "Upload Document" ? "bg-blue-600 text-white" : "bg-white/10 text-white hover:bg-blue-500/30"}`}
          onClick={() => setActiveTab("Upload Document")}
        >
          Upload {namespaceType} Document
        </button>
        <button
          className={`flex-1 px-6 py-3 rounded-tr-2xl font-semibold text-lg transition-colors ${activeTab === "Manage Document" ? "bg-blue-600 text-white" : "bg-white/10 text-white hover:bg-blue-500/30"}`}
          onClick={() => setActiveTab("Manage Document")}
        >
          Manage {namespaceType} Documents
        </button>
      </div>
      <div className="p-8">
        {activeTab === "Upload Document" && <UploadDocumentPanel namespace={namespace} onUpload={() => setActiveTab("Manage Document")}/>} 
        {activeTab === "Manage Document" && <ManageDocumentPanel namespace={namespace} documents={documents} loading={loading} onDelete={id => setDocuments(docs => docs.filter(doc => doc.id !== id))} />}
      </div>
    </div>
  );
}

function UploadDocumentPanel({ namespace, onUpload }: { namespace: string, onUpload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setStatus(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("namespace", namespace);
    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    setLoading(false);
    setStatus(data.message || (res.ok ? "Uploaded!" : "Upload failed."));
    if (res.ok) {
      setFile(null);
      onUpload();
    }
  };

  return (
    <form className="flex flex-col gap-4 items-center" onSubmit={handleSubmit}>
      <div className="w-full text-center mb-2">
        <p className="text-gray-300 text-sm">Upload a document to the {namespaceType.toLowerCase()} namespace</p>
      </div>
      <input
        type="file"
        className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
        onChange={e => setFile(e.target.files?.[0] || null)}
      />
      <button
        type="submit"
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        disabled={!file || loading}
      >
        {loading ? "Uploading..." : "Upload"}
      </button>
      {status && <div className="text-white text-sm mt-2">{status}</div>}
    </form>
  );
}

function ManageDocumentPanel({ namespace, documents, loading, onDelete }: { namespace: string, documents: any[], loading: boolean, onDelete: (id: string) => void }) {
  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to delete this ${namespaceType.toLowerCase()} document?`)) return;
    
    const res = await fetch(`/api/documents/${id}?namespace=${encodeURIComponent(namespace)}`, { method: "DELETE" });
    if (res.ok) onDelete(id);
  };

  const handleDocumentClick = (e: React.MouseEvent, r2Url: string) => {
    if (!r2Url) {
      e.preventDefault();
      alert('Document URL is not available. Please try again later.');
    }
  };

  return (
    <div className="flex flex-col gap-4 items-center w-full">
      {loading ? (
        <div className="text-gray-300">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-gray-300 text-center">No {namespaceType.toLowerCase()} documents uploaded yet.</div>
      ) : (
        <ul className="w-full space-y-2">
          {documents.map(doc => (
            <li key={doc.id} className="flex justify-between items-center bg-white/10 text-white px-4 py-3 rounded-lg">
              <div className="flex flex-col">
                <a 
                  href={doc.r2Url || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="font-medium hover:text-blue-400 transition-colors cursor-pointer flex items-center gap-2"
                  onClick={(e) => handleDocumentClick(e, doc.r2Url)}
                >
                  {doc.source}
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <span className="text-xs text-gray-400">{new Date(doc.createdAt).toLocaleString()}</span>
              </div>
              <button
                className="text-red-400 hover:text-red-600 font-semibold text-sm px-3 py-1 rounded hover:bg-red-500/10 transition-colors"
                onClick={() => handleDelete(doc.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
} 