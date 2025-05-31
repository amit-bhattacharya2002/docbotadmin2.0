"use client";
import { useState, useEffect, useRef } from "react";
import { FiRefreshCw } from "react-icons/fi";

export default function TabbedDocumentPanel({ namespace }: { namespace: string }) {
  const [activeTab, setActiveTab] = useState("Upload Document");
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchRef = useRef<number>(0);

  // Refetch documents function
  const fetchDocuments = async (force = false) => {
    if (!namespace) return;

    const now = Date.now();
    // If last fetch was less than 2 seconds ago and not forced, skip
    if (!force && now - lastFetchRef.current < 2000) {
      console.log('Skipping fetch - too soon');
      return;
    }

    // Clear any pending fetch timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }

    // Cancel any ongoing fetch
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    
    // Create new controller for this fetch
    fetchControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/documents?namespace=${encodeURIComponent(namespace)}`,
        { signal: fetchControllerRef.current.signal }
      );
      if (!res.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await res.json();
      console.log('Fetched documents:', data);
      setDocuments(data.documents || []);
      lastFetchRef.current = now;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Fetch aborted');
        return;
      }
      console.error('Error fetching documents:', err);
      setError('Failed to load documents. Please try again.');
    } finally {
      setLoading(false);
      fetchControllerRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort();
      }
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, []);

  // Fetch documents when Manage tab is active
  useEffect(() => {
    if (activeTab === "Manage Document" && namespace) {
      // Use setTimeout to ensure we don't fetch too frequently
      fetchTimeoutRef.current = setTimeout(() => {
        fetchDocuments(true);
      }, 100);
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
        {activeTab === "Upload Document" && <UploadDocumentPanel namespace={namespace} onUpload={() => {
          setActiveTab("Manage Document");
          fetchDocuments(true); // Force refresh after upload
        }}/>} 
        {activeTab === "Manage Document" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Manage {namespaceType} Documents</h2>
              <button
                onClick={() => fetchDocuments(true)} // Force refresh on manual refresh
                className="p-2 rounded hover:bg-blue-500/20 transition flex items-center"
                aria-label="Refresh documents"
                disabled={loading}
              >
                <FiRefreshCw className={`h-6 w-6 text-blue-500 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {error && (
              <div className="text-red-400 text-sm mb-4">{error}</div>
            )}
            <ManageDocumentPanel 
              namespace={namespace} 
              documents={documents} 
              loading={loading} 
              onDelete={async (id) => {
                setDocuments(docs => docs.filter(doc => doc.id !== id));
                await fetchDocuments(true); // Force refresh after deletion
              }} 
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UploadDocumentPanel({ namespace, onUpload }: { namespace: string, onUpload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string; stage: string } | null>(null);
  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";
  const eventSourceRef = useRef<EventSource | null>(null);
  const uploadCompleteRef = useRef(false);

  // Debug logging for progress state changes
  useEffect(() => {
    console.log('Progress state updated:', progress);
  }, [progress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    
    console.log('Starting upload process for file:', file.name);
    setLoading(true);
    setStatus(null);
    setProgress({ current: 0, total: 100, message: 'Initializing upload...', stage: 'uploading' });
    uploadCompleteRef.current = false;

    try {
      // 1. Get pre-signed URL
      const presignedResponse = await fetch('/api/documents/presigned-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          namespace,
          fileName: file.name,
          contentType: file.type,
        }),
      });

      if (!presignedResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { uploadUrl, fileKey } = await presignedResponse.json();

      // 2. Upload directly to R2
      setProgress({ current: 20, total: 100, message: 'Uploading to storage...', stage: 'uploading' });
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      // 3. Process the uploaded file
      setProgress({ current: 40, total: 100, message: 'Processing document...', stage: 'processing' });
      
      const processResponse = await fetch('/api/documents/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          namespace,
          fileKey,
          fileName: file.name,
        }),
      });

      if (!processResponse.ok) {
        throw new Error('Failed to process file');
      }

      const data = await processResponse.json();
      setStatus(data.message);
      setFile(null);
      onUpload();
      
      setProgress({ current: 100, total: 100, message: 'Upload complete!', stage: 'complete' });
      uploadCompleteRef.current = true;

    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.';
      setStatus(errorMessage);
      setProgress(prev => ({ ...prev!, message: errorMessage, stage: 'error' }));
      uploadCompleteRef.current = true;
    } finally {
      setLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current && !uploadCompleteRef.current) {
        console.log('Cleaning up EventSource on unmount - upload not complete');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'uploading':
        return 'bg-blue-600';
      case 'parsing':
        return 'bg-purple-600';
      case 'embedding':
        return 'bg-green-600';
      case 'upserting':
        return 'bg-yellow-600';
      case 'complete':
        return 'bg-green-600';
      case 'error':
        return 'bg-red-600';
      default:
        return 'bg-blue-600';
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
        accept=".pdf,.docx"
      />
      <button
        type="submit"
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!file || loading}
      >
        {loading ? "Uploading..." : "Upload"}
      </button>
      
      {progress && (
        <div className="w-full max-w-md mt-2 bg-white/5 p-4 rounded-lg">
          <div className="flex justify-between text-sm text-gray-300 mb-2">
            <span className="font-medium">{progress.message}</span>
            <span className="font-semibold">{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2.5">
            <div 
              className={`${getStageColor(progress.stage)} h-2.5 rounded-full transition-all duration-300 ease-out`}
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Stage: {progress.stage.charAt(0).toUpperCase() + progress.stage.slice(1)}
          </div>
        </div>
      )}
      
      {status && (
        <div className={`text-sm mt-2 ${
          status.includes('✅') ? 'text-green-400' : 
          status.includes('already been uploaded') ? 'text-yellow-400' : 
          'text-red-400'
        }`}>
          {status.includes('already been uploaded') ? (
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{status}</span>
            </div>
          ) : status}
        </div>
      )}
    </form>
  );
}

function ManageDocumentPanel({ namespace, documents, loading, onDelete }: { namespace: string, documents: any[], loading: boolean, onDelete: (id: string) => void }) {
  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null);

  const handleDelete = async (doc: any) => {
    if (!confirm(`Are you sure you want to delete this ${namespaceType.toLowerCase()} document?`)) return;
    
    // Use the R2 URL key for deletion
    const r2UrlKey = doc.id; // This is already the R2 URL key from our documents API
    console.log('Deleting document with R2 URL key:', r2UrlKey);
    
    setDeletingDocId(doc.id);
    setDeleteProgress({ current: 0, total: 100 }); // Initialize progress
    
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(r2UrlKey)}?namespace=${encodeURIComponent(namespace)}`, { 
        method: "DELETE" 
      });
      
      if (res.ok) {
        console.log('Document deleted successfully');
        setDeleteProgress({ current: 100, total: 100 }); // Set to complete
        setTimeout(() => {
          setDeletingDocId(null);
          setDeleteProgress(null);
          onDelete(doc.id);
        }, 500); // Give user time to see completion
      } else {
        console.error('Failed to delete document:', await res.text());
        alert('Failed to delete document. Please try again.');
        setDeletingDocId(null);
        setDeleteProgress(null);
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document. Please try again.');
      setDeletingDocId(null);
      setDeleteProgress(null);
    }
  };

  const handleDownload = async (doc: any) => {
    try {
      const response = await fetch(`/api/documents/download?key=${encodeURIComponent(doc.r2Url)}`);
      if (!response.ok) throw new Error('Failed to get download URL');
      const data = await response.json();
      
      if (doc.source.toLowerCase().endsWith('.docx')) {
        // For DOCX files, create a temporary link to force download
        const link = document.createElement('a');
        link.href = data.url;
        link.download = doc.source; // Use original filename
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // For other files (like PDFs), open in new tab
        window.open(data.url, '_blank');
      }
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to open document. Please try again.');
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
              <div className="flex flex-col flex-1">
                <button 
                  onClick={() => handleDownload(doc)}
                  className="font-medium hover:text-blue-400 transition-colors cursor-pointer flex items-center gap-2 text-left"
                >
                  {doc.source}
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <span className="text-xs text-gray-400">{new Date(doc.createdAt).toLocaleString()}</span>
                {deletingDocId === doc.id && deleteProgress && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Deleting document...</span>
                      <span>{Math.round((deleteProgress.current / deleteProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5">
                      <div 
                        className="bg-red-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <button
                className="text-red-400 hover:text-red-600 font-semibold text-sm px-3 py-1 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-4"
                onClick={() => handleDelete(doc)}
                disabled={deletingDocId === doc.id}
              >
                {deletingDocId === doc.id ? 'Deleting...' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
} 