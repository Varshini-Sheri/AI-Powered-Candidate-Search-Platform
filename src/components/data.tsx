"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Plan, Shortlist } from "@/lib/types";
import { api } from "./api";
import { useAuth } from "./auth";

// Company-wide state the header, results and pickers all read: plan and shortlists.

interface DataState {
  plan: Plan | null;
  company: string | null;
  refreshPlan: () => Promise<void>;
  lists: Shortlist[] | null;
  refreshLists: () => Promise<void>;
  setMembership: (listId: string, personId: string, on: boolean) => Promise<void>;
  createList: (name: string) => Promise<string>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [lists, setLists] = useState<Shortlist[] | null>(null);

  const refreshPlan = useCallback(async () => {
    setPlan(await api<Plan>("/api/plan"));
  }, []);
  const refreshLists = useCallback(async () => {
    setLists(await api<Shortlist[]>("/api/shortlists"));
  }, []);

  useEffect(() => {
    if (!session) {
      setPlan(null);
      setLists(null);
      setCompany(null);
      return;
    }
    refreshPlan().catch(() => {});
    refreshLists().catch(() => {});
    api<{ company: { name: string } }>("/api/me").then((r) => setCompany(r.company.name)).catch(() => {});
  }, [session, refreshPlan, refreshLists]);

  const setMembership = useCallback(async (listId: string, personId: string, on: boolean) => {
    const apply = (state: boolean) =>
      setLists((ls) =>
        ls?.map((l) => {
          if (l.id !== listId) return l;
          const ids = state ? [...new Set([...l.person_ids, personId])] : l.person_ids.filter((p) => p !== personId);
          return { ...l, person_ids: ids, count: ids.length };
        }) ?? null,
      );
    apply(on);
    try {
      await api(`/api/shortlists/${listId}/people/${encodeURIComponent(personId)}`, { method: on ? "POST" : "DELETE" });
    } catch (e) {
      apply(!on);
      throw e;
    }
  }, []);

  const createList = useCallback(async (name: string) => {
    const { id } = await api<{ id: string }>("/api/shortlists", { method: "POST", body: { name } });
    setLists((ls) => [...(ls ?? []), { id, name, count: 0, person_ids: [] }]);
    return id;
  }, []);

  return (
    <DataContext.Provider value={{ plan, company, refreshPlan, lists, refreshLists, setMembership, createList }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData outside DataProvider");
  return ctx;
}
