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
import { createProject } from "@/lib/projects/actions";

export function NewProjectDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>+ New project</DialogTrigger>
      <DialogContent>
        <form action={createProject} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Project name</Label>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              placeholder="Acme Distribution — Bldg 3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="site_address">Site address</Label>
            <Input
              id="site_address"
              name="site_address"
              placeholder="123 Warehouse Rd, Springfield"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="deadline">Deadline</Label>
            <Input id="deadline" name="deadline" type="date" />
          </div>

          <DialogFooter>
            <Button type="submit" size="lg">
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
