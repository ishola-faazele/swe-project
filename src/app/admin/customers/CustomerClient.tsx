"use client"

import { useState } from "react"
import { User } from "@prisma/client"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
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

type CustomerWithCount = User & { _count: { orders: number } }

const columnHelper = createColumnHelper<CustomerWithCount>()

export function CustomerClient({ initialData }: { initialData: CustomerWithCount[] }) {
  const [data, setData] = useState<CustomerWithCount[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithCount | null>(null)

  const columns = [
    columnHelper.accessor("shortId", {
      header: "ID",
      cell: (info) => `#${info.getValue()}`,
    }),
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("phone", {
      header: "Phone",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("_count.orders", {
      header: "Total Orders",
      cell: (info) => info.getValue(),
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
              if(confirm("Are you sure you want to delete this customer?")) {
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger render={<Button />}>
            Add Customer
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
              <p className="text-sm text-muted-foreground">Note: At least one contact method must be provided.</p>
              <Button type="submit" className="w-full">Save Customer</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <form action={handleEdit} className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" name="name" defaultValue={editingCustomer?.name || ""} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" name="email" type="email" defaultValue={editingCustomer?.email || ""} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input id="edit-phone" name="phone" defaultValue={editingCustomer?.phone || ""} placeholder="Optional" />
            </div>
            <Button type="submit" className="w-full">Update Customer</Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No customers found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
