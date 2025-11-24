"use client";
import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { FiLink } from "react-icons/fi";

type DepartmentAdminGroup = {
  departmentId: string;
  departmentName: string;
  admins: { id: string; name: string; email: string; adminId: string }[];
};

type Props = {
  user: { name?: string; company?: string; email?: string } | undefined;
  company: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  departmentAdmins: DepartmentAdminGroup[];
};

export default function SuperAdminDashboardClient({ user, company, departments: initialDepartments, departmentAdmins }: Props) {
  console.log('SuperAdminDashboardClient user:', user);
  console.log('SuperAdminDashboardClient company:', company);
  console.log('SuperAdminDashboardClient departments:', initialDepartments);
  console.log('departmentAdmins:', departmentAdmins);
  const [activeTab, setActiveTab] = useState("Departments");
  const [departments, setDepartments] = useState(initialDepartments);
  const [newDept, setNewDept] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingDept, setDeletingDept] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({
    name: "",
    email: "",
    password: "",
    adminId: "",
    departmentId: initialDepartments.length > 0 ? initialDepartments[0].id : "",
  });
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [deletingAdmin, setDeletingAdmin] = useState<string | null>(null);
  const [refreshingAdmins, setRefreshingAdmins] = useState(false);
  const [refreshingDepts, setRefreshingDepts] = useState(false);
  const [localDepartmentAdmins, setLocalDepartmentAdmins] = useState<DepartmentAdminGroup[]>(departmentAdmins);
  const [expandedDeptLinks, setExpandedDeptLinks] = useState<Record<string, boolean>>({});

  const handleRefreshAdmins = async () => {
    setRefreshingAdmins(true);
    try {
      const res = await fetch("/api/department-admins");
      const data = await res.json();
      if (res.ok) {
        setLocalDepartmentAdmins(data);
      } else {
        console.error("Failed to fetch department admins:", data.message);
      }
    } catch (error) {
      console.error("Error fetching department admins:", error);
    } finally {
      setRefreshingAdmins(false);
    }
  };

  const handleRefreshDepartments = async () => {
    setRefreshingDepts(true);
    try {
      const res = await fetch("/api/departments");
      const data = await res.json();
      if (res.ok) {
        setDepartments(data.departments);
      } else {
        console.error("Failed to fetch departments:", data.message);
      }
    } catch (error) {
      console.error("Error fetching departments:", error);
    } finally {
      setRefreshingDepts(false);
    }
  };

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    if (newDept.trim() && !departments.some(d => d.name === newDept.trim())) {
      setLoading(true);
      setStatus(null);
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDept.trim(), companyId: company.id }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.department) {
        setDepartments([...departments, data.department]);
        setNewDept("");
        setStatus("Department created!");
      } else {
        setStatus(data.message || "Failed to create department.");
      }
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({ callbackUrl: "/login" });
    setLoggingOut(false);
  };

  const handleAdminFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAdminForm({ ...adminForm, [e.target.name]: e.target.value });
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminStatus(null);
    const res = await fetch("/api/create-department-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...adminForm, companyId: company?.id }),
    });
    const data = await res.json();
    setAdminLoading(false);
    if (res.ok) {
      setAdminStatus("Department Admin created!");
      setAdminForm({
        name: "",
        email: "",
        password: "",
        adminId: "",
        departmentId: initialDepartments.length > 0 ? initialDepartments[0].id : "",
      });
    } else {
      setAdminStatus(data.message || "Failed to create Department Admin.");
    }
  };

  const handleDeleteDepartment = async (departmentId: string) => {
    if (!confirm('Are you sure you want to delete this department?')) return;
    
    setDeletingDept(departmentId);
    try {
      const res = await fetch(`/api/departments/${departmentId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      
      if (res.ok) {
        setDepartments(departments.filter(dept => dept.id !== departmentId));
        setStatus("Department deleted successfully!");
      } else {
        setStatus(data.message || "Failed to delete department.");
      }
    } catch (error) {
      setStatus("An error occurred while deleting the department.");
    } finally {
      setDeletingDept(null);
    }
  };

  const handleDeleteAdmin = async (adminId: string, departmentId: string) => {
    if (!confirm('Are you sure you want to delete this department admin?')) return;
    setDeletingAdmin(adminId);
    try {
      const res = await fetch(`/api/department-admins/${adminId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setAdminStatus("Department Admin deleted successfully!");
        setAdminForm((prev) => ({ ...prev }));
        setAdminStatus(null);
        setDeletingAdmin(null);
        window.location.reload();
      } else {
        setAdminStatus(data.message || "Failed to delete department admin.");
      }
    } catch (error) {
      setAdminStatus("An error occurred while deleting the department admin.");
    } finally {
      setDeletingAdmin(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white/10 backdrop-blur-lg border-b border-white/20">
        <div className="flex items-center gap-2 text-white text-2xl font-bold">
          <span>{company?.name || "Company"}</span>
          <span className="text-blue-400 font-semibold">Docbot</span>
        </div>
        <div className="relative">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-white/20 rounded-lg text-white hover:bg-white/30 focus:outline-none"
            onClick={() => setDropdownOpen((open) => !open)}
          >
            <span>{user?.name || "User"}</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-40 bg-white/90 rounded-lg shadow-lg z-10">
              <div className="px-4 py-2 text-gray-800 border-b">{user?.name || "User"}</div>
              <button
                className="w-full px-4 py-2 text-left text-red-600 hover:bg-gray-100 rounded-b-lg disabled:opacity-60"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900 border-r border-white/10 flex flex-col py-8">
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "Departments"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("Departments")}
          >
            Departments
          </button>
          <button
            className={`px-6 py-3 text-left text-lg font-semibold transition-colors ${
              activeTab === "Department Admins"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-blue-500/20"
            }`}
            onClick={() => setActiveTab("Department Admins")}
          >
            Department Admins
          </button>
          <div className="flex-1" />
        </aside>
        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto">
          {activeTab === "Departments" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Department List */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-xl font-bold text-white">All Departments</h3>
                  <button
                    onClick={handleRefreshDepartments}
                    disabled={refreshingDepts}
                    className="p-1 rounded-full hover:bg-white/20 focus:outline-none"
                    title="Refresh"
                  >
                    {refreshingDepts ? (
                      <svg
                        className="w-5 h-5 text-white animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                </div>
                <ul className="space-y-2">
                  {departments.map((dept) => (
                    <li key={dept.id} className="bg-white/20 text-white px-4 py-2 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 flex-1">
                          <span className="font-semibold">{dept.name}</span>
                          {/* Docbot Client Link Toggle */}
                          {company && (
                            <button
                              onClick={() => setExpandedDeptLinks(prev => ({ ...prev, [dept.id]: !prev[dept.id] }))}
                              className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                            >
                              <FiLink className="w-3 h-3" />
                              {expandedDeptLinks[dept.id] ? 'Hide Docbot Client Link' : 'Show Docbot Client Link'}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteDepartment(dept.id)}
                          disabled={deletingDept === dept.id}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {deletingDept === dept.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                      {/* Collapsible Docbot Client Link */}
                      {company && expandedDeptLinks[dept.id] && (
                        <div className="mt-2 bg-white/5 border border-white/20 rounded p-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={`https://docbot.meaningfulinnovations.org/company/${company.id}/department/${dept.id}`}
                              className="flex-1 bg-white/10 text-white text-xs px-2 py-1 rounded border border-white/20 focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`https://docbot.meaningfulinnovations.org/company/${company.id}/department/${dept.id}`);
                                alert('Link copied to clipboard!');
                              }}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Add Department Form */}
              <div>
                <h3 className="text-xl font-bold text-white mb-4">Create New Department</h3>
                <form onSubmit={handleAddDepartment} className="flex flex-col gap-4">
                  <input
                    className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Department Name"
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    required
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
                    disabled={loading}
                  >
                    {loading ? "Adding..." : "Add Department"}
                  </button>
                  {status && <div className="text-white text-sm mt-2">{status}</div>}
                </form>
              </div>
            </div>
          )}
          {activeTab === "Department Admins" && (
            <div className="flex flex-col md:flex-row gap-8">
              <div className="w-full h-full max-w-2xl ">
                <div className="flex items-center gap-2 mb-6">
                  <h3 className="text-2xl font-semibold text-white tracking-tight">Department Admins</h3>
                  <button
                    onClick={handleRefreshAdmins}
                    disabled={refreshingAdmins}
                    className="p-1 rounded-full hover:bg-white/20 focus:outline-none"
                    title="Refresh"
                  >
                    {refreshingAdmins ? (
                      <svg
                        className="w-5 h-5 text-white animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                </div>
                {localDepartmentAdmins.length === 0 && <div className="text-gray-400">No Department Admins found.</div>}
                {localDepartmentAdmins.map((group) => (
                  <div key={group.departmentId} className="mb-8">
                    <div className="flex items-center gap-3 mb-2 pl-1">
                      <div className="text-base font-medium text-blue-400 uppercase tracking-wide">{group.departmentName}</div>
                      {/* Docbot Client Link Toggle */}
                      {company && (
                        <button
                          onClick={() => setExpandedDeptLinks(prev => ({ ...prev, [`admin-${group.departmentId}`]: !prev[`admin-${group.departmentId}`] }))}
                          className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                        >
                          <FiLink className="w-3 h-3" />
                          {expandedDeptLinks[`admin-${group.departmentId}`] ? 'Hide Docbot Client Link' : 'Show Docbot Client Link'}
                        </button>
                      )}
                    </div>

                    {/* Collapsible Docbot Client Link */}
                    {company && expandedDeptLinks[`admin-${group.departmentId}`] && (
                      <div className="mb-3 bg-white/5 border border-white/20 rounded p-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={`https://docbot.meaningfulinnovations.org/company/${company.id}/department/${group.departmentId}`}
                            className="flex-1 bg-white/10 text-white text-xs px-2 py-1 rounded border border-white/20 focus:outline-none"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`https://docbot.meaningfulinnovations.org/company/${company.id}/department/${group.departmentId}`);
                              alert('Link copied to clipboard!');
                            }}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}

                    {group.admins.length === 0 ? (
                      <div className="text-gray-400 text-sm mb-2 pl-1">No admins for this department.</div>
                    ) : (
                      <ul className="space-y-2">
                        {group.admins.map((admin) => (
                          <li
                            key={admin.id}
                            className="bg-white/10 hover:bg-white/20 transition-colors text-white px-4 py-3 rounded-lg flex flex-col sm:flex-row sm:items-center sm:gap-6 border border-white/10"
                          >
                            <span className="font-semibold text-base leading-tight">{admin.name}</span>
                            <span className="text-xs text-gray-300 sm:ml-2">{admin.email}</span>
                            <span className="text-xs text-gray-400 sm:ml-auto">ID: {admin.adminId}</span>
                            <button
                              onClick={() => handleDeleteAdmin(admin.id, group.departmentId)}
                              disabled={deletingAdmin === admin.id}
                              className="ml-4 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50"
                            >
                              {deletingAdmin === admin.id ? "Deleting..." : "Delete"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              {/* Create Department Admin Form */}
              <div className="w-full h-full max-w-md bg-white/5 rounded-xl shadow p-6 border border-white">
                <h3 className="text-xl font-semibold text-white mb-4">Create Department Admin</h3>
                <form onSubmit={handleCreateAdmin} className="flex flex-col gap-4">
                  <input
                    className="px-4 py-2 rounded bg-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    name="name"
                    placeholder="Name"
                    value={adminForm.name}
                    onChange={handleAdminFormChange}
                    required
                  />
                  <input
                    className="px-4 py-2 rounded bg-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    name="email"
                    type="email"
                    placeholder="Email"
                    value={adminForm.email}
                    onChange={handleAdminFormChange}
                    required
                  />
                  <input
                    className="px-4 py-2 rounded bg-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    name="adminId"
                    placeholder="Admin ID"
                    value={adminForm.adminId}
                    onChange={handleAdminFormChange}
                    required
                  />
                  <input
                    className="px-4 py-2 rounded bg-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    name="password"
                    type="password"
                    placeholder="Password"
                    value={adminForm.password}
                    onChange={handleAdminFormChange}
                    required
                  />
                  <select
                    name="departmentId"
                    value={adminForm.departmentId}
                    onChange={handleAdminFormChange}
                    className="px-4 py-2 rounded bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  >
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id} className="text-black">{dept.name}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded transition-colors text-sm"
                    disabled={adminLoading}
                  >
                    {adminLoading ? "Creating..." : "Create Department Admin"}
                  </button>
                  {adminStatus && <div className="text-white text-xs mt-2">{adminStatus}</div>}
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
} 