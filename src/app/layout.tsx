import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth";
import { DataProvider } from "@/components/data";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Scout",
  description: "Find candidates by describing them in plain English.",
};

export const viewport: Viewport = { themeColor: "#f6f5fc", width: "device-width", initialScale: 1 };

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>
          <DataProvider>
            <ToastProvider>
              {children}
              {modal}
            </ToastProvider>
          </DataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
