"use client";

import { useQuery } from "@tanstack/react-query";
import {
  InboxIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  QrCodeIcon,
  SquareIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  CAMPAIGN_INVALIDATE,
  CampaignFormDialog,
  CampaignLinkDialog,
} from "@/components/adm/campaign";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { CampaignRow } from "@/lib/api/services/adm-office";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function CampaignsPage() {
  const { data: me } = useMe();
  const [active, setActive] = useState<"" | "true" | "false">("true");
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<CampaignRow | null>(null);
  const query = active ? { active } : {};
  const list = useQuery({
    queryKey: ["adm.campaigns", query],
    queryFn: () => api.adm.campaigns.list(query),
  });
  const setActiveFlag = useAction(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.adm.campaigns.update(id, { isActive }),
    {
      success: (r) =>
        r.data.isActive ? `${r.data.code} reactivated` : `${r.data.code} ended`,
      invalidate: CAMPAIGN_INVALIDATE,
    },
  );
  const canCreate = can(me, "adm.campaign.create");
  const canEdit = can(me, "adm.campaign.edit");
  const canEnquiries = can(me, "adm.enquiry.view");

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Tracked links and QR codes for ads, posters, SMS and events. Enquiries through a link are counted per campaign in the funnel."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New campaign
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
            {(
              [
                ["true", "Active"],
                ["false", "Ended"],
                ["", "All"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                className={`tab ${active === v ? "tab-active" : ""}`}
                onClick={() => setActive(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <DataTable<CampaignRow>
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            empty="No campaigns."
            onRowClick={setShowing}
            columns={[
              { key: "code", label: "Code", type: "mono" },
              {
                key: "name",
                label: "Name",
                render: (c) => (
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.campusId ? (
                        <RefLabel source={refs.campuses} id={c.campusId} />
                      ) : (
                        "All campuses"
                      )}
                    </div>
                  </div>
                ),
              },
              {
                key: "channel",
                label: "Channel",
                render: (c) => humanize(c.channel),
              },
              {
                key: "utm",
                label: "UTM",
                render: (c) => {
                  const parts = [c.utmSource, c.utmMedium, c.utmCampaign];
                  return parts.some(Boolean) ? (
                    <span className="font-mono text-xs">
                      {parts.map((p) => p ?? "·").join(" / ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  );
                },
              },
              {
                key: "startsOn",
                label: "Dates",
                render: (c) =>
                  c.startsOn || c.endsOn ? (
                    <span className="whitespace-nowrap">
                      {formatDate(c.startsOn)} – {formatDate(c.endsOn)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Open-ended</span>
                  ),
              },
              {
                key: "budgetPaisa",
                label: "Budget",
                className: "text-right",
                render: (c) =>
                  c.budgetPaisa === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="tabular-nums">
                      {formatMoney(c.budgetPaisa)}
                    </span>
                  ),
              },
              {
                key: "isActive",
                label: "Status",
                render: (c) =>
                  c.isActive ? (
                    <span className="badge badge-success badge-soft badge-sm">
                      Active
                    </span>
                  ) : (
                    <span className="badge badge-ghost badge-sm">Ended</span>
                  ),
              },
            ]}
            actions={(c) => (
              <>
                <Button variant="ghost" size="xs" onClick={() => setShowing(c)}>
                  <QrCodeIcon /> Link / QR
                </Button>
                {canEnquiries && (
                  <Button
                    nativeButton={false}
                    variant="ghost"
                    size="xs"
                    render={
                      <Link
                        href={`/dashboard/admissions/enquiries?campaignId=${c.id}`}
                      />
                    }
                  >
                    <InboxIcon /> Enquiries
                  </Button>
                )}
                {canEdit && (
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditing(c)}
                    >
                      <PencilIcon /> Edit
                    </Button>
                    {c.isActive ? (
                      <ConfirmButton
                        size="xs"
                        variant="ghost"
                        destructive
                        title={`End ${c.code}?`}
                        description="The link keeps working, but new enquiries through it are no longer counted for this campaign."
                        confirmLabel="End campaign"
                        onConfirm={() =>
                          setActiveFlag.mutateAsync({
                            id: c.id,
                            isActive: false,
                          })
                        }
                      >
                        <SquareIcon /> End
                      </ConfirmButton>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setActiveFlag.mutate({ id: c.id, isActive: true })
                        }
                      >
                        <PlayIcon /> Reactivate
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          />
        </CardContent>
      </Card>
      <CampaignFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={setShowing}
      />
      <CampaignFormDialog
        campaign={editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <CampaignLinkDialog
        campaign={showing}
        onOpenChange={(o) => !o && setShowing(null)}
      />
    </>
  );
}
