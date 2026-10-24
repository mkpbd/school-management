"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { BorrowerAccountView } from "@/components/lib/borrower-account";
import { OffsetPager, borrowerHref } from "@/components/lib/shared";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BorrowerType, LoanRow } from "@/lib/api/services/lib";
import { formatDate } from "@/lib/format";
import { refs } from "@/lib/refs";

const LIMIT = 50;

export default function LoansPage() {
  const { data: me } = useMe();
  // 404 NOT_A_MEMBER for logins without a staff / student record: the tab is simply not shown.
  const mine = useQuery({
    queryKey: ["lib.me"],
    queryFn: () => api.lib.me(),
    retry: false,
  });
  const showAll = can(me, "lib.circulation.view");

  if (!mine.isSuccess) {
    return (
      <>
        <PageHeader
          title="Loans"
          description="Active, overdue and returned loans."
        />
        {showAll ? <AllLoans /> : null}
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Loans"
        description="Active, overdue and returned loans."
      />
      <Tabs defaultValue={showAll ? "all" : "mine"}>
        <TabsList>
          {showAll && <TabsTrigger value="all">All loans</TabsTrigger>}
          <TabsTrigger value="mine">My library</TabsTrigger>
        </TabsList>
        {showAll && (
          <TabsContent value="all">
            <AllLoans />
          </TabsContent>
        )}
        <TabsContent value="mine">
          <BorrowerAccountView account={mine.data.data} queryKey={["lib.me"]} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function AllLoans() {
  const [status, setStatus] = useState<"" | "active" | "overdue" | "returned">(
    "active",
  );
  const [borrowerType, setBorrowerType] = useState<"" | BorrowerType>("");
  const [campusId, setCampusId] = useState("");
  const [offset, setOffset] = useState(0);

  const query = {
    limit: LIMIT,
    offset,
    ...(status ? { status } : {}),
    ...(borrowerType ? { borrowerType } : {}),
    ...(campusId ? { campusId } : {}),
  };
  const loans = useQuery({
    queryKey: ["lib.loans", query],
    queryFn: () => api.lib.circulation.loans(query),
  });
  const renew = useAction((id: string) => api.lib.circulation.renew(id), {
    success: (r) => `Renewed — now due ${formatDate(r.data.dueOn)}`,
    invalidate: [["lib.loans"]],
  });
  const rows = loans.data?.data ?? [];
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <select
            aria-label="Status"
            className="select select-sm h-8 sm:w-40"
            value={status}
            onChange={(e) => reset(setStatus)(e.target.value as typeof status)}
          >
            <option value="">All loans</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
            <option value="returned">Returned</option>
          </select>
          <select
            aria-label="Borrower type"
            className="select select-sm h-8 sm:w-40"
            value={borrowerType}
            onChange={(e) =>
              reset(setBorrowerType)(e.target.value as typeof borrowerType)
            }
          >
            <option value="">All readers</option>
            <option value="student">Students</option>
            <option value="staff">Staff</option>
          </select>
          <div className="sm:w-56">
            <RefSelect
              source={refs.campuses}
              value={campusId}
              placeholder="All campuses"
              onChange={reset(setCampusId)}
            />
          </div>
        </div>
        <DataTable<LoanRow>
          rows={rows}
          isPending={loans.isPending}
          error={loans.error}
          empty="No loans."
          columns={[
            {
              key: "title",
              label: "Title",
              render: (l) => (
                <Link
                  className="link link-hover"
                  href={`/dashboard/library/titles/${l.bookTitleId}`}
                >
                  {l.title}
                </Link>
              ),
            },
            { key: "accessionNo", label: "Accession", type: "mono" },
            {
              key: "borrowerName",
              label: "Reader",
              render: (l) => (
                <Link
                  className="link link-hover"
                  href={borrowerHref(l.borrowerType, l.borrowerId)}
                >
                  {l.borrowerName || l.borrowerId.slice(0, 8)}
                </Link>
              ),
            },
            { key: "borrowerType", label: "Type", type: "enum" },
            { key: "issuedAt", label: "Issued", type: "datetime" },
            { key: "dueOn", label: "Due", type: "date" },
            {
              key: "overdueDays",
              label: "Late",
              render: (l) =>
                l.overdueDays ? (
                  <span className="badge badge-error badge-soft badge-sm">
                    {l.overdueDays} days
                  </span>
                ) : (
                  "—"
                ),
            },
            { key: "renewCount", label: "Renewed" },
            { key: "returnedAt", label: "Returned", type: "datetime" },
            { key: "finePaisa", label: "Fine", type: "money" },
          ]}
          actions={(l) =>
            l.returnedAt ? null : (
              <Button
                variant="ghost"
                size="xs"
                disabled={renew.isPending}
                onClick={() => renew.mutate(l.id)}
              >
                <RotateCwIcon /> Renew
              </Button>
            )
          }
        />
        <OffsetPager
          offset={offset}
          limit={LIMIT}
          count={rows.length}
          onChange={setOffset}
        />
      </CardContent>
    </Card>
  );
}
