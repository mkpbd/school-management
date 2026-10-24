"use client";

import { Suspense } from "react";
import { StudentMealsPanel } from "@/components/hst/meals";
import { ChildPicker, useUrlState } from "@/components/hst/shared";
import { Empty, Loading, PageHeader } from "@/components/page";
import { can, useMe } from "@/hooks/use-me";

export default function MealOptOutsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OptOutsView />
    </Suspense>
  );
}

/** Guardians: their children; residents: themselves; the warden: any resident (hst.mess.create, no cutoff). */
function OptOutsView() {
  const { data: me, isPending } = useMe();
  const [{ studentId: picked }, setUrl] = useUrlState({ studentId: "" });
  if (isPending) return <Loading />;
  const ownStudent = me?.studentId;
  const studentId = ownStudent ?? picked;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Meal opt-outs"
        description="Skip hostel meals for a home visit, outing or fasting, or take a skipped meal back. Guardians and residents can change a meal until the cutoff before it; the warden until it is served."
      />
      {!ownStudent && (
        <ChildPicker
          value={picked}
          onChange={(id) => setUrl({ studentId: id })}
          staff={can(me, "hst.mess.create")}
        />
      )}
      {studentId ? (
        <StudentMealsPanel key={studentId} studentId={studentId} />
      ) : (
        <Empty>Pick a student.</Empty>
      )}
    </div>
  );
}
