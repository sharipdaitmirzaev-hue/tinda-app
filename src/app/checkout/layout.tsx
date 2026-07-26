import { require_client_area } from "@/lib/auth/require-auth";

export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await require_client_area();
  return children;
}
