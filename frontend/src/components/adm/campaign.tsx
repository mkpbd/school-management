"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, DownloadIcon, PrinterIcon } from "lucide-react";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/crud/form-dialog";
import type { FieldDef } from "@/components/crud/fields";
import { ErrorAlert, Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { CampaignRow } from "@/lib/api/services/adm-office";
import { refs } from "@/lib/refs";
import { CHANNELS } from "./shared";

type CreateBody = Parameters<typeof api.adm.campaigns.create>[0];
type UpdateBody = Parameters<typeof api.adm.campaigns.update>[1];

export const CAMPAIGN_INVALIDATE = [["adm.campaigns"]];

const FIELDS: FieldDef[] = [
  {
    name: "code",
    label: "Code",
    required: true,
    mode: "create",
    placeholder: "FB-SPRING26",
    help: "Letters, digits, - and _ (2-40). Used in the link as ?campaign=CODE; cannot change later.",
  },
  { name: "name", label: "Name", required: true },
  {
    name: "channel",
    label: "Channel",
    type: "select",
    options: CHANNELS,
    required: true,
  },
  {
    name: "campusId",
    label: "Campus",
    type: "ref",
    ref: refs.campuses,
    placeholder: "All campuses",
    nullable: true,
  },
  {
    name: "landingPath",
    label: "Landing page",
    placeholder: "/admission",
    help: "Path on the school website the link opens.",
  },
  {
    name: "budgetPaisa",
    label: "Budget",
    type: "money",
    nullable: true,
    help: "For cost per enquiry in the funnel.",
  },
  { name: "startsOn", label: "Starts on", type: "date", nullable: true },
  { name: "endsOn", label: "Ends on", type: "date", nullable: true },
  {
    name: "utmSource",
    label: "UTM source",
    placeholder: "facebook",
    nullable: true,
    help: "Ad links tagged with these UTM values count for this campaign too.",
  },
  { name: "utmMedium", label: "UTM medium", placeholder: "cpc", nullable: true },
  {
    name: "utmCampaign",
    label: "UTM campaign",
    placeholder: "admission_2027",
    nullable: true,
  },
  {
    name: "isActive",
    label: "Active",
    type: "boolean",
    defaultValue: true,
  },
];

/** Create (no row) or edit a campaign. */
export function CampaignFormDialog({
  campaign,
  open,
  onOpenChange,
  onSaved,
}: {
  campaign?: CampaignRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (c: CampaignRow) => void;
}) {
  const save = useAction(
    (body: CreateBody | UpdateBody) =>
      campaign
        ? api.adm.campaigns.update(campaign.id, body as UpdateBody)
        : api.adm.campaigns.create(body as CreateBody),
    {
      invalidate: CAMPAIGN_INVALIDATE,
      toastError: false,
      onSuccess: (r) => onSaved?.(r.data),
    },
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={campaign ? `Edit ${campaign.code}` : "New campaign"}
      description={
        campaign
          ? undefined
          : "A tracked link (and QR code) for an ad, poster, SMS or event; enquiries through it are counted per campaign."
      }
      row={campaign ?? undefined}
      successMessage={campaign ? "Campaign saved" : "Campaign created"}
      fields={FIELDS}
      onSubmit={(body) => save.mutateAsync(body as CreateBody)}
    />
  );
}

/** The tracked link with copy, and a QR code to download or print. */
export function CampaignLinkDialog({
  campaign,
  onOpenChange,
}: {
  campaign: CampaignRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={campaign !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {campaign && <LinkBody campaign={campaign} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkBody({ campaign: c }: { campaign: CampaignRow }) {
  const qr = useQuery({
    queryKey: ["adm.campaignQr", c.link],
    queryFn: () =>
      QRCode.toDataURL(c.link, {
        width: 640,
        margin: 2,
        errorCorrectionLevel: "M",
      }),
    staleTime: Infinity,
  });

  function print() {
    if (!qr.data) return;
    const w = window.open("", "_blank", "width=600,height=760");
    if (!w) {
      toast.error("Allow pop-ups to print the QR code");
      return;
    }
    const doc = w.document;
    doc.title = c.name;
    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:system-ui,sans-serif;text-align:center;padding:32px}img{width:80%;max-width:420px}p{word-break:break-all;color:#555;font-size:12px}";
    doc.head.appendChild(style);
    const h = doc.createElement("h2");
    h.textContent = c.name;
    const img = doc.createElement("img");
    img.src = qr.data;
    img.alt = c.link;
    const p = doc.createElement("p");
    p.textContent = c.link;
    doc.body.append(h, img, p);
    img.onload = () => {
      w.focus();
      w.print();
    };
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {c.name} <span className="font-mono text-sm">({c.code})</span>
        </DialogTitle>
        <DialogDescription>
          Use this link in ads, posts and messages, or print the QR code on
          posters and leaflets.
        </DialogDescription>
      </DialogHeader>
      <CopyLink link={c.link} />
      <div className="flex justify-center rounded-lg border bg-white p-4">
        {qr.isPending ? (
          <Loading />
        ) : qr.isError ? (
          <ErrorAlert error={qr.error} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- generated data URL
          <img
            src={qr.data}
            alt={`QR code for ${c.link}`}
            className="size-56"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          disabled={!qr.data}
          render={<a href={qr.data} download={`campaign-${c.code}.png`} />}
        >
          <DownloadIcon /> Download PNG
        </Button>
        <Button size="sm" disabled={!qr.data} onClick={print}>
          <PrinterIcon /> Print
        </Button>
      </div>
    </>
  );
}

/** Read-only link field with a Copy button. */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy; select the link and copy it");
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={link}
        className="h-8 font-mono text-xs"
        onFocus={(e) => e.target.select()}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        aria-label="Copy link"
      >
        {copied ? <CheckIcon /> : <CopyIcon />} Copy
      </Button>
    </div>
  );
}
