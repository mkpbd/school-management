"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, MapPinIcon } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { MapView } from "@/components/map";
import { PageHeader, StatusBadge } from "@/components/page";
import { alertDetails, type AlertRow } from "@/components/trn/tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function AlertsPage() {
  const { data: me } = useMe();
  const [open, setOpen] = useState<"true" | "">("true");
  const [campusId, setCampusId] = useState("");
  const [onMap, setOnMap] = useState<AlertRow | null>(null);

  const query = {
    limit: 200,
    ...(open ? { open } : {}),
    ...(campusId ? { campusId } : {}),
  };
  const alerts = useQuery({
    queryKey: ["trn.alerts", query],
    queryFn: () => api.trn.alerts.list<AlertRow[]>(query),
    refetchInterval: 30_000,
  });
  const ack = useAction((id: string) => api.trn.alerts.acknowledge(id), {
    success: "Alert acknowledged",
    invalidate: [["trn.alerts"]],
  });
  const canAck = can(me, "trn.vehicle.edit");

  return (
    <>
      <PageHeader
        title="Transport alerts"
        description="Overspeed and other alerts raised from GPS data."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
              <button
                type="button"
                role="tab"
                className={`tab ${open ? "tab-active" : ""}`}
                onClick={() => setOpen("true")}
              >
                Open
              </button>
              <button
                type="button"
                role="tab"
                className={`tab ${!open ? "tab-active" : ""}`}
                onClick={() => setOpen("")}
              >
                All
              </button>
            </div>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
          </div>
          <DataTable<AlertRow>
            rows={alerts.data?.data}
            isPending={alerts.isPending}
            error={alerts.error}
            empty={open ? "No open alerts." : "No alerts."}
            columns={[
              { key: "at", label: "When", type: "datetime" },
              {
                key: "kind",
                label: "Alert",
                render: (a) => (
                  <span className="badge badge-soft badge-error badge-sm">
                    {humanize(a.kind)}
                  </span>
                ),
              },
              { key: "regNo", label: "Vehicle" },
              {
                key: "details",
                label: "Details",
                render: (a) => alertDetails(a.details),
              },
              {
                key: "acknowledgedAt",
                label: "Status",
                render: (a) =>
                  a.acknowledgedAt ? (
                    <span title={formatDateTime(a.acknowledgedAt)}>
                      <StatusBadge status="closed" />
                    </span>
                  ) : (
                    <StatusBadge status="open" />
                  ),
              },
            ]}
            actions={(a) => (
              <>
                {a.lat !== null && a.lng !== null && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show on map"
                    onClick={() => setOnMap(a)}
                  >
                    <MapPinIcon />
                  </Button>
                )}
                {canAck && !a.acknowledgedAt && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(a.id)}
                  >
                    <CheckIcon /> Acknowledge
                  </Button>
                )}
              </>
            )}
          />
        </CardContent>
      </Card>
      <Dialog open={onMap !== null} onOpenChange={(o) => !o && setOnMap(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {onMap &&
                `${humanize(onMap.kind)} · ${onMap.regNo} · ${formatDateTime(onMap.at)}`}
            </DialogTitle>
          </DialogHeader>
          {onMap && (
            <MapView
              height={360}
              fitKey={onMap.id}
              markers={[
                {
                  id: onMap.id,
                  lat: onMap.lat!,
                  lng: onMap.lng!,
                  tone: "alert",
                  title: alertDetails(onMap.details),
                },
              ]}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
