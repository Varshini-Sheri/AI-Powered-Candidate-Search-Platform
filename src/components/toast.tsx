"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast { id: number; text: string; action?: { label: string; href: string } }
const ToastContext = createContext<(text: string, action?: Toast["action"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className="anim-fade pointer-events-auto flex items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
            <span>{t.text}</span>
            {t.action && (
              <a href={t.action.href} className="font-medium text-[#c4bcff] underline-offset-2 hover:underline">
                {t.action.label}
              </a>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
