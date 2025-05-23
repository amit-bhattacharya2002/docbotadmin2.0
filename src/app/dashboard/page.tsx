import { getServerSession } from "next-auth";
import { authOptions } from "../api/auth/authOptions";
import { redirect } from "next/navigation";

export default async function DashboardEntry() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  let redirecting = false;
  if (session.user.role === "SUPERADMIN") {
    redirecting = true;
    redirect("/dashboard/superadmin");
  } else if (session.user.role === "DEPARTMENTADMIN") {
    redirecting = true;
    redirect("/dashboard/admin");
  } else {
    redirecting = true;
    redirect("/login");
  }

  // Show loading prompt while redirecting
  return (
    <div className="min-h-[90vh] flex items-center justify-center bg-black">
      <div className="text-white text-xl font-semibold animate-pulse">
        Loading dashboard...
      </div>
    </div>
  );
} 