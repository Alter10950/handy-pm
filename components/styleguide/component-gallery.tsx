"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/empty-state";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ProgressBar, ProgressRing } from "@/components/ui/progress-meter";
import { Segmented, SegmentedMulti } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Live gallery of every Phase 11 primitive — the styleguide is the
// contract: if it looks wrong here, fix the component, not the screen.

const MATERIALS = [
  '42"x288" Teardrop Upright',
  '144"x6" Stepbeam',
  '96"x4" Stepbeam',
  '42"x46" Wire Deck',
  '1/2" Wedge Anchor',
];

interface DemoRow {
  id: string;
  name: string;
  size: string;
  required: number;
  installed: number;
}

const DEMO_ROWS: DemoRow[] = [
  {
    id: "1",
    name: "Teardrop Upright",
    size: '42"x288"',
    required: 84,
    installed: 84,
  },
  { id: "2", name: "Stepbeam", size: '144"x6"', required: 512, installed: 306 },
  { id: "3", name: "Stepbeam", size: '96"x4"', required: 128, installed: 0 },
  {
    id: "4",
    name: "Wire Deck",
    size: '42"x46"',
    required: 640,
    installed: 320,
  },
];

const DEMO_COLUMNS: DataGridColumn<DemoRow>[] = [
  {
    key: "name",
    header: "Material",
    alwaysVisible: true,
    sortValue: (r) => r.name,
    cell: (r) => r.name,
    width: 180,
  },
  { key: "size", header: "Size", group: "Catalog", cell: (r) => r.size },
  {
    key: "required",
    header: "Required",
    group: "Quantities",
    numeric: true,
    sortValue: (r) => r.required,
    cell: (r) => r.required.toLocaleString(),
  },
  {
    key: "installed",
    header: "Installed",
    group: "Quantities",
    numeric: true,
    sortValue: (r) => r.installed,
    cell: (r) => r.installed.toLocaleString(),
  },
  {
    key: "progress",
    header: "Progress",
    group: "Quantities",
    width: 140,
    sortValue: (r) => r.installed / r.required,
    cell: (r) => (
      <ProgressBar pct={(r.installed / r.required) * 100} size="sm" showLabel />
    ),
  },
];

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="type-overline mb-2 text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function ComponentGallery() {
  const [qty, setQty] = useState<number | null>(12);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [days, setDays] = useState<string[]>([
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
  ]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-e2">
      <Block title="Buttons — variants, loading, field (44px)">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Danger</Button>
          <Button variant="destructive-solid">Delete forever</Button>
          <Button loading>Saving…</Button>
          <Button size="field">Field action</Button>
        </div>
      </Block>

      <Block title="Status pills & stat tiles">
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusPill tone="neutral">Draft</StatusPill>
          <StatusPill tone="brand" dot>
            Active
          </StatusPill>
          <StatusPill tone="success" dot>
            Complete
          </StatusPill>
          <StatusPill tone="warning" dot>
            Short 12
          </StatusPill>
          <StatusPill tone="danger" dot>
            Blocked
          </StatusPill>
          <StatusPill tone="info">Scheduled</StatusPill>
        </div>
        <div className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Installed today"
            value="264"
            suffix="pcs"
            delta="+18%"
            deltaDirection="up"
          />
          <StatTile
            label="Crew-days left"
            value="42.1"
            spark={[60, 58, 52, 49, 47, 44, 42]}
          />
          <StatTile label="Open punch items" value="7" tone="warning" />
        </div>
      </Block>

      <Block title="Progress">
        <div className="flex max-w-md flex-col gap-3">
          <ProgressBar pct={68} showLabel />
          <ProgressBar pct={100} showLabel />
          <div className="flex items-center gap-4">
            <ProgressRing pct={68} size={56} />
            <ProgressRing pct={100} size={56} />
          </div>
        </div>
      </Block>

      <Block title="Segmented — active is a raised chip, not a yellow slab">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Cards" },
              { value: "list", label: "List" },
            ]}
          />
          <SegmentedMulti
            ariaLabel="Working days"
            values={days}
            onToggle={(day) =>
              setDays((current) =>
                current.includes(day)
                  ? current.filter((d) => d !== day)
                  : [...current, day]
              )
            }
            options={[
              { value: "mon", label: "M" },
              { value: "tue", label: "T" },
              { value: "wed", label: "W" },
              { value: "thu", label: "T" },
              { value: "fri", label: "F" },
              { value: "sat", label: "S" },
              { value: "sun", label: "S" },
            ]}
          />
        </div>
      </Block>

      <Block title="Inputs — stepper, combobox, select, checks">
        <div className="flex max-w-xl flex-wrap items-center gap-4">
          <NumberStepper
            ariaLabel="Quantity"
            value={qty}
            onValueChange={setQty}
          />
          <NumberStepper
            ariaLabel="Quantity (field size)"
            size="field"
            value={qty}
            onValueChange={setQty}
          />
          <Combobox items={MATERIALS}>
            <ComboboxInput placeholder="Search materials…" className="w-56" />
            <ComboboxContent>
              <ComboboxEmpty>No material found.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Select defaultValue="pm">
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="pm">PM</SelectItem>
              <SelectItem value="scheduler">Scheduler</SelectItem>
              <SelectItem value="crew">Crew</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="sg-check" defaultChecked />
            <Label htmlFor="sg-check">Include hardware</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sg-switch" defaultChecked />
            <Label htmlFor="sg-switch">Auto-assign</Label>
          </div>
        </div>
      </Block>

      <Block title="Tabs & breadcrumbs">
        <div className="flex flex-col gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/app">Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Bingo Warehouse</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Tabs defaultValue="overview" className="max-w-md">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="layout">Layout</TabsTrigger>
              <TabsTrigger value="materials">Materials</TabsTrigger>
            </TabsList>
            <TabsContent
              value="overview"
              className="pt-2 text-sm text-text-secondary"
            >
              Tab panels keep focus management + arrow keys from Base UI.
            </TabsContent>
            <TabsContent
              value="layout"
              className="pt-2 text-sm text-text-secondary"
            >
              Layout tab content.
            </TabsContent>
            <TabsContent
              value="materials"
              className="pt-2 text-sm text-text-secondary"
            >
              Materials tab content.
            </TabsContent>
          </Tabs>
        </div>
      </Block>

      <Block title="Overlays — menu, tooltip, confirm, toasts">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline">Row actions</Button>}
            />
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Row 12</DropdownMenuLabel>
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost">Hover me</Button>}
            />
            <TooltipContent>Tooltips are 120ms in, token-timed.</TooltipContent>
          </Tooltip>
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            Confirm dialog
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete Row 12?"
            description="The row, its materials, and install history go with it. This can't be undone."
            confirmLabel="Delete row"
            onConfirm={() => {
              toast.success("Row 12 deleted");
            }}
          />
          <Button
            variant="outline"
            onClick={() => toast.success("Saved 4 rows")}
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error("Couldn't reach Supabase — retrying")}
          >
            Error toast
          </Button>
        </div>
      </Block>

      <Block title="File dropzone">
        <FileDropzone
          label="Drop the packing slip here"
          hint="PDF or photo — 20 MB max"
          accept="image/*,.pdf"
          busy={busy}
          onFiles={(files) => {
            setBusy(true);
            toast.info(`Pretending to upload ${files[0]?.name}…`);
            setTimeout(() => setBusy(false), 900);
          }}
          className="max-w-md"
        />
      </Block>

      <Block title="DataGrid — sticky, sortable, grouped, density">
        <DataGrid<DemoRow>
          columns={DEMO_COLUMNS}
          rows={DEMO_ROWS}
          rowKey={(r) => r.id}
          defaultSort={{ key: "required", direction: "desc" }}
          maxHeightClassName="max-h-80"
        />
      </Block>

      <Block title="Canvas toolbar">
        <Toolbar ariaLabel="Demo canvas controls" className="w-fit">
          <ToolbarButton label="Zoom out">−</ToolbarButton>
          <ToolbarButton label="Zoom to fit">Fit</ToolbarButton>
          <ToolbarButton label="Zoom in">+</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Marquee select" active>
            ▭
          </ToolbarButton>
          <ToolbarButton label="Pan">✋</ToolbarButton>
        </Toolbar>
      </Block>

      <Block title="Cards">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Bingo Warehouse</CardTitle>
            <CardDescription>4,820 of 7,240 pcs installed</CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressBar pct={(4820 / 7240) * 100} showLabel />
          </CardContent>
          <CardFooter className="justify-between">
            <StatusPill tone="brand" dot>
              Active
            </StatusPill>
            <Button variant="outline" size="sm">
              Open
            </Button>
          </CardFooter>
        </Card>
      </Block>

      <Block title="States — empty, error, skeleton">
        <div className="grid gap-3 lg:grid-cols-3">
          <EmptyState
            title="No projects yet"
            description="Create your first project to start tracking installs."
            action={<Button size="sm">New project</Button>}
          />
          <ErrorState
            title="Couldn't load materials"
            description="The request timed out."
            retry={
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.info("Retrying…")}
              >
                Retry
              </Button>
            }
          />
          <TableSkeleton rows={4} />
        </div>
      </Block>
    </div>
  );
}
