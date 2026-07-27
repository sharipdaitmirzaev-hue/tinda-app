import { require_staff } from "@/lib/auth/require-auth";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await require_staff();
  return children;
}
