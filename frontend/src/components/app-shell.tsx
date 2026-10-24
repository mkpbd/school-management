"use client";

import { useQueryClient } from "@tanstack/react-query";
import { GraduationCapIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { CampusSwitcher } from "@/components/campus-switcher";
import { Loading } from "@/components/page";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { can, useMe } from "@/hooks/use-me";
import { api, onSessionExpired } from "@/lib/api";
import { NAV, type NavGroup, type NavItem } from "@/lib/nav";

/** Longest nav href that prefixes the path wins, so /students/new does not also light up /students. */
function activeHref(pathname: string, items: NavItem[]): string | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();

  useEffect(() => {
    onSessionExpired(() => {
      queryClient.clear();
      router.replace(
        `/login?next=${encodeURIComponent(window.location.pathname)}`,
      );
    });
    return () => onSessionExpired(null);
  }, [queryClient, router]);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) => !item.permission || can(me, item.permission),
    ),
  })).filter((g) => g.items.length > 0);

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <GraduationCapIcon className="size-4" />
                </div>
                <span className="font-semibold">School Management</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <Suspense fallback={<NavGroups groups={groups} />}>
            <ActiveNavGroups groups={groups} />
          </Suspense>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Sign out" onClick={logout}>
                <LogOutIcon />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <CampusSwitcher />
          {me && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {me.username ?? me.phone ?? me.email}
            </span>
          )}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={logout}
          >
            <LogOutIcon />
          </Button>
        </header>
        <div className="min-w-0 flex-1 p-4 md:p-6">
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Reads the URL (usePathname), so it renders inside a Suspense boundary. */
function ActiveNavGroups({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <NavGroups
      groups={groups}
      active={activeHref(
        pathname,
        groups.flatMap((g) => g.items),
      )}
    />
  );
}

function NavGroups({
  groups,
  active,
}: {
  groups: NavGroup[];
  active?: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.title}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={active === item.href}
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
