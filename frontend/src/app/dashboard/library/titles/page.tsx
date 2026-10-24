"use client";

import { useRouter } from "next/navigation";
import { ResourcePage } from "@/components/crud/resource-page";
import { MEDIA_TYPES } from "@/components/lib/shared";
import { api } from "@/lib/api";

export default function TitlesPage() {
  const router = useRouter();
  return (
    <ResourcePage
      title="Book titles"
      description="Bibliographic records. Open a title to accession copies, set the cover or reserve it."
      queryKey="lib.titles"
      entity="title"
      resource={api.lib.titles}
      permissions={{
        create: "lib.catalogue.create",
        edit: "lib.catalogue.edit",
      }}
      filters={[
        {
          name: "mediaType",
          label: "Types",
          type: "select",
          options: MEDIA_TYPES,
        },
      ]}
      onRowClick={(row) =>
        router.push(`/dashboard/library/titles/${String(row.id)}`)
      }
      columns={[
        { key: "title", label: "Title" },
        { key: "authors", label: "Authors" },
        { key: "isbn", label: "ISBN", type: "mono" },
        { key: "publisher", label: "Publisher" },
        { key: "publishedYear", label: "Year" },
        { key: "mediaType", label: "Type", type: "enum" },
        { key: "categoryCode", label: "Category" },
      ]}
      fields={[
        { name: "title", label: "Title", required: true, wide: true },
        { name: "subtitle", label: "Subtitle", wide: true },
        {
          name: "authors",
          label: "Authors",
          type: "list",
          wide: true,
          help: "Comma separated",
        },
        {
          name: "isbn",
          label: "ISBN",
          nullable: true,
          help: "ISBN-10 or ISBN-13",
        },
        {
          name: "mediaType",
          label: "Media type",
          type: "select",
          options: MEDIA_TYPES,
          defaultValue: "book",
        },
        { name: "publisher", label: "Publisher" },
        { name: "edition", label: "Edition" },
        { name: "publishedYear", label: "Published year", type: "number" },
        {
          name: "language",
          label: "Language",
          defaultValue: "en",
          help: "e.g. en, bn",
        },
        { name: "categoryCode", label: "Category code" },
        { name: "readingLevel", label: "Reading level" },
      ]}
    />
  );
}
