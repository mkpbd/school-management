"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { InboxMessage } from "@/components/com/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";

/** In-app notifications of the signed-in user (any logged-in user). */
export default function InboxPage() {
  const [limit, setLimit] = useState(50);
  const inbox = useQuery({
    queryKey: ["com.inbox", limit],
    queryFn: () => api.com.me.inbox<InboxMessage[]>({ limit }),
    refetchInterval: 60_000,
  });
  const rows = inbox.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Your in-app notifications."
        actions={
          <>
            <select
              aria-label="Show"
              className="select select-sm h-8 w-32"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  Latest {n}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Refresh"
              disabled={inbox.isFetching}
              onClick={() => inbox.refetch()}
            >
              <RefreshCwIcon />
            </Button>
          </>
        }
      />
      <Card>
        <CardContent>
          {inbox.isError ? (
            <ErrorAlert error={inbox.error} />
          ) : inbox.isPending ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>No notifications.</Empty>
          ) : (
            <ul className="divide-y">
              {rows.map((m) => (
                <li key={m.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {m.subject ?? humanize(m.eventCode.split(".").pop())}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {m.body}
                  </p>
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.eventCode}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
