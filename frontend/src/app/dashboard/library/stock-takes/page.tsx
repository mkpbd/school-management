"use client";

import { PlayIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import {
  forgetStockTake,
  loadStockTakes,
  rememberStockTake,
} from "@/components/lib/stock-take-store";
import { Empty, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { refs } from "@/lib/refs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// localStorage list as an external store, so it renders on the client without an effect.
let listeners: Array<() => void> = [];
let snapshot: string | null = null;
function subscribe(l: () => void) {
  listeners.push(l);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}
function getSnapshot() {
  const next = JSON.stringify(loadStockTakes());
  if (next !== snapshot) snapshot = next;
  return snapshot;
}
function notify() {
  listeners.forEach((l) => l());
}

export default function StockTakesPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [campusId, setCampusId] = useState("");
  const [openId, setOpenId] = useState("");
  const remembered = JSON.parse(
    useSyncExternalStore(subscribe, getSnapshot, () => "[]"),
  ) as ReturnType<typeof loadStockTakes>;

  const start = useAction(
    () => api.lib.stockTakes.start(campusId ? { campusId } : {}),
    {
      success: "Stock-take started",
      onSuccess: (r) => {
        rememberStockTake({
          id: r.data.id,
          campusId: campusId || null,
          startedAt: new Date().toISOString(),
        });
        router.push(`/dashboard/library/stock-takes/${r.data.id}`);
      },
    },
  );

  return (
    <>
      <PageHeader
        title="Stock-takes"
        description="Scan every copy on the shelves, then compare with what the system expects."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {can(me, "lib.stock_take.create") && (
          <Card>
            <CardHeader>
              <CardTitle>Start a stock-take</CardTitle>
              <CardDescription>
                One stock-take at a time per campus library.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <RefSelect
                  source={refs.campuses}
                  value={campusId}
                  placeholder="Active campus"
                  onChange={setCampusId}
                />
              </div>
              <Button
                disabled={start.isPending}
                onClick={() => start.mutate(undefined)}
              >
                {start.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <PlayIcon />
                )}{" "}
                Start
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Open by id</CardTitle>
            <CardDescription>
              Stock-takes started on another device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = openId.trim();
                if (!UUID_RE.test(id)) return;
                rememberStockTake({
                  id,
                  campusId: null,
                  startedAt: new Date().toISOString(),
                });
                router.push(`/dashboard/library/stock-takes/${id}`);
              }}
            >
              <Input
                className="font-mono"
                placeholder="Stock-take id"
                value={openId}
                onChange={(e) => setOpenId(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!UUID_RE.test(openId.trim())}
              >
                Open
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent on this device</CardTitle>
        </CardHeader>
        <CardContent>
          {remembered.length === 0 ? (
            <Empty>No stock-takes yet.</Empty>
          ) : (
            <ul className="divide-y">
              {remembered.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <Link
                    className="link link-hover"
                    href={`/dashboard/library/stock-takes/${s.id}`}
                  >
                    {s.campusId ? (
                      <RefLabel source={refs.campuses} id={s.campusId} />
                    ) : (
                      "Stock-take"
                    )}{" "}
                    <span className="text-muted-foreground">
                      · {formatDateTime(s.startedAt)}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Forget"
                    onClick={() => {
                      forgetStockTake(s.id);
                      notify();
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
