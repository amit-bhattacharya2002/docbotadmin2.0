"use client";
import { useState, useEffect, useRef } from "react";
import { FiRefreshCw } from "react-icons/fi";

export default function TabbedDocumentPanel({ namespace }: { namespace: string }) {
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

  // Fetch documents on mount and when namespace changes
  useEffect(() => {
    if (namespace) {
      fetchDocuments(true);
    }
  }, [namespace]);

  if (!namespace) {
    return <div className="text-red-500">Error: No namespace found for your department.</div>;
  }

  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "Internal" : "External";

  const handleUploadComplete = () => {
    fetchDocuments(true);
  };

  return (
    <div className="w-full bg-black rounded-2xl shadow-xl p-0 border border-white/20 flex flex-col">
      <div className="flex flex-col md:flex-row gap-8 p-8">
        {/* Upload Panel */}
        <div className="w-full md:w-1/2">
          <UploadDocumentPanel 
            namespace={namespace} 
            onUpload={handleUploadComplete}
          />
        </div>
        {/* Manage Panel */}
        <div className="w-full md:w-1/2 ">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-lg  w-full text-start font-light text-white">Manage Uploaded {namespaceType} Documents</h2>
            <button
              onClick={() => fetchDocuments(true)}
              className="p-2 rounded hover:bg-blue-500/20 transition flex items-start"
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
              await fetchDocuments(true);
            }} 
          />
        </div>
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
  const isProcessingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hide success status after 2 seconds
  useEffect(() => {
    if (status && (status.toLowerCase().includes('success') || status.includes('✅'))) {
      const timer = setTimeout(() => setStatus(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Hide success status and progress after 2 seconds
  useEffect(() => {
    if (status && (status.toLowerCase().includes('success') || status.includes('✅'))) {
      const timer = setTimeout(() => {
        setStatus(null);
        setProgress(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || loading || isProcessingRef.current) return;
    
    console.log('Starting upload process for file:', file.name);
    setLoading(true);
    setStatus(null);
    setProgress({ current: 0, total: 100, message: 'Requesting upload URL...', stage: 'uploading' });
    uploadCompleteRef.current = false;
    isProcessingRef.current = true;

    const maxRetries = 3;
    let retryCount = 0;

    const uploadWithRetry = async () => {
      try {
        // 1. Request signed upload URL from backend
        setProgress({ current: 10, total: 100, message: 'Requesting upload URL...', stage: 'uploading' });
        const uploadUrlRes = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            namespace,
          }),
        });
        if (!uploadUrlRes.ok) {
          throw new Error('Failed to get upload URL');
        }
        const { uploadUrl, fileKey } = await uploadUrlRes.json();
        if (!uploadUrl || !fileKey) {
          throw new Error('Invalid upload URL response');
        }

        // 2. Upload file directly to R2 using signed URL
        setProgress({ current: 30, total: 100, message: 'Uploading to storage...', stage: 'uploading' });
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
        if (!putRes.ok) {
          throw new Error('Failed to upload file to storage');
        }

        // 3. Process the uploaded file
        setProgress({ current: 60, total: 100, message: 'Processing document...', stage: 'processing' });
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
        // Update progress based on processing status
        if (data.nextPhase === 'embeddings') {
          setProgress({ 
            current: 80, 
            total: 100, 
            message: data.message, 
            stage: 'processing' 
          });
          // Process next batch
          const nextProcessResponse = await fetch('/api/documents/process', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              namespace,
              fileKey,
              fileName: file.name,
              startBatch: data.nextBatch
            }),
          });
          if (!nextProcessResponse.ok) {
            throw new Error('Failed to process next batch');
          }
          const nextData = await nextProcessResponse.json();
          setProgress({ 
            current: 100, 
            total: 100, 
            message: nextData.message, 
            stage: 'complete' 
          });
          setStatus(nextData.message);
        } else {
          setProgress({ 
            current: 100, 
            total: 100, 
            message: data.message, 
            stage: 'complete' 
          });
          setStatus(data.message);
        }
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        uploadCompleteRef.current = true;
        onUpload();
      } catch (error) {
        console.error('Upload error:', error);
        if (retryCount < maxRetries) {
          retryCount++;
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          setProgress(prev => ({ 
            ...prev!, 
            message: `Upload failed, retrying in ${delay/1000}s...`, 
            stage: 'retrying' 
          }));
          await new Promise(resolve => setTimeout(resolve, delay));
          return uploadWithRetry();
        }
        const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.';
        setStatus(errorMessage);
        setProgress(prev => ({ ...prev!, message: errorMessage, stage: 'error' }));
        uploadCompleteRef.current = true;
      }
    };

    try {
      await uploadWithRetry();
    } finally {
      isProcessingRef.current = false;
      setLoading(false);
    }
  };

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
    <form className="flex flex-col gap-4 w-full h-full items-center" onSubmit={handleSubmit}>
      <div className="w-full text-center mb-3">
        <h2 className="text-white text-start text-lg font-light  ">Upload Document to {namespaceType} Namespace</h2>
      </div>
      <div className="border-t-1 border-white/20  h-full w-full flex flex-col gap-4 items-center justify-start pt-20">
        <div className="flex flex-row w-full border-2 rounded-lg bg-white/10 border-white/10 items-center p-10 gap-4">
          <input
            ref={fileInputRef}
            type="file"
            className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
            onChange={e => setFile(e.target.files?.[0] || null)}
            accept=".pdf,.docx"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold w-full py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!file || loading}
          >
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>
        
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
      </div>
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
    <div className="flex flex-col gap-4 items-center border-t-1 border-white/20 pt-4 w-full overflow-y-auto h-[50vh]">
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