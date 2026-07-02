"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export interface DrawingPage {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  url: string;
}

export function DrawingViewer({ pages }: { pages: DrawingPage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = pages[activeIndex];

  return (
    <div className="flex flex-col gap-2">
      {pages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto">
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium",
                index === activeIndex
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              Page {page.pageIndex + 1}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-auto rounded-lg border border-border bg-stage p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL with server-controlled dimensions; no benefit from next/image here */}
        <img
          src={active.url}
          alt={`Drawing page ${active.pageIndex + 1}`}
          className="mx-auto block max-w-full"
        />
      </div>
    </div>
  );
}
