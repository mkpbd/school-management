"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NoticeFormDialog } from "@/components/com/notice-form";
import {
  CATEGORIES,
  NOTICE_STATUSES,
  PriorityBadge,
  type NoticeRow,
  type NoticeStatus,
} from "@/components/com/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const LIMIT = 50;

export default function NoticesPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [status, setStatus] = useState<NoticeStatus | "">("");
  const [category, setCategory] = useState("");
  const [campusId, setCampusId] = useState("");
  const [offset, setOffset] = useState(0);
  const [composing, setComposing] = useState(false);

  const query = {
    limit: LIMIT,
    offset,
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(campusId ? { campusId } : {}),
  };
  const notices = useQuery({
    queryKey: ["com.notices", query],
    queryFn: () => api.com.notices.list<NoticeRow[]>(query),
  });
  const canCreate = can(me, "com.notice.create");

  const publish = useAction(
    (id: string) => api.com.notices.publish<NoticeRow>(id),
    {
      success: (r) =>
        r.data.status === "scheduled" ? "Notice scheduled" : "Notice published",
      invalidate: [["com.notices"]],
    },
  );
  const publishDue = useAction(
    () => api.com.notices.publishDue<{ published: number }>(),
    {
      success: (r) =>
        `${r.data.published} scheduled notice${r.data.published === 1 ? "" : "s"} published`,
      invalidate: [["com.notices"]],
    },
  );

  const filter = (fn: () => void) => {
    fn();
    setOffset(0);
  };
  const rows = notices.data?.data;

  return (
    <>
      <PageHeader
        title="Notices"
        description="Notices and circulars for students, guardians and staff: targeted, scheduled, with read receipts."
        actions={
          canCreate && (
            <>
              <Button
                variant="outline"
                disabled={publishDue.isPending}
                onClick={() => publishDue.mutate(undefined)}
              >
                <ClockIcon /> Publish due now
              </Button>
              <Button onClick={() => setComposing(true)}>
                <PlusIcon /> New notice
              </Button>
            </>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
              {(["", ...NOTICE_STATUSES] as const).map((s) => (
                <button
                  key={s || "all"}
                  type="button"
                  role="tab"
                  className={`tab ${status === s ? "tab-active" : ""}`}
                  onClick={() => filter(() => setStatus(s))}
                >
                  {s ? humanize(s) : "All"}
                </button>
              ))}
            </div>
            <select
              aria-label="Category"
              className="select select-sm h-8 lg:w-44"
              value={category}
              onChange={(e) => filter(() => setCategory(e.target.value))}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
            <div className="lg:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={(v) => filter(() => setCampusId(v))}
              />
            </div>
          </div>
          <DataTable<NoticeRow>
            rows={rows}
            isPending={notices.isPending}
            error={notices.error}
            empty="No notices."
            onRowClick={(n) =>
              router.push(`/dashboard/communication/notices/${n.id}`)
            }
            columns={[
              {
                key: "titleEn",
                label: "Title",
                render: (n) => (
                  <div className="max-w-md">
                    <Link
                      href={`/dashboard/communication/notices/${n.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {n.titleEn}
                    </Link>
                    {n.circularNo && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {n.circularNo}
                      </span>
                    )}
                    {n.titleBn && (
                      <div className="truncate text-xs text-muted-foreground">
                        {n.titleBn}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "category", label: "Category", type: "enum" },
              {
                key: "priority",
                label: "Priority",
                render: (n) => <PriorityBadge priority={n.priority} />,
              },
              { key: "status", label: "Status", type: "status" },
              { key: "publishAt", label: "Publish at", type: "datetime" },
              {
                key: "campusId",
                label: "Campus",
                render: (n) =>
                  n.campusId ? (
                    <RefLabel source={refs.campuses} id={n.campusId} />
                  ) : (
                    "All campuses"
                  ),
              },
              {
                key: "recipientCount",
                label: "Recipients",
                className: "text-right",
                render: (n) => (
                  <span className="tabular-nums">
                    {n.recipientCount ?? "—"}
                  </span>
                ),
              },
              { key: "publishToWebsite", label: "Website", type: "bool" },
            ]}
            actions={(n) =>
              canCreate &&
              (n.status === "draft" || n.status === "scheduled") && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(n.id)}
                >
                  <SendIcon /> Publish
                </Button>
              )
            }
          />
          {(offset > 0 || (rows?.length ?? 0) >= LIMIT) && (
            <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <span>
                {offset + 1}–{offset + (rows?.length ?? 0)}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next"
                disabled={(rows?.length ?? 0) < LIMIT}
                onClick={() => setOffset(offset + LIMIT)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <NoticeFormDialog
        open={composing}
        onOpenChange={setComposing}
        onSaved={(n) => {
          void notices.refetch();
          router.push(`/dashboard/communication/notices/${n.id}`);
        }}
      />
    </>
  );
}
