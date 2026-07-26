import { require_pending_client } from "@/lib/auth/require-auth";

export default async function PendingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await require_pending_client();
  return children;
}
