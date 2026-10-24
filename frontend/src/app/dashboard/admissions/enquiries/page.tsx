"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState } from "react";
import {
  campaignsRef,
  isOverdue,
  SOURCES,
  SourceCell,
  SpamBadge,
  StageBadge,
  STAGES,
} from "@/components/adm/shared";
import { EnquiryCreateDialog } from "@/components/adm/enquiry";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { EnquiryRow, EnquiryStage } from "@/lib/api/services/adm-office";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const PAGE_SIZE = 50;

export default function EnquiriesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Enquiries />
    </Suspense>
  );
}

function Enquiries() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const [tab, setTab] = useState<"inbox" | "spam">("inbox");
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [stage, setStage] = useState<EnquiryStage | "">("");
  const [sourceCode, setSourceCode] = useState("");
  const [campaignId, setCampaignId] = useState(
    () => params.get("campaignId") ?? "",
  );
  const [yearGroupId, setYearGroupId] = useState("");
  const [mine, setMine] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [creating, setCreating] = useState(false);
  const canCampaigns = can(me, "adm.campaign.view");

  const filter = {
    ...(tab === "spam" ? { spam: "true" as const } : {}),
    ...(search ? { q: search } : {}),
    ...(stage ? { stage } : {}),
    ...(sourceCode ? { sourceCode } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(mine && me ? { assignedTo: me.id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ["adm.enquiries", filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.adm.enquiries.list({
        ...filter,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (last, all) =>
      last.data.length === PAGE_SIZE ? all.length * PAGE_SIZE : undefined,
    enabled: Boolean(me),
  });
  // the inbox has no class filter on the server: narrow the loaded rows
  const rows = list.data?.pages
    .flatMap((p) => p.data)
    .filter((r) => !yearGroupId || r.yearGroupId === yearGroupId);
  const open = (r: EnquiryRow) =>
    router.push(`/dashboard/admissions/enquiries/${r.id}`);

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Admission leads from the website, phone, walk-ins and campaigns. Open one to follow up, move its stage or assign a counsellor."
        actions={
          can(me, "adm.enquiry.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New enquiry
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "inbox" ? "tab-active" : ""}`}
              onClick={() => setTab("inbox")}
            >
              Inbox
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
                placeholder="Name, phone, enquiry no"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label="Stage"
              className="select select-sm h-8 sm:w-40"
              value={stage}
              onChange={(e) => setStage(e.target.value as EnquiryStage | "")}
            >
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <select
              aria-label="Source"
              className="select select-sm h-8 sm:w-36"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
            >
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            {canCampaigns && (
              <div className="sm:w-52">
                <RefSelect
                  source={campaignsRef}
                  value={campaignId}
                  onChange={setCampaignId}
                  placeholder="All campaigns"
                />
              </div>
            )}
            <div className="sm:w-40">
              <RefSelect
                source={refs.yearGroups}
                value={yearGroupId}
                onChange={setYearGroupId}
                placeholder="All classes"
              />
            </div>
            <Input
              type="date"
              aria-label="From"
              className="h-8 sm:w-36"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              type="date"
              aria-label="To"
              className="h-8 sm:w-36"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
              />
              Assigned to me
            </label>
          </div>

          <DataTable<EnquiryRow>
            rows={rows}
            isPending={list.isPending}
            error={list.error}
            onRowClick={open}
            empty={
              tab === "spam"
                ? "No enquiries flagged as spam."
                : "No enquiries match."
            }
            columns={[
              { key: "enquiryNo", label: "Enquiry no", type: "mono" },
              {
                key: "childName",
                label: "Child",
                render: (r) => (
                  <div>
                    <div className="font-medium">{r.childName}</div>
                    {r.childDob && (
                      <div className="text-xs text-muted-foreground">
                        {formatDate(r.childDob)}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "guardianName",
                label: "Guardian",
                render: (r) => (
                  <div>
                    <div>{r.guardianName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.phone}
                    </div>
                  </div>
                ),
              },
              { key: "yearGroupId", label: "Class", ref: refs.yearGroups },
              {
                key: "sourceCode",
                label: "Source",
                render: (r) => (
                  <SourceCell source={r.sourceCode} campaign={r.campaignCode} />
                ),
              },
              {
                key: "stage",
                label: "Stage",
                render: (r) => (
                  <span className="flex items-center gap-1">
                    <StageBadge stage={r.stage} />
                    {r.isSpam && <SpamBadge score={r.spamScore} />}
                  </span>
                ),
              },
              {
                key: "nextFollowUpAt",
                label: "Next follow-up",
                render: (r) =>
                  r.nextFollowUpAt ? (
                    <span
                      className={
                        isOverdue(r.nextFollowUpAt)
                          ? "font-medium whitespace-nowrap text-error"
                          : "whitespace-nowrap"
                      }
                      title={
                        isOverdue(r.nextFollowUpAt) ? "Overdue" : undefined
                      }
                    >
                      {formatDateTime(r.nextFollowUpAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "repeatCount",
                label: "Repeats",
                className: "text-right",
                render: (r) =>
                  r.repeatCount > 0 ? (
                    <span
                      className="badge badge-warning badge-soft badge-sm"
                      title="Times the same phone enquired again"
                    >
                      {r.repeatCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              { key: "createdAt", label: "Created", type: "datetime" },
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
      <EnquiryCreateDialog
        open={creating}
        onOpenChange={setCreating}
        canSeeCampaigns={canCampaigns}
        onCreated={open}
      />
    </>
  );
}
