"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "@/components/ui/dialog";

interface AddSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddSectionDialog({
  open,
  onOpenChange,
}: AddSectionDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const createSection = useMutation(api.sections.create);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createSection({ name: trimmed });
      setName("");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add Section</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Input
            placeholder="Section name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            loading={saving}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
