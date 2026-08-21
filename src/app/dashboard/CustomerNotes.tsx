"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { updateCustomerNotes } from "./actions"
import { NotebookPen } from "lucide-react"

export function CustomerNotes({ initialNotes }: { initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes || "")
  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  async function handleSave() {
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateCustomerNotes(notes)
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      setNotes(result.data.notes || "")
      setStatus({ kind: "ok", text: "Notes saved." })
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save your notes.",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section className="mt-12">
      <div className="border-b pb-4 mb-6">
        <h2 className="text-xl font-semibold">Customer Notes</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add any dietary preferences, delivery instructions, or general notes you&apos;d like us to know for all your orders.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded-md">
              <NotebookPen className="h-4 w-4 text-primary" />
            </div>
            Preferences & Instructions
          </h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">
            These notes are visible to the kitchen and delivery team.
          </p>
        </div>
        
        <div className="md:col-span-2 space-y-4 max-w-md">
          <div className={isPending ? "opacity-50 pointer-events-none" : ""}>
            <RichTextEditor
              content={notes}
              onChange={setNotes}
              placeholder="e.g. Allergic to nuts, call when outside the gate..."
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={handleSave} disabled={isPending || notes === (initialNotes || "")}>
              {isPending ? "Saving…" : "Save notes"}
            </Button>
          </div>
          
          <div role="status" aria-live="polite">
            {status && (
              <div
                className={
                  status.kind === "ok"
                    ? "rounded-lg border border-chart-3/30 bg-chart-3/12 px-4 py-3 font-mono-data text-sm text-chart-3"
                    : "rounded-lg border border-destructive/30 bg-destructive/12 px-4 py-3 font-mono-data text-sm text-destructive"
                }
              >
                {status.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
