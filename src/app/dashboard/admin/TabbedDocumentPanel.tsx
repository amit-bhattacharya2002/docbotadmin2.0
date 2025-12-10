"use client";
import { useState, useEffect, useRef } from "react";
import { FiRefreshCw } from "react-icons/fi";

export default function TabbedDocumentPanel({ 
  namespace, 
  departmentId 
}: { 
  namespace: string;
  departmentId?: string;
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(""); // Empty string = root folder
  const [subfolders, setSubfolders] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"upload" | "manage">("upload");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchRef = useRef<number>(0);

  const isInternal = namespace.includes("_Internal");
  const namespaceType = isInternal ? "INTERNAL" : "EXTERNAL";

  // Fetch subfolders
  useEffect(() => {
    if (departmentId) {
      fetch(`/api/subfolders?departmentId=${departmentId}&namespaceType=${namespaceType}`)
        .then(res => res.json())
        .then(data => {
          setSubfolders(data.subfolders || []);
        })
        .catch(err => console.error('Error fetching subfolders:', err));
    }
  }, [departmentId, namespaceType]);

  // Refetch documents function
  const fetchDocuments = async (force = false, folderId?: string) => {
    if (!namespace) return;

    const targetFolderId = folderId !== undefined ? folderId : selectedFolderId;
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
      // Build URL with subfolderId if a folder is selected
      let url = `/api/documents?namespace=${encodeURIComponent(namespace)}`;
      if (targetFolderId) {
        url += `&subfolderId=${encodeURIComponent(targetFolderId)}`;
      }

      const res = await fetch(url, { signal: fetchControllerRef.current.signal });
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

  // Fetch documents when folder selection changes
  useEffect(() => {
    if (namespace) {
      fetchDocuments(true, selectedFolderId);
    }
  }, [namespace, selectedFolderId]);

  if (!namespace) {
    return <div className="text-red-500">Error: No namespace found for your department.</div>;
  }

  const handleUploadComplete = () => {
    fetchDocuments(true);
  };

  const handleFolderSelect = (folderId: string) => {
    setSelectedFolderId(folderId);
    setActiveTab("manage"); // Switch to manage tab when selecting a folder
  };

  const selectedFolder = selectedFolderId 
    ? subfolders.find(f => f.id === selectedFolderId)
    : null;

  const handleSubfolderChange = () => {
    // Refetch subfolders and documents
    fetch(`/api/subfolders?departmentId=${departmentId}&namespaceType=${namespaceType}`)
      .then(res => res.json())
      .then(data => {
        setSubfolders(data.subfolders || []);
        fetchDocuments(true);
      })
      .catch(err => console.error('Error fetching subfolders:', err));
  };

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!confirm(`Are you sure you want to delete the folder "${folderName}"? This will not delete the documents inside.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/subfolders/${folderId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        handleSubfolderChange();
        // If deleted folder was selected, switch to root folder
        if (selectedFolderId === folderId) {
          setSelectedFolderId("");
        }
      } else {
        const data = await res.json();
        alert(data.message || "Failed to delete folder");
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
      alert("Failed to delete folder");
    }
  };


  return (
    <div className="w-full h-full bg-[#111111] rounded-xl border border-white/5 flex flex-col flex-1 min-h-0">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar - Folder List */}
        <div className="w-1/2 border-r border-white/5 flex flex-col">
          <div className="p-6 border-b border-white/5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base tracking-tight text-white">Folders</h2>
              {departmentId && (
                <button
                  onClick={() => setShowNewFolderModal(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs tracking-tight rounded-lg transition-all duration-200 hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Folder
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 tracking-tight">Select a folder to view documents</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* Root Folder Option */}
            <button
              onClick={() => handleFolderSelect("")}
              className={`w-full text-left px-4 py-2.5 rounded-lg mb-1.5 transition-all duration-200 ${
                selectedFolderId === ""
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="text-sm tracking-tight">Root Folder</span>
              </div>
            </button>
            
            {/* Subfolders List */}
            {subfolders.map((subfolder) => (
              <div
                key={subfolder.id}
                className={`group w-full px-4 py-2.5 rounded-lg mb-1.5 transition-all duration-200 ${
                  selectedFolderId === subfolder.id
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleFolderSelect(subfolder.id)}
                    className="flex-1 flex items-center gap-2.5 text-left"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-sm tracking-tight">{subfolder.name}</span>
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(subfolder.id, subfolder.name);
                      }}
                      className="p-1.5 hover:bg-red-500/10 rounded transition-colors text-red-400"
                      title="Delete folder"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            
            {subfolders.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-12 tracking-tight">
                No folders created yet. Click "New Folder" to create one.
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Upload/Manage */}
        <div className="w-1/2 flex flex-col min-h-0">
          {(selectedFolderId === "" || selectedFolder) ? (
            <>
              {/* Tabs */}
              <div className="flex border-b border-white/5">
                <button
                  onClick={() => setActiveTab("upload")}
                  className={`flex-1 px-4 py-3 text-center text-sm tracking-tight transition-all duration-200 ${
                    activeTab === "upload"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
                  }`}
                >
                  Upload Document
                </button>
                <button
                  onClick={() => setActiveTab("manage")}
                  className={`flex-1 px-4 py-3 text-center text-sm tracking-tight transition-all duration-200 ${
                    activeTab === "manage"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
                  }`}
                >
                  Manage Documents
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === "upload" ? (
          <UploadDocumentPanel 
            namespace={namespace} 
                    departmentId={departmentId}
                    namespaceType={namespaceType}
                    selectedSubfolderId={selectedFolderId || undefined}
                    selectedFolderName={selectedFolder ? selectedFolder.name : "Root Folder"}
            onUpload={handleUploadComplete}
          />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h2 className="text-base tracking-tight text-white mb-1">
                          {selectedFolder ? `Documents in "${selectedFolder.name}"` : "Documents in Root Folder"}
                        </h2>
                        <p className="text-gray-500 text-xs tracking-tight">
                          {selectedFolder ? `Showing documents uploaded to ${selectedFolder.name}` : "Showing documents in the root folder"}
                        </p>
        </div>
              <button
                onClick={() => fetchDocuments(true)}
                        className="p-2 rounded-lg hover:bg-blue-500/10 transition-all duration-200"
                aria-label="Refresh documents"
                disabled={loading}
              >
                        <FiRefreshCw className={`h-4 w-4 text-blue-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
          </div>
          {error && (
                      <div className="text-red-400 text-xs mb-4 tracking-tight">{error}</div>
          )}
          <ManageDocumentPanel 
                      namespace={selectedFolder ? selectedFolder.pineconeNamespace : namespace} 
            documents={documents} 
            loading={loading} 
            onDelete={async (id) => {
              setDocuments(docs => docs.filter(doc => doc.id !== id));
                        await fetchDocuments(true, selectedFolderId);
                      }} 
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-sm tracking-tight">Select a folder to view documents</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Folder Modal */}
      {showNewFolderModal && departmentId && (
        <SubfolderManagerModal
          departmentId={departmentId}
          namespaceType={namespaceType}
          namespace={namespace}
          onClose={() => setShowNewFolderModal(false)}
          onSubfolderChange={handleSubfolderChange}
        />
      )}
    </div>
  );
}

function UploadDocumentPanel({ 
  namespace, 
  onUpload,
  departmentId,
  namespaceType,
  selectedSubfolderId,
  selectedFolderName
}: { 
  namespace: string;
  onUpload: () => void;
  departmentId?: string;
  namespaceType: "INTERNAL" | "EXTERNAL";
  selectedSubfolderId?: string;
  selectedFolderName?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [docTypeHint, setDocTypeHint] = useState<'faq' | 'glossary' | 'manual' | ''>('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string; stage: string } | null>(null);
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
            subfolderId: selectedSubfolderId || undefined,
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
            subfolderId: selectedSubfolderId || undefined,
            docTypeHint: docTypeHint || undefined,
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
              startBatch: data.nextBatch,
              subfolderId: selectedSubfolderId || undefined,
              docTypeHint: docTypeHint || undefined,
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
        setDocTypeHint('');
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
    <form className="flex flex-col gap-6 w-full h-full items-center" onSubmit={handleSubmit}>
      <div className="w-full text-start mb-0 gap-1.5 flex flex-col">
        <h2 className="text-white text-base tracking-tight">Upload Document</h2>
        <p className="text-gray-500 text-xs tracking-tight">Select a file and click upload</p>
      </div>
      <div className="border-t border-white/5 h-full w-full flex flex-col gap-6 items-center justify-start pt-6">
        <div className="w-full bg-blue-500/10 border border-white/10 rounded-lg p-3">
          <p className="text-xs text-gray-400 tracking-tight">
            <span className="text-blue-300">Uploading to:</span> <span className="text-blue-400">{selectedFolderName || "Root Folder"}</span>
          </p>
        </div>
        <div className="flex flex-col w-full border border-white/10 rounded-lg bg-blue-500/10 p-6 gap-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full">
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="block w-full text-xs text-gray-400 file:mr-4 file:text-xs file:py-2 file:px-4 file:rounded-lg file:border-0 file:tracking-tight file:bg-blue-600 file:text-white hover:file:bg-blue-700 transition-colors"
                onChange={e => setFile(e.target.files?.[0] || null)}
                accept=".pdf,.docx"
                placeholder="Choose a file..."
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white hover:bg-blue-700 text-xs tracking-tight py-2.5 px-5 rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap w-full sm:w-auto flex-shrink-0"
              disabled={!file || loading}
            >
              {loading ? "Uploading..." : "Upload"}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400 tracking-tight">Document Type (Optional)</label>
            <select
              value={docTypeHint}
              onChange={(e) => setDocTypeHint(e.target.value as 'faq' | 'glossary' | 'manual' | '')}
              className="px-4 py-2.5 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Auto-detect</option>
              <option value="faq">FAQ (Q&A Format)</option>
              <option value="glossary">Glossary</option>
              <option value="manual">Manual (Large PDF)</option>
            </select>
            <p className="text-xs text-gray-500 tracking-tight mt-1">
              Select a type to optimize processing. Leave as "Auto-detect" for automatic detection.
            </p>
          </div>
          {file && (
            <div className="text-xs text-gray-400 px-3 py-2.5 bg-blue-500/10 rounded-lg border border-white/10 break-words overflow-wrap-anywhere" title={file.name}>
              <span className="text-blue-300 tracking-tight">Selected:</span> <span className="ml-1.5 text-blue-400">{file.name}</span>
            </div>
          )}
        </div>
        
        {progress && (
          <div className="w-full max-w-md bg-blue-500/10 border border-white/10 p-4 rounded-lg">
            <div className="flex justify-between text-xs text-gray-400 mb-2 tracking-tight">
              <span>{progress.message}</span>
              <span className="text-blue-400">{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-blue-500/20 rounded-full h-1.5">
              <div
                className={`${getStageColor(progress.stage)} h-1.5 rounded-full transition-all duration-300 ease-out`}
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500 tracking-tight">
              {progress.stage.charAt(0).toUpperCase() + progress.stage.slice(1)}
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
    <div className="flex flex-col gap-3 items-center border-t border-white/5 pt-6 w-full overflow-y-auto">
      {loading ? (
        <div className="text-gray-500 text-xs tracking-tight py-8">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-gray-500 text-xs text-center tracking-tight py-12">No {namespaceType.toLowerCase()} documents uploaded yet.</div>
      ) : (
        <ul className="w-full space-y-2">
          {documents
            .slice()
            .sort((a, b) => a.source.localeCompare(b.source, undefined, { sensitivity: 'base' }))
            .map(doc => (
              <li key={doc.id} className="flex justify-between items-center bg-blue-500/10 border border-white/10 text-blue-300 px-4 py-3 rounded-lg hover:bg-blue-500/20 transition-all duration-200">
                <div className="flex flex-col flex-1 min-w-0">
                  <button 
                    onClick={() => handleDownload(doc)}
                    className="text-sm tracking-tight hover:text-blue-400 transition-colors cursor-pointer flex items-center gap-2 text-left truncate"
                  >
                    <span className="truncate">{doc.source}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </button>
                  <span className="text-xs text-gray-500 tracking-tight mt-1">{new Date(doc.createdAt).toLocaleString()}</span>
                  {deletingDocId === doc.id && deleteProgress && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1 tracking-tight">
                        <span>Deleting...</span>
                        <span>{Math.round((deleteProgress.current / deleteProgress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-blue-500/20 rounded-full h-1">
                        <div 
                          className="bg-red-400 h-1 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <button
                  className="text-red-400 hover:text-red-300 text-xs tracking-tight px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ml-4 flex-shrink-0"
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

// Subfolder Manager Modal Component
function SubfolderManagerModal({
  departmentId,
  namespaceType,
  namespace,
  onClose,
  onSubfolderChange
}: {
  departmentId: string;
  namespaceType: "INTERNAL" | "EXTERNAL";
  namespace: string;
  onClose: () => void;
  onSubfolderChange: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 rounded-lg border border-white/20 p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Manage Folders</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <SubfolderManager
          departmentId={departmentId}
          namespaceType={namespaceType}
          namespace={namespace}
          onSubfolderChange={() => {
            onSubfolderChange();
            // Optionally close modal after creating a folder
            // onClose();
          }}
        />
      </div>
    </div>
  );
}

// Subfolder Manager Component
function SubfolderManager({ 
  departmentId, 
  namespaceType, 
  namespace,
  onSubfolderChange 
}: { 
  departmentId: string;
  namespaceType: "INTERNAL" | "EXTERNAL";
  namespace: string;
  onSubfolderChange: () => void;
}) {
  const [subfolders, setSubfolders] = useState<any[]>([]);
  const [newSubfolderName, setNewSubfolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchSubfolders();
  }, [departmentId, namespaceType]);

  const fetchSubfolders = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/subfolders?departmentId=${departmentId}&namespaceType=${namespaceType}`
      );
      const data = await res.json();
      setSubfolders(data.subfolders || []);
    } catch (error) {
      console.error("Error fetching subfolders:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubfolderName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/subfolders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSubfolderName.trim(),
          departmentId,
          namespaceType,
        }),
      });

      if (res.ok) {
        setNewSubfolderName("");
        await fetchSubfolders();
        onSubfolderChange();
      } else {
        const data = await res.json();
        alert(data.message || "Failed to create subfolder");
      }
    } catch (error) {
      console.error("Error creating subfolder:", error);
      alert("Failed to create subfolder");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSubfolder = async (subfolderId: string) => {
    if (!confirm("Are you sure you want to delete this subfolder? This will not delete the documents inside.")) {
      return;
    }

    try {
      const res = await fetch(`/api/subfolders/${subfolderId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchSubfolders();
        onSubfolderChange();
      } else {
        const data = await res.json();
        alert(data.message || "Failed to delete subfolder");
      }
    } catch (error) {
      console.error("Error deleting subfolder:", error);
      alert("Failed to delete subfolder");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-white text-sm tracking-tight mb-3">Create New Folder</h3>
        <form onSubmit={handleCreateSubfolder} className="flex gap-2">
          <input
            type="text"
            value={newSubfolderName}
            onChange={(e) => setNewSubfolderName(e.target.value)}
            placeholder="Enter folder name..."
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-white/10 text-blue-300 text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-500"
            disabled={creating}
          />
          <button
            type="submit"
            disabled={creating || !newSubfolderName.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white hover:bg-blue-700 text-sm tracking-tight rounded-lg transition-all duration-200 disabled:opacity-40"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </form>
      </div>

      <div>
        <h3 className="text-white text-sm tracking-tight mb-3">Existing Folders</h3>
        {loading ? (
          <div className="text-gray-500 text-xs tracking-tight py-4">Loading folders...</div>
        ) : subfolders.length === 0 ? (
          <div className="text-gray-500 text-xs tracking-tight py-4">No folders created yet.</div>
        ) : (
          <div className="space-y-2">
            {subfolders.map((subfolder) => (
              <div
                key={subfolder.id}
                className="flex items-center justify-between bg-blue-500/10 border border-white/10 px-4 py-3 rounded-lg text-blue-300 hover:bg-blue-500/20 transition-all duration-200"
              >
                <div className="flex items-center gap-2.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="text-sm tracking-tight">{subfolder.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteSubfolder(subfolder.id)}
                  className="text-red-400 hover:text-red-300 text-xs tracking-tight px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-all duration-200"
                  title="Delete folder"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}