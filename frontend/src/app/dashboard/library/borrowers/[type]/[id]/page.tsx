"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BorrowerAccountView } from "@/components/lib/borrower-account";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { BorrowerType } from "@/lib/api/services/lib";

export default function BorrowerPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const valid = type === "student" || type === "staff";
  const queryKey = ["lib.borrower", type, id];
  const account = useQuery({
    queryKey,
    queryFn: () => api.lib.borrower(type as BorrowerType, id),
    enabled: valid,
  });

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/library/loans" />}
      >
        <ArrowLeftIcon /> Loans
      </Button>
      <PageHeader
        title="Reader account"
        description="Loans, reservations and fines."
      />
      {!valid ? (
        <ErrorAlert error={new Error("Unknown reader type")} />
      ) : account.isPending ? (
        <Loading />
      ) : account.isError ? (
        <ErrorAlert error={account.error} />
      ) : (
        <BorrowerAccountView account={account.data.data} queryKey={queryKey} />
      )}
    </>
  );
}
