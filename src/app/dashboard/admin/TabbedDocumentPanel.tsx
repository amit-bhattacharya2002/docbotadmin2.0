"use client";
import { useState, useEffect } from "react";

export default function TabbedDocumentPanel({ namespace }: { namespace: string }) {
  console.log("[TabbedDocumentPanel] namespace:", namespace);
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

  return (
    <div className="w-full max-w-2xl bg-white/10 rounded-2xl shadow-xl p-0 border border-white/20 flex flex-col">
      <div className="flex">
        <button
          className={`flex-1 px-6 py-3 rounded-tl-2xl font-semibold text-lg transition-colors ${activeTab === "Upload Document" ? "bg-blue-600 text-white" : "bg-white/10 text-white hover:bg-blue-500/30"}`}
          onClick={() => setActiveTab("Upload Document")}
        >
          Upload Document
        </button>
        <button
          className={`flex-1 px-6 py-3 rounded-tr-2xl font-semibold text-lg transition-colors ${activeTab === "Manage Document" ? "bg-blue-600 text-white" : "bg-white/10 text-white hover:bg-blue-500/30"}`}
          onClick={() => setActiveTab("Manage Document")}
        >
          Manage Document
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
  console.log("[UploadDocumentPanel] namespace:", namespace);

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
  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/documents/${id}?namespace=${encodeURIComponent(namespace)}`, { method: "DELETE" });
    if (res.ok) onDelete(id);
  };
  return (
    <div className="flex flex-col gap-4 items-center w-full">
      {loading ? (
        <div className="text-gray-300">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-gray-300 text-center">No documents uploaded yet.</div>
      ) : (
        <ul className="w-full space-y-2">
          {documents.map(doc => (
            <li key={doc.id} className="flex justify-between items-center bg-white/10 text-white px-4 py-2 rounded-lg">
              <span>{doc.source}</span>
              <button
                className="text-red-400 hover:text-red-600 font-semibold text-sm"
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