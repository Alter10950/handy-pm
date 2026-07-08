"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCrewMember,
  createCrew,
  deleteCrew,
  removeCrewMember,
  updateCrew,
} from "@/lib/crews/actions";
import type { Tables } from "@/lib/supabase/database.types";

function CrewCard({
  crew,
  members,
}: {
  crew: Tables<"crews">;
  members: Tables<"crew_members">[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(crew.name);
  const [size, setSize] = useState(String(crew.size));
  const [costPerHour, setCostPerHour] = useState(
    crew.cost_per_hour !== null ? String(crew.cost_per_hour) : ""
  );
  const [newMemberName, setNewMemberName] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSave() {
    setPending(true);
    try {
      await updateCrew(
        crew.id,
        name.trim(),
        Number(size) || 1,
        costPerHour.trim() ? Number(costPerHour) : null
      );
      setEditing(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete crew "${crew.name}"? This cannot be undone.`)) return;
    setPending(true);
    try {
      await deleteCrew(crew.id);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleAddMember() {
    if (!newMemberName.trim()) return;
    setPending(true);
    try {
      await addCrewMember(crew.id, newMemberName.trim());
      setNewMemberName("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setPending(true);
    try {
      await removeCrewMember(memberId);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-3">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            value={size}
            onChange={(event) => setSize(event.target.value)}
            placeholder="Crew size"
          />
          <Input
            type="number"
            min={0}
            step="0.01"
            value={costPerHour}
            onChange={(event) => setCostPerHour(event.target.value)}
            placeholder="Cost / hour"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || pending}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-medium text-foreground">{crew.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            {crew.size} {crew.size === 1 ? "person" : "people"}
            {crew.cost_per_hour ? ` · $${crew.cost_per_hour}/hr` : ""}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={pending}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {members.map((member) => (
          <span
            key={member.id}
            className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs text-foreground"
          >
            {member.name}
            <button
              type="button"
              disabled={pending}
              onClick={() => void handleRemoveMember(member.id)}
              aria-label={`Remove ${member.name}`}
              className="text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Add crew member"
          value={newMemberName}
          onChange={(event) => setNewMemberName(event.target.value)}
          className="h-8 text-sm"
        />
        <Button
          type="button"
          size="sm"
          disabled={!newMemberName.trim() || pending}
          onClick={() => void handleAddMember()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function CrewManager({
  crews,
  members,
}: {
  crews: Tables<"crews">[];
  members: Tables<"crew_members">[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState("2");
  const [costPerHour, setCostPerHour] = useState("");
  const [pending, setPending] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setPending(true);
    try {
      await createCrew(
        name.trim(),
        Number(size) || 1,
        costPerHour.trim() ? Number(costPerHour) : null
      );
      setName("");
      setSize("2");
      setCostPerHour("");
      setCreating(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const membersByCrew = new Map<string, Tables<"crew_members">[]>();
  for (const member of members) {
    const list = membersByCrew.get(member.crew_id) ?? [];
    list.push(member);
    membersByCrew.set(member.crew_id, list);
  }

  return (
    <div className="flex flex-col gap-2">
      {crews.map((crew) => (
        <CrewCard
          key={crew.id}
          crew={crew}
          members={membersByCrew.get(crew.id) ?? []}
        />
      ))}

      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-card p-3">
          <Input
            autoFocus
            placeholder="Crew name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="Crew size"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={costPerHour}
              onChange={(event) => setCostPerHour(event.target.value)}
              placeholder="Cost / hour (optional)"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!name.trim() || pending}
              onClick={() => void handleCreate()}
            >
              Create crew
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setCreating(true)}
        >
          + New crew
        </Button>
      )}
    </div>
  );
}
