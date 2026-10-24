"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  PlusIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  accountName,
  friendly,
  NextRequestNotice,
  roleRef,
  ScopeBadge,
  usePermissionCatalogue,
  userTypeForRole,
  type AccessCheck,
  type Grant,
  type UserAccess,
} from "@/components/iam/access";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Me } from "@/lib/api";
import { formatDate, formatDateTime, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function AccessUserPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const access = useQuery({
    queryKey: ["iam.user", id],
    queryFn: async () => (await api.iam.users.access<UserAccess>(id)).data,
  });
  const a = access.data;
  const self = me?.id === id;
  const canEdit = can(me, "iam.user.edit") && !self;

  const setStatus = useAction(
    (status: "active" | "disabled") =>
      friendly(api.iam.users.setStatus(id, { status })),
    {
      success: (r) =>
        r.data.status === "disabled" ? "Account disabled" : "Account enabled",
      invalidate: [["iam.user", id], ["iam.users"]],
    },
  );

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/access/users" />}
      >
        <ArrowLeftIcon /> Users
      </Button>
      {access.isError ? (
        <ErrorAlert error={access.error} />
      ) : access.isPending || !a ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={accountName(a.user)}
            description={
              <>
                {humanize(a.user.userType)} account · last sign-in{" "}
                {formatDateTime(a.user.lastLoginAt)}{" "}
                <StatusBadge status={a.user.status} />
              </>
            }
            actions={
              canEdit &&
              (a.user.status === "disabled" || a.user.status === "locked" ? (
                <ConfirmButton
                  variant="default"
                  size="default"
                  title={
                    a.user.status === "locked"
                      ? "Unlock this account?"
                      : "Re-enable this account?"
                  }
                  description="The account can sign in again and gets the permissions of its roles."
                  confirmLabel={
                    a.user.status === "locked" ? "Unlock" : "Re-enable"
                  }
                  onConfirm={() => setStatus.mutateAsync("active")}
                >
                  <CheckCircle2Icon />{" "}
                  {a.user.status === "locked"
                    ? "Unlock account"
                    : "Re-enable account"}
                </ConfirmButton>
              ) : (
                <ConfirmButton
                  size="default"
                  destructive
                  title="Disable this account?"
                  description="It is refused on its next request and cannot sign in until re-enabled. Roles are kept."
                  confirmLabel="Disable"
                  onConfirm={() => setStatus.mutateAsync("disabled")}
                >
                  <BanIcon /> Disable account
                </ConfirmButton>
              ))
            }
          />
          {self ? (
            <NextRequestNotice>
              This is your own account: you cannot change your own roles or
              disable yourself. Ask another administrator.
            </NextRequestNotice>
          ) : (
            <NextRequestNotice>
              Role and status changes apply to this account on its next request:
              its cached permissions are cleared, no sign-out needed.
            </NextRequestNotice>
          )}
          <Card className="mb-4">
            <CardContent>
              <DetailList
                items={[
                  ["Username", a.user.username],
                  ["E-mail", a.user.email],
                  ["Phone", a.user.phone],
                  ["Type", humanize(a.user.userType)],
                  ["Status", <StatusBadge key="s" status={a.user.status} />],
                  ["Last sign-in", formatDateTime(a.user.lastLoginAt)],
                ]}
              />
            </CardContent>
          </Card>
          <Tabs defaultValue="roles">
            <TabsList>
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="permissions">
                Effective permissions
              </TabsTrigger>
              <TabsTrigger value="check">Check access</TabsTrigger>
            </TabsList>
            <TabsContent value="roles">
              <RolesTab access={a} me={me} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="permissions">
              <PermissionsTab access={a} />
            </TabsContent>
            <TabsContent value="check">
              <CheckTab userId={id} status={a.user.status} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function RolesTab({
  access,
  me,
  canEdit,
}: {
  access: UserAccess;
  me: Me | undefined;
  canEdit: boolean;
}) {
  const userId = access.user.id;
  const [assigning, setAssigning] = useState(false);
  const orgWide = me?.campusIds === "*";
  const today = todayISO();

  const fields: FieldDef[] = useMemo(
    () => [
      {
        name: "roleId",
        label: "Role",
        type: "ref",
        ref: roleRef,
        required: true,
        refFilter: (r) =>
          userTypeForRole(String(r.code)) === access.user.userType,
        help: `Only roles for ${humanize(access.user.userType).toLowerCase()} accounts`,
      },
      {
        name: "campusId",
        label: "Campus",
        type: "ref",
        ref: refs.campuses,
        required: !orgWide,
        placeholder: orgWide ? "Organisation-wide (all campuses)" : "Select…",
        help: orgWide
          ? "Empty: organisation-wide role"
          : "Only organisation-wide administrators assign organisation-wide roles",
      },
      {
        name: "validFrom",
        label: "Valid from",
        type: "date",
        help: "Default: today",
      },
      {
        name: "validTo",
        label: "Valid to",
        type: "date",
        help: "Empty: no end date",
      },
    ],
    [access.user.userType, orgWide],
  );

  const assign = useAction(
    (body: {
      roleId: string;
      campusId: string | null;
      validFrom?: string;
      validTo?: string;
    }) => friendly(api.iam.users.assignRole(userId, body)),
    {
      invalidate: [["iam.user", userId], ["iam.users"], ["iam.roles"]],
      toastError: false,
    },
  );
  const revoke = useAction(
    (assignmentId: string) =>
      friendly(api.iam.roleAssignments.revoke(assignmentId)),
    {
      success: "Role revoked",
      invalidate: [["iam.user", userId], ["iam.users"], ["iam.roles"]],
    },
  );

  const rows = [...access.assignments].sort(
    (x, y) =>
      Number(y.active) - Number(x.active) ||
      x.roleName.localeCompare(y.roleName),
  );

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Role assignments</CardTitle>
          <CardDescription>
            A role applies organisation-wide or on one campus, from its start
            date until its end date.
          </CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setAssigning(true)}>
            <PlusIcon /> Assign role
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataTable
          rows={rows}
          empty="No roles: this account can sign in but do nothing."
          columns={[
            {
              key: "roleName",
              label: "Role",
              render: (r) => (
                <div>
                  <div className="font-medium">{r.roleName}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {r.roleCode}
                  </div>
                </div>
              ),
            },
            {
              key: "campusId",
              label: "Where",
              render: (r) =>
                r.campusId ? (
                  <RefLabel source={refs.campuses} id={r.campusId} />
                ) : (
                  <span className="badge badge-soft badge-primary badge-sm">
                    Organisation-wide
                  </span>
                ),
            },
            {
              key: "validFrom",
              label: "Valid",
              render: (r) => (
                <span className="whitespace-nowrap">
                  {formatDate(r.validFrom)} –{" "}
                  {r.validTo ? formatDate(r.validTo) : "no end"}
                </span>
              ),
            },
            {
              key: "active",
              label: "State",
              render: (r) =>
                r.active ? (
                  <StatusBadge status="active" />
                ) : r.validFrom > today ? (
                  <StatusBadge status="planned" />
                ) : (
                  <StatusBadge status="expired" />
                ),
            },
          ]}
          actions={
            canEdit
              ? (r) =>
                  (r.campusId || orgWide) && (
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      destructive
                      title={`Revoke ${r.roleName}?`}
                      description="The account loses the permissions of this role on its next request."
                      confirmLabel="Revoke"
                      onConfirm={() => revoke.mutateAsync(r.id)}
                    >
                      <Trash2Icon />
                    </ConfirmButton>
                  )
              : undefined
          }
        />
      </CardContent>
      <FormDialog
        open={assigning}
        onOpenChange={setAssigning}
        title={`Assign a role to ${accountName(access.user)}`}
        description="Takes effect on the account's next request."
        fields={fields}
        submitLabel="Assign"
        successMessage="Role assigned"
        onSubmit={(body) =>
          assign.mutateAsync({
            roleId: String(body.roleId),
            campusId: body.campusId ? String(body.campusId) : null,
            ...(body.validFrom ? { validFrom: String(body.validFrom) } : {}),
            ...(body.validTo ? { validTo: String(body.validTo) } : {}),
          })
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function GrantList({ grants }: { grants: Grant[] }) {
  return (
    <div className="flex flex-col gap-1">
      {grants.map((g, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
          <ScopeBadge scope={g.scope} long />
          <span className="text-muted-foreground">
            on{" "}
            {g.campusId ? (
              <RefLabel source={refs.campuses} id={g.campusId} />
            ) : (
              "all campuses"
            )}{" "}
            via
          </span>
          <span className="font-mono">{g.viaRole}</span>
        </div>
      ))}
    </div>
  );
}

function PermissionsTab({ access }: { access: UserAccess }) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const byModule = useMemo(() => {
    const out = new Map<string, Array<{ code: string; grants: Grant[] }>>();
    for (const [code, grants] of Object.entries(access.permissions).sort(
      ([x], [y]) => x.localeCompare(y),
    )) {
      if (
        f &&
        !code.includes(f) &&
        !grants.some((g) => g.viaRole.toLowerCase().includes(f))
      )
        continue;
      const mod = code.split(".")[0];
      (out.get(mod) ?? out.set(mod, []).get(mod)!).push({ code, grants });
    }
    return [...out.entries()];
  }, [access.permissions, f]);
  const total = Object.keys(access.permissions).length;

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Effective permissions</CardTitle>
          <CardDescription>
            {total} permission{total === 1 ? "" : "s"} from the active role
            assignments, with the data scope and the role that grants each one.
            {access.user.status !== "active" &&
              " The account is not active, so none of them work right now."}
          </CardDescription>
        </div>
        <Input
          className="sm:w-56"
          placeholder="Filter (code or role)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </CardHeader>
      <CardContent className="space-y-6">
        {byModule.length === 0 ? (
          <Empty>
            {total
              ? "Nothing matches the filter."
              : "No effective permissions."}
          </Empty>
        ) : (
          byModule.map(([mod, perms]) => (
            <div key={mod}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {mod} <span className="font-normal">({perms.length})</span>
              </h3>
              <div className="divide-y rounded-lg border">
                {perms.map((p) => (
                  <div
                    key={p.code}
                    className="grid gap-2 p-2 sm:grid-cols-[minmax(0,16rem)_1fr]"
                  >
                    <div>
                      <div className="text-sm">
                        {humanize(p.code.split(".")[1])} ·{" "}
                        {p.code.split(".")[2]}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </div>
                    </div>
                    <GrantList grants={p.grants} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function CheckTab({ userId, status }: { userId: string; status: string }) {
  const catalogue = usePermissionCatalogue();
  const [permission, setPermission] = useState("");
  const [campusId, setCampusId] = useState("");
  const [asked, setAsked] = useState<{
    permission: string;
    campusId: string;
  } | null>(null);

  const check = useQuery({
    queryKey: ["iam.check", userId, asked],
    enabled: asked !== null,
    queryFn: async () =>
      (
        await api.iam.users.check<AccessCheck>(userId, {
          permission: asked!.permission,
          ...(asked!.campusId ? { campusId: asked!.campusId } : {}),
        })
      ).data,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (permission) setAsked({ permission, campusId });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Can this user…?</CardTitle>
        <CardDescription>
          Pick a permission and optionally a campus; the answer lists the roles
          that grant it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={submit}
          className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="check-permission">Permission</Label>
            <select
              id="check-permission"
              className="select select-sm h-8 w-full"
              required
              disabled={catalogue.isPending}
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
            >
              <option value="">
                {catalogue.isPending ? "Loading…" : "Select…"}
              </option>
              {(catalogue.data ?? []).map((g) => (
                <optgroup key={g.module} label={g.module}>
                  {g.resources.flatMap((r) =>
                    r.actions.map((a) => (
                      <option key={a.code} value={a.code}>
                        {humanize(r.resource)} · {a.action} ({a.code})
                      </option>
                    )),
                  )}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Campus</Label>
            <RefSelect
              source={refs.campuses}
              value={campusId}
              onChange={setCampusId}
              placeholder="Any campus"
            />
          </div>
          <Button type="submit" disabled={!permission || check.isFetching}>
            {check.isFetching ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <SearchCheckIcon />
            )}
            Check
          </Button>
        </form>
        {catalogue.isError && <ErrorAlert error={catalogue.error} />}
        {check.isError && <ErrorAlert error={check.error} />}
        {asked && check.data && (
          <div
            role="status"
            className={`alert alert-soft flex-col items-start gap-2 text-sm ${check.data.allowed ? "alert-success" : "alert-error"}`}
          >
            <div className="flex items-center gap-2 font-medium">
              {check.data.allowed ? (
                <ShieldCheckIcon className="size-4" />
              ) : (
                <XCircleIcon className="size-4" />
              )}
              {check.data.allowed ? "Allowed" : "Not allowed"}:{" "}
              <span className="font-mono">{asked.permission}</span>
              {asked.campusId ? (
                <>
                  on <RefLabel source={refs.campuses} id={asked.campusId} />
                </>
              ) : (
                " (any campus)"
              )}
            </div>
            {check.data.via.length > 0 ? (
              <GrantList grants={check.data.via} />
            ) : (
              <span>
                No active role grants this permission
                {asked.campusId ? " on that campus" : ""}.
              </span>
            )}
            {!check.data.allowed &&
              check.data.via.length > 0 &&
              status !== "active" && (
                <span>
                  The roles grant it, but the account is{" "}
                  {humanize(status).toLowerCase()}.
                </span>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
