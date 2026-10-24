"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WebsiteNotice } from "@/components/com/shared";
import { RefSelect } from "@/components/crud/fields";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

/** Preview of the public website listing (GET /com/public/notices needs no login). */
export default function WebsiteNoticesPage() {
  const [campusId, setCampusId] = useState("");
  const [limit, setLimit] = useState(20);
  const [lang, setLang] = useState<"en" | "bn">("en");
  const query = { limit, ...(campusId ? { campusId } : {}) };
  const notices = useQuery({
    queryKey: ["com.website", query],
    queryFn: () => api.com.notices.website<WebsiteNotice[]>(query),
  });
  const rows = notices.data?.data ?? [];
  const bn = lang === "bn";

  return (
    <>
      <PageHeader
        title="Website notices"
        description="What the public school website lists: published, unexpired notices marked for the website."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
            <select
              aria-label="Show"
              className="select select-sm h-8 sm:w-32"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  Latest {n}
                </option>
              ))}
            </select>
            <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
              <button
                type="button"
                role="tab"
                className={`tab ${!bn ? "tab-active" : ""}`}
                onClick={() => setLang("en")}
              >
                English
              </button>
              <button
                type="button"
                role="tab"
                className={`tab ${bn ? "tab-active" : ""}`}
                onClick={() => setLang("bn")}
              >
                বাংলা
              </button>
            </div>
          </div>
          {notices.isError ? (
            <ErrorAlert error={notices.error} />
          ) : notices.isPending ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>No notices on the website.</Empty>
          ) : (
            <div className="space-y-3">
              {rows.map((n) => (
                <details
                  key={n.id}
                  className="collapse collapse-arrow rounded-lg border"
                >
                  <summary className="collapse-title">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" lang={lang}>
                        {bn && n.titleBn ? n.titleBn : n.titleEn}
                      </span>
                      <span className="badge badge-ghost badge-sm">
                        {humanize(n.category)}
                      </span>
                      {n.circularNo && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {n.circularNo}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(n.publishedAt)}
                      {n.expiresAt && ` · until ${formatDate(n.expiresAt)}`}
                    </div>
                  </summary>
                  <div className="collapse-content">
                    <p className="text-sm whitespace-pre-wrap" lang={lang}>
                      {bn && n.bodyBn ? n.bodyBn : n.bodyEn}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
