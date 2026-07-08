"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEstimateProject } from "@/lib/estimating/actions";

export function NewEstimateDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        + New estimate
      </DialogTrigger>
      <DialogContent>
        <form action={createEstimateProject} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New estimate</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Paste a future job&apos;s material list to see estimated days and a
            daily plan before there&apos;s a signed customer or a drawing to
            mark. Convert it to a real project later with one click.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Job name</Label>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              placeholder="Acme Distribution — Bldg 3 (estimate)"
            />
          </div>

          <DialogFooter>
            <Button type="submit" size="lg">
              Create estimate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
