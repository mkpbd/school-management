"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { OffsetPager } from "@/components/lib/shared";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { TitleSummary } from "@/lib/api/services/lib";
import { refs } from "@/lib/refs";

const LIMIT = 50;

export default function CataloguePage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [campusId, setCampusId] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const query = {
    limit: LIMIT,
    offset,
    ...(search ? { q: search } : {}),
    ...(campusId ? { campusId } : {}),
    ...(availableOnly ? { availableOnly: "true" as const } : {}),
  };
  const results = useQuery({
    queryKey: ["lib.catalogue", query],
    queryFn: () => api.lib.catalogue(query),
  });
  const rows = results.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Search by title, subtitle, ISBN or author. Counts are per campus when one is picked."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-72">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Title, ISBN or author"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={(v) => {
                  setCampusId(v);
                  setOffset(0);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={availableOnly}
                onChange={(e) => {
                  setAvailableOnly(e.target.checked);
                  setOffset(0);
                }}
              />
              Available only
            </label>
          </div>
          <DataTable<TitleSummary>
            rows={rows}
            isPending={results.isPending}
            error={results.error}
            empty="No titles match."
            onRowClick={(t) => router.push(`/dashboard/library/titles/${t.id}`)}
            columns={[
              {
                key: "title",
                label: "Title",
                render: (t) => (
                  <div>
                    <div className="font-medium">{t.title}</div>
                    {t.subtitle && (
                      <div className="text-xs text-muted-foreground">
                        {t.subtitle}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "authors", label: "Authors" },
              { key: "isbn", label: "ISBN", type: "mono" },
              { key: "mediaType", label: "Type", type: "enum" },
              { key: "copies", label: "Copies" },
              {
                key: "available",
                label: "Available",
                render: (t) => (
                  <span
                    className={`badge badge-soft badge-sm ${t.available > 0 ? "badge-success" : "badge-error"}`}
                  >
                    {t.available}
                  </span>
                ),
              },
              { key: "waiting", label: "Waiting" },
            ]}
          />
          <OffsetPager
            offset={offset}
            limit={LIMIT}
            count={rows.length}
            onChange={setOffset}
          />
        </CardContent>
      </Card>
    </>
  );
}
