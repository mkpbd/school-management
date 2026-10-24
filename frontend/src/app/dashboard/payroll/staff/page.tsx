"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type Row } from "@/lib/api";

const PAGE_SIZE = 50;

export default function PayrollStaffPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());

  const staff = useInfiniteQuery({
    queryKey: ["hrm.staff", "payroll-pick", search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.hrm.staff.search({
        limit: PAGE_SIZE,
        ...(search ? { q: search } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows: Row[] = staff.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Staff pay"
        description="Pick a staff member to manage contracts, salary revisions, bank account, loans and tax profile."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="relative sm:w-72">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Name, staff no or phone"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <DataTable
            rows={rows}
            isPending={staff.isPending}
            error={staff.error}
            empty="No staff found."
            onRowClick={(r) =>
              router.push(`/dashboard/payroll/staff/${String(r.id)}`)
            }
            columns={[
              { key: "staffNo", label: "Staff no", type: "mono" },
              { key: "fullNameEn", label: "Name" },
              { key: "staffType", label: "Type", type: "enum" },
              { key: "joinedOn", label: "Joined", type: "date" },
              { key: "status", label: "Status", type: "status" },
            ]}
          />
          {staff.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={staff.isFetchingNextPage}
                onClick={() => staff.fetchNextPage()}
              >
                {staff.isFetchingNextPage && (
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
