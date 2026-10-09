"use client";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { SearchView } from "@/components/search-view";

export default function Home() {
  return (
    <AppShell>
      <Suspense>
        <SearchView />
      </Suspense>
    </AppShell>
  );
}
