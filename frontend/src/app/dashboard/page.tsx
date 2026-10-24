"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { RefSelect } from "@/components/crud/fields";
import { DetailList, ErrorAlert, Loading } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api, getActiveCampus } from "@/lib/api";
import { formatDate, formatValue } from "@/lib/format";
import { NAV } from "@/lib/nav";
import { refs } from "@/lib/refs";

export default function DashboardPage() {
  const me = useMe();
  const health = useQuery({
    queryKey: ["health", "ready"],
    queryFn: () => api.system.ready(),
    retry: false,
  });

  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorAlert error={me.error} />;

  const user = me.data;
  const permissions = Object.keys(user.permissions).sort();
  const campuses =
    user.campusIds === "*" ? "All" : String(user.campusIds.length);
  const modules = NAV.slice(1)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.permission || can(user, i.permission)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.username ?? user.phone ?? "user"}
        </h1>
        <p className="text-muted-foreground">Signed in as {user.type}</p>
      </div>

      {/* daisyUI stats */}
      <div className="stats stats-vertical w-full border bg-card shadow-sm sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">User type</div>
          <div className="stat-value text-2xl capitalize">{user.type}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Campuses</div>
          <div className="stat-value text-2xl">{campuses}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Permissions</div>
          <div className="stat-value text-2xl">{permissions.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">API</div>
          <div className="stat-value text-2xl">
            {health.isPending ? (
              <span className="loading loading-dots loading-md" />
            ) : health.isSuccess ? (
              <span className="text-success">Ready</span>
            ) : (
              <span className="text-error">Down</span>
            )}
          </div>
        </div>
      </div>

      {can(user, "core.master.view") && <TodayCard />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {g.items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className="btn btn-sm btn-ghost border"
                >
                  <i.icon className="size-4" />
                  {i.title}
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your permissions</CardTitle>
          <CardDescription>
            From GET /api/v1/me. The server checks them again on every call.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {permissions.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No permissions.
            </span>
          )}
          {permissions.map((p) => (
            <Badge key={p} variant="secondary" className="font-mono">
              {p}
              <span className="text-muted-foreground">
                ({user.permissions[p]?.join(", ")})
              </span>
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** GET /core/today: school day, weekend or holiday for a campus. */
function TodayCard() {
  const [campusId, setCampusId] = useState(() => getActiveCampus() ?? "");
  const today = useQuery({
    queryKey: ["core.today", campusId],
    queryFn: () => api.core.today({ campusId }),
    enabled: Boolean(campusId),
  });
  const d = today.data?.data;

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Today</CardTitle>
          <CardDescription>Is today a school day?</CardDescription>
        </div>
        <div className="sm:w-64">
          <RefSelect
            source={refs.campuses}
            value={campusId}
            placeholder="Pick a campus"
            onChange={setCampusId}
          />
        </div>
      </CardHeader>
      <CardContent>
        {!campusId ? (
          <p className="text-sm text-muted-foreground">
            Pick a campus to check.
          </p>
        ) : today.isPending ? (
          <Loading />
        ) : today.isError ? (
          <ErrorAlert error={today.error} />
        ) : (
          <DetailList
            items={Object.entries(d ?? {}).map(([k, v]) => [
              k,
              k === "date"
                ? formatDate(v)
                : typeof v === "object" && v !== null
                  ? JSON.stringify(v)
                  : formatValue(v),
            ])}
          />
        )}
      </CardContent>
    </Card>
  );
}
