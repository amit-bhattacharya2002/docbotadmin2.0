import { getServerSession } from "next-auth";
import { authOptions } from "../api/auth/authOptions";
import { redirect } from "next/navigation";

export default async function DashboardEntry() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "SUPERADMIN") {
    redirect("/dashboard/superadmin");
  } else if (session.user.role === "DEPARTMENTADMIN") {
    redirect("/dashboard/admin");
  } else {
    redirect("/login");
  }

  return null;
} 