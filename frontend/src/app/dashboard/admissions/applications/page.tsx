"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import {
  APPLICATION_STATUSES,
  ApplicationStatusBadge,
  childNameOf,
  SourceCell,
  SpamBadge,
} from "@/components/adm/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ApplicationRow } from "@/lib/api/services/adm-office";
import { formatDate, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const PAGE_SIZE = 50;

export default function ApplicationsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [tab, setTab] = useState<"all" | "spam">("all");
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [status, setStatus] = useState("");
  const [yearGroupId, setYearGroupId] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");

  const filter = {
    ...(tab === "spam" ? { spam: "true" as const } : {}),
    ...(search ? { q: search } : {}),
    ...(status ? { status } : {}),
    ...(yearGroupId ? { yearGroupId } : {}),
    ...(academicYearId ? { academicYearId } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ["adm.applications", filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.adm.applications.list({
        ...filter,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (last, all) =>
      last.data.length === PAGE_SIZE ? all.length * PAGE_SIZE : undefined,
    enabled: Boolean(me),
  });
  const rows = list.data?.pages.flatMap((p) => p.data);

  return (
    <>
      <PageHeader
        title="Applications"
        description="Online and office applications. Open one to review: under review, shortlist, waitlist, reject or withdrawn."
      />
      <Card>
        <CardContent className="space-y-4">
          <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "all" ? "tab-active" : ""}`}
              onClick={() => setTab("all")}
            >
              Applications
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "spam" ? "tab-active" : ""}`}
              onClick={() => setTab("spam")}
            >
              Spam
            </button>
          </div>
          <div className="flex flex-col flex-wrap gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Name, phone, application no"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <div className="sm:w-40">
              <RefSelect
                source={refs.yearGroups}
                value={yearGroupId}
                onChange={setYearGroupId}
                placeholder="All classes"
              />
            </div>
            <div className="sm:w-44">
              <RefSelect
                source={refs.academicYears}
                value={academicYearId}
                onChange={setAcademicYearId}
                placeholder="All years"
              />
            </div>
          </div>

          <DataTable<ApplicationRow>
            rows={rows}
            isPending={list.isPending}
            error={list.error}
            onRowClick={(a) =>
              router.push(`/dashboard/admissions/applications/${a.id}`)
            }
            empty={
              tab === "spam"
                ? "No applications flagged as spam."
                : "No applications match."
            }
            columns={[
              {
                key: "applicationNo",
                label: "Application no",
                render: (a) => (
                  <span className="font-mono text-xs">
                    {a.applicationNo ?? "—"}
                  </span>
                ),
              },
              {
                key: "child",
                label: "Child",
                render: (a) => (
                  <div>
                    <div className="font-medium">{childNameOf(a)}</div>
                    <div className="text-xs text-muted-foreground">
                      {humanize(a.childGender)} · {formatDate(a.childDob)}
                    </div>
                  </div>
                ),
              },
              {
                key: "guardianName",
                label: "Guardian",
                render: (a) => (
                  <div>
                    <div>{a.guardianName ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {a.guardianPhone}
                    </div>
                  </div>
                ),
              },
              { key: "yearGroupId", label: "Class", ref: refs.yearGroups },
              {
                key: "sourceCode",
                label: "Source",
                render: (a) => <SourceCell source={a.sourceCode} />,
              },
              {
                key: "status",
                label: "Status",
                render: (a) => (
                  <span className="flex items-center gap-1">
                    <ApplicationStatusBadge status={a.status} />
                    {a.isSpam && <SpamBadge score={a.spamScore} />}
                  </span>
                ),
              },
              { key: "submittedAt", label: "Submitted", type: "datetime" },
            ]}
          />

          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {list.isFetchingNextPage && (
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
