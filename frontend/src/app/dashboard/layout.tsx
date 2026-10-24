import { AppShell } from "@/components/app-shell";

export default function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  return <AppShell>{children}</AppShell>;
}
