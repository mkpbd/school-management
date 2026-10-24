"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  ScopeBadge,
  ScopeLegend,
  usePermissionCatalogue,
  type RoleMatrixView,
} from "@/components/iam/access";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

export default function RoleMatrixPage() {
  const catalogue = usePermissionCatalogue();
  const [chosen, setChosen] = useState<string | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const mod = chosen ?? catalogue.data?.[0]?.module ?? "";

  const matrix = useQuery({
    queryKey: ["iam.roleMatrix", mod],
    enabled: Boolean(mod),
    queryFn: async () =>
      (await api.iam.roleMatrix<RoleMatrixView>({ module: mod })).data,
  });
  const m = matrix.data;
  const roles = m
    ? m.roles.filter(
        (r) => !hideEmpty || Object.keys(m.cells[r.code] ?? {}).length > 0,
      )
    : [];

  return (
    <>
      <PageHeader
        title="Role matrix"
        description="Who can do what: every role against the permissions of one module, with the data scope of each grant."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="matrix-module" className="text-sm">
                Module
              </Label>
              <select
                id="matrix-module"
                className="select select-sm h-8 w-44"
                disabled={catalogue.isPending}
                value={mod}
                onChange={(e) => setChosen(e.target.value)}
              >
                {(catalogue.data ?? []).map((g) => (
                  <option key={g.module} value={g.module}>
                    {g.module}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex h-8 items-center gap-2 text-sm">
              <Switch
                checked={hideEmpty}
                onCheckedChange={(c) => setHideEmpty(Boolean(c))}
              />
              Hide roles without access
            </label>
          </>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <ScopeLegend />
          {catalogue.isError || matrix.isError ? (
            <ErrorAlert error={catalogue.error ?? matrix.error} />
          ) : catalogue.isPending || matrix.isPending || !m ? (
            <Loading />
          ) : m.permissions.length === 0 ? (
            <Empty>No permissions in this module.</Empty>
          ) : roles.length === 0 ? (
            <Empty>No role has access to {mod}.</Empty>
          ) : (
            <div className="max-h-[70svh] overflow-auto rounded-lg border">
              <table className="text-sm">
                <thead className="sticky top-0 z-20 bg-background">
                  <tr className="border-b">
                    <th className="sticky left-0 z-30 min-w-56 bg-background p-2 text-left text-xs font-medium text-muted-foreground">
                      Permission
                    </th>
                    {roles.map((r) => (
                      <th
                        key={r.id}
                        className="min-w-24 p-2 text-left align-bottom text-xs font-medium"
                      >
                        <Link
                          href={`/dashboard/access/roles/${r.id}`}
                          className="link-hover"
                          title={r.nameEn}
                        >
                          <div className="font-mono">{r.code}</div>
                          <div className="font-normal text-muted-foreground">
                            {r.nameEn}
                          </div>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.permissions.map((p) => (
                    <tr
                      key={p.code}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td
                        className="sticky left-0 z-10 bg-background p-2"
                        title={p.description ?? undefined}
                      >
                        <div className="flex items-center gap-1">
                          {humanize(p.resource)} · {p.action}
                          {p.isSensitive && (
                            <ShieldAlertIcon
                              className="size-3.5 text-warning"
                              aria-label="Sensitive"
                            />
                          )}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {p.code}
                        </div>
                      </td>
                      {roles.map((r) => {
                        const scope = m.cells[r.code]?.[p.code];
                        return (
                          <td key={r.id} className="p-2">
                            {scope ? (
                              <ScopeBadge scope={scope} />
                            ) : (
                              <span className="text-muted-foreground">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
