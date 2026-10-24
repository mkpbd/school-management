"use client";

import { useQuery } from "@tanstack/react-query";
import {
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import type { FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  friendly,
  NextRequestNotice,
  roleRef,
  type RoleDetail,
  type RoleListItem,
} from "@/components/iam/access";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";

const CREATE_FIELDS: FieldDef[] = [
  {
    name: "code",
    label: "Code",
    required: true,
    placeholder: "EXAM_CLERK",
    help: "3–40 capitals, digits or underscores; cannot be changed later",
  },
  { name: "nameEn", label: "Name (English)", required: true },
  { name: "nameBn", label: "Name (Bangla)" },
  {
    name: "copyFromRoleId",
    label: "Copy permissions from",
    type: "ref",
    ref: roleRef,
    placeholder: "Start empty",
    help: "Start from the permissions and scopes of an existing role",
  },
  {
    name: "requiresMfa",
    label: "Require MFA",
    type: "boolean",
    help: "Holders must sign in with a second factor",
  },
];

const EDIT_FIELDS: FieldDef[] = [
  { name: "nameEn", label: "Name (English)", required: true },
  { name: "nameBn", label: "Name (Bangla)", nullable: true },
  {
    name: "requiresMfa",
    label: "Require MFA",
    type: "boolean",
    help: "Holders without MFA are asked to enrol on their next request",
  },
];

export default function RolesPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleListItem | null>(null);

  const roles = useQuery({
    queryKey: ["iam.roles"],
    queryFn: async () => (await api.iam.roles.list<RoleListItem[]>()).data,
  });
  const rows =
    roles.data &&
    [...roles.data].sort(
      (a, b) =>
        Number(b.isSystem) - Number(a.isSystem) ||
        a.nameEn.localeCompare(b.nameEn),
    );

  const create = useAction(
    (body: Row) => friendly(api.iam.roles.create<RoleDetail>(body as never)),
    {
      invalidate: [["iam.roles"], ["iam.roleMatrix"]],
      toastError: false,
      onSuccess: (r) => router.push(`/dashboard/access/roles/${r.data.id}`),
    },
  );
  const update = useAction(
    ({ id, body }: { id: string; body: Row }) =>
      friendly(api.iam.roles.update(id, body as never)),
    {
      invalidate: [["iam.roles"], ["iam.role"], ["iam.roleMatrix"]],
      toastError: false,
    },
  );
  const remove = useAction((id: string) => friendly(api.iam.roles.remove(id)), {
    success: "Role deleted",
    invalidate: [["iam.roles"], ["iam.roleMatrix"]],
  });

  const canCreate = can(me, "iam.role.create");
  const canEdit = can(me, "iam.role.edit");
  const canDelete = can(me, "iam.role.delete");

  return (
    <>
      <PageHeader
        title="Roles"
        description="Built-in and custom roles. A role is a set of permissions, each with a data scope."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New role
            </Button>
          )
        }
      />
      <NextRequestNotice />
      <Card>
        <CardContent>
          <DataTable
            rows={rows}
            isPending={roles.isPending}
            error={roles.error}
            empty="No roles."
            onRowClick={(r) => router.push(`/dashboard/access/roles/${r.id}`)}
            columns={[
              {
                key: "nameEn",
                label: "Role",
                render: (r) => (
                  <div>
                    <div className="font-medium">{r.nameEn}</div>
                    {r.nameBn && (
                      <div className="text-xs text-muted-foreground">
                        {r.nameBn}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "code", label: "Code", type: "mono" },
              {
                key: "isSystem",
                label: "Kind",
                render: (r) =>
                  r.isSystem ? (
                    <Badge variant="secondary">Built-in</Badge>
                  ) : (
                    <Badge variant="outline">Custom</Badge>
                  ),
              },
              { key: "requiresMfa", label: "MFA", type: "bool" },
              {
                key: "permissionCount",
                label: "Permissions",
                className: "text-right",
                render: (r) => (
                  <span className="tabular-nums">{r.permissionCount}</span>
                ),
              },
              {
                key: "userCount",
                label: "Users",
                className: "text-right",
                render: (r) =>
                  r.userCount ? (
                    <Link
                      className="link tabular-nums"
                      href={`/dashboard/access/users?roleId=${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.userCount}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground tabular-nums">
                      0
                    </span>
                  ),
              },
            ]}
            actions={(r) => (
              <>
                <Button
                  nativeButton={false}
                  variant="outline"
                  size="xs"
                  render={<Link href={`/dashboard/access/roles/${r.id}`} />}
                >
                  <KeyRoundIcon /> Permissions
                </Button>
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Users with this role"
                  title="Users with this role"
                  render={
                    <Link href={`/dashboard/access/users?roleId=${r.id}`} />
                  }
                >
                  <UsersIcon />
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit"
                    onClick={() => setEditing(r)}
                  >
                    <PencilIcon />
                  </Button>
                )}
                {canDelete && !r.isSystem && (
                  <ConfirmButton
                    variant="ghost"
                    size="icon-sm"
                    destructive
                    title={`Delete ${r.nameEn}?`}
                    description={
                      r.userCount
                        ? `${r.userCount} user(s) still hold this role; revoke it from them first.`
                        : "The role and its permissions are removed. This cannot be undone."
                    }
                    confirmLabel="Delete"
                    onConfirm={() => remove.mutateAsync(r.id)}
                  >
                    <Trash2Icon />
                  </ConfirmButton>
                )}
              </>
            )}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New role"
        description="A custom role starts empty or as a copy of another role; set its permissions next."
        fields={CREATE_FIELDS}
        submitLabel="Create role"
        successMessage="Role created"
        onSubmit={(body) =>
          create.mutateAsync({ ...body, code: String(body.code).toUpperCase() })
        }
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`Edit ${editing?.nameEn ?? "role"}`}
        description={
          editing?.isSystem
            ? "Built-in role: the code is fixed, the name and MFA can change."
            : undefined
        }
        fields={EDIT_FIELDS}
        row={editing ?? undefined}
        onSubmit={(body) => update.mutateAsync({ id: editing!.id, body })}
      />
    </>
  );
}
