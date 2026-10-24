"use client";

import Link from "next/link";
import { RefLabel } from "@/components/crud/fields";
import { ResourcePage } from "@/components/crud/resource-page";
import {
  bookTitlesRef,
  COPY_STATUSES,
  CopyStatusButton,
} from "@/components/lib/shared";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function CopiesPage() {
  const { data: me } = useMe();
  return (
    <ResourcePage
      title="Book copies"
      description="Physical copies. Search by accession number or barcode; add copies from a title's page."
      queryKey="lib.copies"
      entity="copy"
      resource={api.lib.copies}
      permissions={{ edit: "lib.catalogue.edit" }}
      filters={[
        {
          name: "status",
          label: "Statuses",
          type: "select",
          options: COPY_STATUSES,
        },
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        {
          name: "bookTitleId",
          label: "Titles",
          type: "ref",
          ref: bookTitlesRef,
        },
      ]}
      columns={[
        { key: "accessionNo", label: "Accession", type: "mono" },
        { key: "barcode", label: "Barcode", type: "mono" },
        {
          key: "bookTitleId",
          label: "Title",
          render: (c) => (
            <Link
              className="link link-hover"
              href={`/dashboard/library/titles/${String(c.bookTitleId)}`}
            >
              <RefLabel source={bookTitlesRef} id={c.bookTitleId} />
            </Link>
          ),
        },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "shelfLocation", label: "Shelf" },
        { key: "acquiredOn", label: "Acquired", type: "date" },
        { key: "pricePaisa", label: "Price", type: "money" },
        { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "shelfLocation", label: "Shelf location", nullable: true },
        { name: "rfidUid", label: "RFID tag", nullable: true },
        { name: "pricePaisa", label: "Price", type: "money", nullable: true },
      ]}
      rowActions={
        can(me, "lib.catalogue.edit")
          ? (row) => (
              <CopyStatusButton
                copy={row}
                invalidate={["lib.copies", "lib.title", "lib.catalogue"]}
              />
            )
          : undefined
      }
    />
  );
}
