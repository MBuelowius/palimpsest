import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { harnesses } from "../shared/harnesses";
import { api } from "./api";

export function AccountDialog({
  onAdded,
}: {
  onAdded: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<string>(harnesses[0].id);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add() {
    setBusy(true);
    setError("");
    try {
      await api.addAccount(tool, name.trim(), folder.trim());
      setOpen(false);
      setName("");
      setFolder("");
      await onAdded(`Account ${name.trim()} added.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="account-add" variant="outline" size="sm">
          <Plus size={14} />
          Add account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an account</DialogTitle>
          <DialogDescription>
            Use a second login of the same app, such as a work account that
            keeps its settings in its own folder. Skills you add to it go in
            that folder’s skills directory.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label className="field-label" htmlFor="account-app">
            App
          </label>
          <select
            id="account-app"
            className="account-select"
            value={tool}
            disabled={busy}
            onChange={(event) => setTool(event.target.value)}
          >
            {harnesses.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.label}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="account-name">
            Name
          </label>
          <Input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="work"
            maxLength={32}
            required
            disabled={busy}
          />
          <label className="field-label" htmlFor="account-folder">
            Config folder
          </label>
          <Input
            id="account-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="~/.claude-work"
            required
            disabled={busy}
          />
          <p className="field-hint">
            The folder must already exist inside your home folder.
            {folder.trim() && (
              <>
                {" "}
                Skills will be added to{" "}
                <code>{folder.trim().replace(/\/$/, "")}/skills</code>.
              </>
            )}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={busy || !name.trim() || !folder.trim()}
            >
              {busy && <Loader2 className="spin" size={15} />}
              Add account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
