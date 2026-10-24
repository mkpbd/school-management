"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { can, useMe } from "@/hooks/use-me";
import { getActiveCampus, setActiveCampus } from "@/lib/api";
import { refs } from "@/lib/refs";

/** Active campus for writes (X-Campus-Id). Hidden for single-campus users. */
export function CampusSwitcher() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(() => getActiveCampus() ?? "");
  const enabled = Boolean(me && can(me, "core.master.view"));
  const campuses = useQuery({
    queryKey: ["ref", refs.campuses.key],
    queryFn: refs.campuses.load,
    enabled,
    staleTime: 60_000,
  });

  const allowed = (campuses.data ?? []).filter(
    (c) => me?.campusIds === "*" || me?.campusIds.includes(String(c.id)),
  );
  if (!enabled || allowed.length < 2) return null;

  return (
    <select
      aria-label="Active campus"
      className="select select-sm h-8 w-44"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        setActiveCampus(e.target.value || null);
        void queryClient.invalidateQueries();
      }}
    >
      <option value="">All campuses</option>
      {allowed.map((c) => (
        <option key={String(c.id)} value={String(c.id)}>
          {refs.campuses.label(c)}
        </option>
      ))}
    </select>
  );
}
