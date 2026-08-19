"use client"

import { useState } from "react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createCustomer, deleteCustomer, updateCustomer } from "./actions"
import { Plus, ShoppingBag, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClientSafeUser } from "@/lib/user"
import type { LoginMethod } from "@prisma/client"

type CustomerWithCount = ClientSafeUser & { _count: { orders: number } }

const columnHelper = createColumnHelper<CustomerWithCount>()

/**
 * The contact fields plus the preferred-login-method select, shared by the Add and Edit dialogs.
 *
 * Email and phone are controlled here specifically so the select can react to what is actually
 * filled in as it is typed — the rest of the form stays uncontrolled, as it was. Controlled inputs
 * still carry their `name`, so FormData picks them up exactly like before.
 *
 * The available options are derived on every render rather than synced through an effect: if the
 * current choice stops being valid (the admin clears the email it pointed at), it falls back to
 * whatever is still filled in. That keeps this form from ever submitting a combination the
 * server-side refinement in validation.ts would reject.
 */
function CustomerFormFields({
  customer,
  idPrefix,
}: {
  customer?: CustomerWithCount | null
  idPrefix: string
}) {
  const [email, setEmail] = useState(customer?.email ?? "")
  const [phone, setPhone] = useState(customer?.phone ?? "")
  const [method, setMethod] = useState<string>(customer?.preferredLoginMethod ?? "")

  const options: LoginMethod[] = [
    ...(email.trim() ? (["EMAIL"] as const) : []),
    ...(phone.trim() ? (["PHONE"] as const) : []),
  ]
  // Never offer — or submit — a choice the current form state can't support.
  const effectiveMethod = options.includes(method as LoginMethod) ? method : (options[0] ?? "")

  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={customer?.name ?? ""}
          placeholder="Optional"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`}>Phone Number</Label>
        <Input
          id={`${idPrefix}-phone`}
          name="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-preferredLoginMethod`}>Preferred login method</Label>
        <select
          id={`${idPrefix}-preferredLoginMethod`}
          name="preferredLoginMethod"
          className="select-field"
          value={effectiveMethod}
          disabled={options.length === 0}
          onChange={(e) => setMethod(e.target.value)}
        >
          {options.length === 0 && <option value="">Add an email or phone first</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option === "EMAIL" ? "Email (magic link)" : "Phone (SMS code)"}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          How this customer is told to sign in when their account is created.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        At least one contact method is required.
      </p>
    </>
  )
}

export function CustomerClient({ initialData }: { initialData: CustomerWithCount[] }) {
  const [data, setData] = useState<CustomerWithCount[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithCount | null>(null)

  const columns = [
    columnHelper.accessor("shortId", {
      header: "ID",
      cell: (info) => (
        <span className="font-mono-data tabular-nums font-bold text-primary">
          #{info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("name", {
      header: "NAME",
      cell: (info) => (
        <span className={cn('font-medium', info.getValue() ? 'text-foreground' : 'text-muted-foreground/70')}>
          {info.getValue() || 'No name'}
        </span>
      ),
    }),
    columnHelper.accessor("email", {
      header: "EMAIL",
      cell: (info) => (
        <span className="font-mono-data text-xs text-muted-foreground">
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.accessor("phone", {
      header: "PHONE",
      cell: (info) => (
        <span className="font-mono-data text-xs text-muted-foreground">
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.accessor("_count.orders", {
      header: "ORDERS",
      cell: (info) => (
        <div className="flex items-center gap-1.5">
          <ShoppingBag className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono-data tabular-nums font-medium text-primary">
            {info.getValue()}
          </span>
        </div>
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingCustomer(info.row.original)}
          >
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm(`Delete customer #${info.row.original.shortId}?`)) return
              try {
                const result = await deleteCustomer(info.row.original.id)
                if (!result.ok) {
                  // The row must stay visible here: a customer with orders on file is refused
                  // server-side, and filtering it out anyway would imply a delete that never
                  // happened.
                  alert(result.error)
                  return
                }
                setData(prev => prev.filter(i => i.id !== info.row.original.id))
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Could not delete this customer.')
              }
            }}
          >
            Delete
          </Button>
        </div>
      ),
    })
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  async function handleAdd(formData: FormData) {
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string
    // "" means the select had nothing to offer (a name-only customer) — send undefined so the
    // action computes an explicit value rather than failing the enum check on an empty string.
    const rawMethod = formData.get("preferredLoginMethod") as string
    const preferredLoginMethod = rawMethod ? (rawMethod as LoginMethod) : undefined
    try {
      const result = await createCustomer({ name, email, phone, preferredLoginMethod })
      if (!result.ok) {
        alert(result.error)
        return
      }
      setData([{ ...result.data, _count: { orders: 0 } }, ...data])
      setIsOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create this customer.')
    }
  }

  async function handleEdit(formData: FormData) {
    if (!editingCustomer) return
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string
    const rawMethod = formData.get("preferredLoginMethod") as string
    const preferredLoginMethod = rawMethod ? (rawMethod as LoginMethod) : undefined
    try {
      const result = await updateCustomer(editingCustomer.id, { name, email, phone, preferredLoginMethod })
      if (!result.ok) {
        alert(result.error)
        return
      }
      setData(prev => prev.map(c => c.id === result.data.id ? { ...c, ...result.data } : c))
      setEditingCustomer(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update this customer.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="meta-text text-sm">
          {data.length} customer{data.length !== 1 ? 's' : ''} registered
        </p>
        {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
        <Button onClick={() => setIsOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add Customer
        </Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-4">
              {/* key resets the controlled contact/method state each time the dialog reopens, so a
                  previous entry never bleeds into a fresh one. */}
              <CustomerFormFields key={isOpen ? "add-open" : "add-closed"} idPrefix="add" />
              <Button type="submit" className="w-full">Save Customer</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer #{editingCustomer?.shortId}</DialogTitle>
          </DialogHeader>
          <form action={handleEdit} className="space-y-4">
            {/* Keyed on the customer id: this one dialog is reused for every row, so without a
                remount the previous customer's contact values would persist into the next edit. */}
            <CustomerFormFields
              key={editingCustomer?.id ?? "none"}
              customer={editingCustomer}
              idPrefix="edit"
            />
            <Button type="submit" className="w-full">Update Customer</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-popover">
              {table.getHeaderGroups().map(hg => hg.headers.map(header => (
                <th key={header.id} className="table-head-cell">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, idx) => (
                <tr key={row.id} className={cn('table-row', idx % 2 === 0 && 'bg-card/40')}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="empty-state-title">No customers yet</p>
                    <p className="empty-state-hint">
                      Add a customer to start booking orders against their record.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
