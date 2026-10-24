"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  ShieldAlertIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ACTIONS,
  friendly,
  NextRequestNotice,
  ScopeBadge,
  ScopeLegend,
  ScopeSelect,
  usePermissionCatalogue,
  type PermissionChange,
  type PermissionGroup,
  type RoleDetail,
  type RoleListItem,
} from "@/components/iam/access";
import {
  ConfirmButton,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type DataScope } from "@/lib/api";
import { humanize } from "@/lib/format";

export default function RolePermissionsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const role = useQuery({
    queryKey: ["iam.role", id],
    queryFn: async () => (await api.iam.roles.get<RoleDetail>(id)).data,
  });
  const catalogue = usePermissionCatalogue();
  const roles = useQuery({
    queryKey: ["iam.roles"],
    queryFn: async () => (await api.iam.roles.list<RoleListItem[]>()).data,
  });
  const holders = roles.data?.find((r) => r.id === id)?.userCount;
  const [lastChange, setLastChange] = useState<PermissionChange | null>(null);
  const r = role.data;

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/access/roles" />}
      >
        <ArrowLeftIcon /> Roles
      </Button>
      {role.isError || catalogue.isError ? (
        <ErrorAlert error={role.error ?? catalogue.error} />
      ) : !r || !catalogue.data ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={r.nameEn}
            description={
              <>
                <span className="font-mono">{r.code}</span> ·{" "}
                {r.isSystem ? "built-in" : "custom"} role ·{" "}
                {r.permissions.length} permission
                {r.permissions.length === 1 ? "" : "s"}
                {r.requiresMfa && " · MFA required"}
              </>
            }
            actions={
              <Button
                nativeButton={false}
                variant="outline"
                render={
                  <Link href={`/dashboard/access/users?roleId=${r.id}`} />
                }
              >
                <UsersIcon /> Holders{holders !== undefined && ` (${holders})`}
              </Button>
            }
          />
          <NextRequestNotice>
            Saving replaces all permissions of this role.{" "}
            {holders !== undefined
              ? `The ${holders} user${holders === 1 ? "" : "s"} holding it get`
              : "Everyone holding it gets"}{" "}
            the change on their next request. You cannot edit a role you hold
            yourself.
          </NextRequestNotice>
          {lastChange && (
            <ChangeSummary
              change={lastChange}
              onClose={() => setLastChange(null)}
            />
          )}
          <Editor
            key={`${r.id}-${role.dataUpdatedAt}`}
            role={r}
            catalogue={catalogue.data}
            canEdit={can(me, "iam.role.edit")}
            onSaved={setLastChange}
          />
        </>
      )}
    </>
  );
}

function ChangeSummary({
  change,
  onClose,
}: {
  change: PermissionChange;
  onClose: () => void;
}) {
  const lists: Array<[string, string[], string]> = [
    ["Added", change.added, "badge-success"],
    ["Removed", change.removed, "badge-error"],
    ["Scope changed", change.rescoped, "badge-warning"],
  ];
  return (
    <div
      role="status"
      className="alert alert-success alert-soft mb-4 flex-col items-start gap-2 text-sm"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="font-medium">
          Saved: {change.added.length} added, {change.removed.length} removed,{" "}
          {change.rescoped.length} re-scoped · {change.usersAffected} user
          {change.usersAffected === 1 ? "" : "s"} affected on their next
          request.
        </span>
        <Button variant="ghost" size="xs" onClick={onClose}>
          Dismiss
        </Button>
      </div>
      {lists.map(
        ([label, codes, tone]) =>
          codes.length > 0 && (
            <div key={label} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">
                {label}:
              </span>
              {codes.map((c) => (
                <span
                  key={c}
                  className={`badge badge-soft badge-sm font-mono ${tone}`}
                >
                  {c}
                </span>
              ))}
            </div>
          ),
      )}
      {change.sensitiveAdded.length > 0 && (
        <div className="flex items-center gap-1 text-warning">
          <ShieldAlertIcon className="size-4" /> Sensitive permissions granted:{" "}
          {change.sensitiveAdded.join(", ")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Editor({
  role,
  catalogue,
  canEdit,
  onSaved,
}: {
  role: RoleDetail;
  catalogue: PermissionGroup[];
  canEdit: boolean;
  onSaved: (change: PermissionChange) => void;
}) {
  const baseline = useMemo(
    () =>
      Object.fromEntries(
        role.permissions.map((p) => [p.code, p.scope]),
      ) as Record<string, DataScope>,
    [role.permissions],
  );
  const [grants, setGrants] = useState<Record<string, DataScope>>(baseline);
  const [defaultScope, setDefaultScope] = useState<DataScope>("campus");
  const [mod, setMod] = useState("");
  const [search, setSearch] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);

  const sensitive = useMemo(
    () =>
      new Set(
        catalogue.flatMap((g) =>
          g.resources.flatMap((r) =>
            r.actions.filter((a) => a.isSensitive).map((a) => a.code),
          ),
        ),
      ),
    [catalogue],
  );
  const added = Object.keys(grants).filter((c) => !(c in baseline));
  const removed = Object.keys(baseline).filter((c) => !(c in grants));
  const rescoped = Object.keys(grants).filter(
    (c) => c in baseline && baseline[c] !== grants[c],
  );
  const dirty = added.length + removed.length + rescoped.length > 0;
  const sensitiveAdded = added.filter((c) => sensitive.has(c));

  const q = search.trim().toLowerCase();
  const shown = catalogue
    .filter((g) => !mod || g.module === mod)
    .map((g) => ({
      ...g,
      resources: g.resources.filter(
        (r) =>
          (!q ||
            `${g.module}.${r.resource}`.includes(q) ||
            humanize(r.resource).toLowerCase().includes(q)) &&
          (!onlyGranted ||
            r.actions.some((a) => a.code in grants || a.code in baseline)),
      ),
    }))
    .filter((g) => g.resources.length > 0);

  function toggle(code: string, on: boolean) {
    setGrants((prev) => {
      const next = { ...prev };
      if (on) next[code] = baseline[code] ?? defaultScope;
      else delete next[code];
      return next;
    });
  }
  function toggleRow(codes: string[]) {
    const all = codes.every((c) => c in grants);
    setGrants((prev) => {
      const next = { ...prev };
      for (const c of codes) {
        if (all) delete next[c];
        else next[c] ??= baseline[c] ?? defaultScope;
      }
      return next;
    });
  }
  function rescopeShown() {
    const codes = new Set(
      shown.flatMap((g) =>
        g.resources.flatMap((r) => r.actions.map((a) => a.code)),
      ),
    );
    setGrants((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([c, s]) => [
          c,
          codes.has(c) ? defaultScope : s,
        ]),
      ),
    );
  }

  const save = useAction(
    () =>
      friendly(
        api.iam.roles.setPermissions<PermissionChange>(role.id, {
          permissions: Object.entries(grants).map(([code, scope]) => ({
            code,
            scope,
          })),
        }),
      ),
    {
      success: "Permissions saved",
      invalidate: [
        ["iam.role", role.id],
        ["iam.roles"],
        ["iam.roleMatrix"],
        ["iam.user"],
      ],
      onSuccess: (r) => onSaved(r.data),
    },
  );

  const grantedIn = (g: PermissionGroup) =>
    g.resources.reduce(
      (n, r) => n + r.actions.filter((a) => a.code in grants).length,
      0,
    );
  const totalIn = (g: PermissionGroup) =>
    g.resources.reduce((n, r) => n + r.actions.length, 0);

  return (
    <>
      <Card className="mb-4">
        <CardContent className="space-y-3">
          <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5 sm:w-56">
              <Label htmlFor="perm-module">Module</Label>
              <select
                id="perm-module"
                className="select select-sm h-8 w-full"
                value={mod}
                onChange={(e) => setMod(e.target.value)}
              >
                <option value="">All modules</option>
                {catalogue.map((g) => (
                  <option key={g.module} value={g.module}>
                    {g.module} ({grantedIn(g)}/{totalIn(g)})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:w-56">
              <Label htmlFor="perm-search">Resource</Label>
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="perm-search"
                  className="pl-8"
                  placeholder="e.g. invoice"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {canEdit && (
              <div className="space-y-1.5 sm:w-48">
                <Label htmlFor="perm-default-scope">Scope for new grants</Label>
                <div id="perm-default-scope">
                  <ScopeSelect
                    size="sm"
                    value={defaultScope}
                    onChange={setDefaultScope}
                  />
                </div>
              </div>
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={rescopeShown}
                title="Applies to granted permissions shown below"
              >
                Set shown grants to {humanize(defaultScope).toLowerCase()}
              </Button>
            )}
            <label className="flex h-8 items-center gap-2 text-sm">
              <Switch
                checked={onlyGranted}
                onCheckedChange={(c) => setOnlyGranted(Boolean(c))}
              />
              Only granted
            </label>
          </div>
          <ScopeLegend />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {shown.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nothing matches.
          </div>
        )}
        {shown.map((g) => (
          <Card key={g.module}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="uppercase tracking-wide">{g.module}</span>
                <Badge variant="secondary">
                  {grantedIn(g)} / {totalIn(g)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Resource</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="w-28 px-1 py-2 font-medium">
                        {humanize(a)}
                      </th>
                    ))}
                    {canEdit && <th className="w-12 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {g.resources.map((r) => {
                    const codes = r.actions.map((a) => a.code);
                    return (
                      <tr
                        key={r.resource}
                        className="border-b align-top last:border-0"
                      >
                        <td className="py-2 pr-2">
                          <div className="font-medium">
                            {humanize(r.resource)}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {g.module}.{r.resource}
                          </div>
                        </td>
                        {ACTIONS.map((action) => {
                          const a = r.actions.find((x) => x.action === action);
                          if (!a)
                            return (
                              <td
                                key={action}
                                className="px-1 py-2 text-muted-foreground"
                              >
                                —
                              </td>
                            );
                          const on = a.code in grants;
                          const tone = !on
                            ? a.code in baseline
                              ? "bg-error/10"
                              : ""
                            : !(a.code in baseline)
                              ? "bg-success/10"
                              : baseline[a.code] !== grants[a.code]
                                ? "bg-warning/10"
                                : "";
                          return (
                            <td key={action} className={`px-1 py-2 ${tone}`}>
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-xs"
                                  checked={on}
                                  disabled={!canEdit}
                                  aria-label={a.code}
                                  onChange={(e) =>
                                    toggle(a.code, e.target.checked)
                                  }
                                />
                                {a.isSensitive && (
                                  <ShieldAlertIcon
                                    className="size-3.5 text-warning"
                                    aria-label="Sensitive"
                                  />
                                )}
                              </label>
                              {on &&
                                (canEdit ? (
                                  <div className="mt-1">
                                    <ScopeSelect
                                      aria-label={`Scope of ${a.code}`}
                                      value={grants[a.code]}
                                      onChange={(s) =>
                                        setGrants((prev) => ({
                                          ...prev,
                                          [a.code]: s,
                                        }))
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div className="mt-1">
                                    <ScopeBadge scope={grants[a.code]} long />
                                  </div>
                                ))}
                            </td>
                          );
                        })}
                        {canEdit && (
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => toggleRow(codes)}
                            >
                              {codes.every((c) => c in grants) ? "None" : "All"}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      {canEdit && (
        <div className="sticky bottom-0 z-10 mt-4 flex flex-col gap-2 border-t bg-background/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {dirty ? (
              <>
                <span className="text-success">+{added.length} added</span> ·{" "}
                <span className="text-error">−{removed.length} removed</span> ·{" "}
                <span className="text-warning">
                  {rescoped.length} re-scoped
                </span>
                {sensitiveAdded.length > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-warning">
                    <ShieldAlertIcon className="size-4" />{" "}
                    {sensitiveAdded.length} sensitive
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">No unsaved changes.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!dirty}
              onClick={() => setGrants(baseline)}
            >
              <RotateCcwIcon /> Reset
            </Button>
            {dirty ? (
              <ConfirmButton
                variant="default"
                size="default"
                title={`Save permissions of ${role.nameEn}?`}
                description={
                  <>
                    {added.length} added, {removed.length} removed,{" "}
                    {rescoped.length} re-scoped.
                    {sensitiveAdded.length > 0 &&
                      ` Sensitive: ${sensitiveAdded.join(", ")}.`}{" "}
                    Everyone holding this role gets the change on their next
                    request.
                  </>
                }
                confirmLabel="Save"
                onConfirm={() => save.mutateAsync(undefined)}
              >
                <SaveIcon /> Save permissions
              </ConfirmButton>
            ) : (
              <Button disabled>
                <SaveIcon /> Save permissions
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
