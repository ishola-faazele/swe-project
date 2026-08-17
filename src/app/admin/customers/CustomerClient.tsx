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
  DialogTrigger,
} from "@/components/ui/dialog"
import { createCustomer, deleteCustomer, updateCustomer } from "./actions"
import { Plus, ShoppingBag } from "lucide-react"

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
        <span className="font-mono-data font-bold" style={{ color: 'oklch(0.72 0.15 65)' }}>
          #{info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("name", {
      header: "NAME",
      cell: (info) => (
        <span className="font-medium" style={{ color: info.getValue() ? 'oklch(0.85 0.008 65)' : 'oklch(0.38 0.006 65)' }}>
          {info.getValue() || 'No name'}
        </span>
      ),
    }),
    columnHelper.accessor("email", {
      header: "EMAIL",
      cell: (info) => (
        <span className="font-mono-data text-xs" style={{ color: 'oklch(0.55 0.008 65)' }}>
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.accessor("phone", {
      header: "PHONE",
      cell: (info) => (
        <span className="font-mono-data text-xs" style={{ color: 'oklch(0.55 0.008 65)' }}>
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.accessor("_count.orders", {
      header: "ORDERS",
      cell: (info) => (
        <div className="flex items-center gap-1.5">
          <ShoppingBag className="h-3 w-3" style={{ color: 'oklch(0.45 0.008 65)' }} />
          <span className="font-mono-data font-medium" style={{ color: 'oklch(0.72 0.15 65)' }}>
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
              if (confirm(`Delete customer #${info.row.original.shortId}?`)) {
                await deleteCustomer(info.row.original.id)
                setData(prev => prev.filter(i => i.id !== info.row.original.id))
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
    const newItem = await createCustomer({ name, email, phone })
    setData([{ ...newItem, _count: { orders: 0 } }, ...data])
    setIsOpen(false)
  }

  async function handleEdit(formData: FormData) {
    if (!editingCustomer) return
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string
    const updatedItem = await updateCustomer(editingCustomer.id, { name, email, phone })
    setData(prev => prev.map(c => c.id === updatedItem.id ? { ...c, ...updatedItem } : c))
    setEditingCustomer(null)
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
          {data.length} customer{data.length !== 1 ? 's' : ''} registered
        </p>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Customer
          </DialogTrigger>
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
              <p className="text-xs" style={{ color: 'oklch(0.45 0.008 65)' }}>
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
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid oklch(0.20 0.008 65)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'oklch(0.13 0.005 65)', borderBottom: '1px solid oklch(0.20 0.008 65)' }}>
              {table.getHeaderGroups().map(hg => hg.headers.map(header => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.10em' }}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  style={{
                    background: idx % 2 === 0 ? 'oklch(0.10 0.004 65)' : 'transparent',
                    borderBottom: '1px solid oklch(0.16 0.005 65)',
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'oklch(0.40 0.008 65)' }}
                >
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
