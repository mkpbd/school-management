"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can, useMe } from "@/hooks/use-me";
import { api, type StudentListItem, type StudentStatus } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const STATUSES: StudentStatus[] = [
  "active",
  "on_hold",
  "withdrawn",
  "graduated",
  "alumni",
];
const PAGE_SIZE = 25;

export default function StudentsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StudentStatus | "">("active");
  const [classSectionId, setClassSectionId] = useState("");
  const search = useDeferredValue(q.trim());

  const students = useInfiniteQuery({
    queryKey: ["sis", "students", { q: search, status, classSectionId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.sis.students.search({
        limit: PAGE_SIZE,
        ...(search ? { q: search } : {}),
        ...(status ? { status } : {}),
        ...(classSectionId ? { classSectionId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = students.data?.pages.flatMap((p) => p.data);

  return (
    <>
      <PageHeader
        title="Students"
        description="Search by name or admission number. Results follow your data scope."
        actions={
          can(me, "sis.student.create") && (
            <Link href="/dashboard/students/new" className={buttonVariants()}>
              <UserPlusIcon /> Register student
            </Link>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Name or admission no"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="select select-sm h-8 sm:w-40"
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StudentStatus | "")}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <div className="sm:w-56">
              <RefSelect
                source={refs.sections}
                value={classSectionId}
                placeholder="All sections"
                onChange={setClassSectionId}
              />
            </div>
          </div>

          <DataTable<StudentListItem>
            rows={rows}
            isPending={students.isPending}
            error={students.error}
            empty="No students found."
            onRowClick={(s) => router.push(`/dashboard/students/${s.id}`)}
            columns={[
              { key: "admissionNo", label: "Admission no", type: "mono" },
              {
                key: "fullNameEn",
                label: "Name",
                render: (s) => (
                  <div>
                    <div className="font-medium">{s.fullNameEn}</div>
                    {s.fullNameBn && (
                      <div className="text-xs text-muted-foreground">
                        {s.fullNameBn}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "gender", label: "Gender", type: "enum" },
              { key: "classSectionId", label: "Section", ref: refs.sections },
              { key: "rollNo", label: "Roll" },
              { key: "status", label: "Status", type: "status" },
            ]}
          />

          {students.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={students.isFetchingNextPage}
                onClick={() => students.fetchNextPage()}
              >
                {students.isFetchingNextPage && (
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
