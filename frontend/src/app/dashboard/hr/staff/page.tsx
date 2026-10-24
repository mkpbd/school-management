"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { KeyRoundIcon, PencilIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import type { FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const STAFF_TYPES = ["teaching", "non_teaching", "admin", "support"] as const;
const STATUSES = [
  "onboarding",
  "probation",
  "active",
  "on_leave",
  "resigned",
  "terminated",
  "retired",
] as const;
const ROLES = [
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "CAMPUS_HEAD",
  "HEAD_OF_SECTION",
  "CLASS_TEACHER",
  "SUBJECT_TEACHER",
  "EXAM_OFFICER",
  "ACCOUNTANT",
  "CASHIER",
  "LIBRARIAN",
  "TRANSPORT",
  "DRIVER",
  "STORE_KEEPER",
  "NURSE",
  "COUNSELLOR",
  "FRONT_DESK",
  "IT_ADMIN",
] as const;
const PAGE_SIZE = 50;

const STAFF_FIELDS: FieldDef[] = [
  {
    name: "campusId",
    label: "Campus",
    type: "ref",
    ref: refs.campuses,
    mode: "create",
    help: "Default: active campus",
  },
  { name: "staffNo", label: "Staff no", required: true, mode: "create" },
  { name: "fullNameEn", label: "Full name (English)", required: true },
  { name: "fullNameBn", label: "Full name (Bangla)" },
  {
    name: "gender",
    label: "Gender",
    type: "select",
    options: ["male", "female"],
    required: true,
  },
  { name: "dateOfBirth", label: "Date of birth", type: "date" },
  { name: "phone", label: "Phone", type: "phone", required: true },
  { name: "email", label: "Email", type: "email" },
  {
    name: "nid",
    label: "NID",
    help: "10–17 digits; stored encrypted (leave empty to keep)",
  },
  {
    name: "staffType",
    label: "Staff type",
    type: "select",
    options: STAFF_TYPES,
    required: true,
  },
  {
    name: "departmentId",
    label: "Department",
    type: "ref",
    ref: refs.departments,
  },
  {
    name: "designationId",
    label: "Designation",
    type: "ref",
    ref: refs.designations,
  },
  { name: "reportingToId", label: "Reports to", type: "ref", ref: refs.staff },
  { name: "joinedOn", label: "Joined on", type: "date", required: true },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: ["onboarding", "probation", "active"],
    mode: "create",
  },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: STATUSES,
    mode: "edit",
  },
  {
    name: "leftOn",
    label: "Left on",
    type: "date",
    mode: "edit",
    nullable: true,
  },
];

const ACCOUNT_FIELDS: FieldDef[] = [
  {
    name: "username",
    label: "Username",
    required: true,
    help: "3–50 chars: a-z 0-9 . _ -",
  },
  {
    name: "password",
    label: "Initial password",
    type: "password",
    required: true,
    help: "At least 10 characters",
  },
  {
    name: "roleCode",
    label: "Role",
    type: "select",
    options: ROLES,
    required: true,
  },
  {
    name: "campusId",
    label: "Campus",
    type: "ref",
    ref: refs.campuses,
    help: "Empty: organisation-wide role",
  },
];

export default function StaffPage() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [staffType, setStaffType] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [account, setAccount] = useState<Row | null>(null);

  const staff = useInfiniteQuery({
    queryKey: ["hrm.staff", "search", { search, staffType, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.hrm.staff.search({
        limit: PAGE_SIZE,
        ...(search
          ? /^\d{10,17}$/.test(search)
            ? { nid: search }
            : { q: search }
          : {}),
        ...(staffType
          ? { staffType: staffType as (typeof STAFF_TYPES)[number] }
          : {}),
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = staff.data?.pages.flatMap((p) => p.data);

  const save = useAction(
    ({ body, row }: { body: Row; row: Row | null }) =>
      row
        ? api.hrm.staff.update(String(row.id), body as never, {
            rowVersion: Number(row.rowVersion),
          })
        : api.hrm.staff.create(body as never),
    { invalidate: [["hrm.staff"]], toastError: false },
  );
  const createAccount = useAction(
    ({ id, body }: { id: string; body: Row }) =>
      api.hrm.staff.createAccount(id, body as never),
    { invalidate: [["hrm.staff"]], toastError: false },
  );

  const canEdit = can(me, "hrm.staff.edit");
  const canAccount = can(me, "iam.user.create");

  return (
    <>
      <PageHeader
        title="Staff"
        description="Search by name, staff no or phone; type a full NID for an exact match."
        actions={
          can(me, "hrm.staff.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New staff member
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Name, staff no, phone, NID"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label="Staff type"
              className="select select-sm h-8 sm:w-44"
              value={staffType}
              onChange={(e) => setStaffType(e.target.value)}
            >
              <option value="">All types</option>
              {STAFF_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            rows={rows}
            isPending={staff.isPending}
            error={staff.error}
            empty="No staff found."
            columns={[
              { key: "staffNo", label: "Staff no", type: "mono" },
              {
                key: "fullNameEn",
                label: "Name",
                render: (r) => (
                  <div>
                    <div className="font-medium">{String(r.fullNameEn)}</div>
                    {Boolean(r.fullNameBn) && (
                      <div className="text-xs text-muted-foreground">
                        {String(r.fullNameBn)}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "staffType", label: "Type", type: "enum" },
              {
                key: "designationId",
                label: "Designation",
                ref: refs.designations,
              },
              {
                key: "departmentId",
                label: "Department",
                ref: refs.departments,
              },
              { key: "phone", label: "Phone" },
              { key: "status", label: "Status", type: "status" },
              {
                key: "userId",
                label: "Login",
                render: (r) =>
                  r.userId ? (
                    <span className="badge badge-soft badge-success badge-sm">
                      Yes
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
            ]}
            actions={
              canEdit || canAccount
                ? (row) => (
                    <>
                      {canAccount && !row.userId && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setAccount(row)}
                        >
                          <KeyRoundIcon /> Create login
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit"
                          onClick={() => setEditing(row)}
                        >
                          <PencilIcon />
                        </Button>
                      )}
                    </>
                  )
                : undefined
            }
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

      <FormDialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        title={
          editing ? `Edit ${String(editing.fullNameEn)}` : "New staff member"
        }
        fields={STAFF_FIELDS}
        row={editing ?? undefined}
        onSubmit={(body) => save.mutateAsync({ body, row: editing })}
      />
      <FormDialog
        open={account !== null}
        onOpenChange={(open) => !open && setAccount(null)}
        title={`Create login for ${String(account?.fullNameEn ?? "")}`}
        description="The staff member signs in with this username and password, with the chosen role."
        fields={ACCOUNT_FIELDS}
        submitLabel="Create login"
        successMessage="Login created"
        onSubmit={(body) =>
          createAccount.mutateAsync({
            id: String(account!.id),
            body: { ...body, campusId: body.campusId ?? null },
          })
        }
      />
    </>
  );
}
