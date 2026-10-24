"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import {
  accountName,
  roleRef,
  USER_STATUSES,
  USER_TYPES,
  type AccountListItem,
} from "@/components/iam/access";
import { Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const PAGE_SIZE = 50;

export default function AccessUsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccessUsers />
    </Suspense>
  );
}

function AccessUsers() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [userType, setUserType] = useState("");
  const [roleId, setRoleId] = useState(() => params.get("roleId") ?? "");
  const [campusId, setCampusId] = useState("");
  const [status, setStatus] = useState("");

  const users = useInfiniteQuery({
    queryKey: ["iam.users", { search, userType, roleId, campusId, status }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.iam.users.list<AccountListItem[]>({
        limit: PAGE_SIZE,
        offset: pageParam,
        ...(search ? { q: search } : {}),
        ...(userType
          ? { userType: userType as (typeof USER_TYPES)[number] }
          : {}),
        ...(roleId ? { roleId } : {}),
        ...(campusId ? { campusId } : {}),
        ...(status ? { status: status as (typeof USER_STATUSES)[number] } : {}),
      }),
    getNextPageParam: (last, all) =>
      last.data.length === PAGE_SIZE ? all.length * PAGE_SIZE : undefined,
  });
  const rows = users.data?.pages.flatMap((p) => p.data);

  return (
    <>
      <PageHeader
        title="Users"
        description="Login accounts and their roles. Open an account to assign or revoke roles, see what it can do, or disable it."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Username, e-mail, phone"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label="Account type"
              className="select select-sm h-8 sm:w-40"
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
            >
              <option value="">All types</option>
              {USER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <div className="sm:w-56">
              <RefSelect
                source={roleRef}
                value={roleId}
                onChange={setRoleId}
                placeholder="All roles"
              />
            </div>
            <div className="sm:w-48">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                onChange={setCampusId}
                placeholder="All campuses"
              />
            </div>
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-40"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            rows={rows}
            isPending={users.isPending}
            error={users.error}
            empty="No accounts found."
            onRowClick={(r) => router.push(`/dashboard/access/users/${r.id}`)}
            columns={[
              {
                key: "username",
                label: "Account",
                render: (r) => (
                  <div>
                    <div className="font-medium">{accountName(r)}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.username && r.email, r.phone]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                ),
              },
              { key: "userType", label: "Type", type: "enum" },
              {
                key: "roles",
                label: "Roles",
                render: (r) =>
                  r.roles.length ? (
                    <div className="flex flex-wrap gap-1">
                      {r.roles.map((role, i) => (
                        <span
                          key={i}
                          className="badge badge-soft badge-sm whitespace-nowrap"
                        >
                          {role.code}
                          <span className="text-muted-foreground">
                            @{" "}
                            {role.campusId ? (
                              <RefLabel
                                source={refs.campuses}
                                id={role.campusId}
                              />
                            ) : (
                              "all campuses"
                            )}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No role</span>
                  ),
              },
              { key: "status", label: "Status", type: "status" },
              { key: "lastLoginAt", label: "Last sign-in", type: "datetime" },
            ]}
            actions={(r) => (
              <Button
                nativeButton={false}
                variant="ghost"
                size="icon-sm"
                aria-label="Open"
                render={<Link href={`/dashboard/access/users/${r.id}`} />}
              >
                <ChevronRightIcon />
              </Button>
            )}
          />

          {users.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={users.isFetchingNextPage}
                onClick={() => users.fetchNextPage()}
              >
                {users.isFetchingNextPage && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
