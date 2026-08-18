"use client"

import { useState } from "react"
import { User } from "@prisma/client"
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

type CustomerWithCount = User & { _count: { orders: number } }

const columnHelper = createColumnHelper<CustomerWithCount>()

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
    try {
      const result = await createCustomer({ name, email, phone })
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
    try {
      const result = await updateCustomer(editingCustomer.id, { name, email, phone })
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
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" name="phone" placeholder="Optional" />
              </div>
              <p className="text-xs text-muted-foreground">
                At least one contact method is required.
              </p>
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
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" name="name" defaultValue={editingCustomer?.name || ""} />
            </div>
            <div>
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" name="email" type="email" defaultValue={editingCustomer?.email || ""} />
            </div>
            <div>
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input id="edit-phone" name="phone" defaultValue={editingCustomer?.phone || ""} />
            </div>
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
