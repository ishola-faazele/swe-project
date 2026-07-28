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
import { createCustomer, deleteCustomer } from "./actions"

type CustomerWithCount = User & { _count: { orders: number } }

const columnHelper = createColumnHelper<CustomerWithCount>()

export function CustomerClient({ initialData }: { initialData: CustomerWithCount[] }) {
  const [data, setData] = useState<CustomerWithCount[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)

  const columns = [
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
        <Button 
          variant="destructive" 
          size="sm"
          onClick={async () => {
            await deleteCustomer(info.row.original.id)
            setData(data.filter(i => i.id !== info.row.original.id))
          }}
        >
          Delete
        </Button>
      ),
    })
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  async function handleAdd(formData: FormData) {
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string

    const newItem = await createCustomer({ email, phone })
    // Ensure we append with _count initialized to 0
    setData([...data, { ...newItem, _count: { orders: 0 } }])
    setIsOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>Add Customer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-4">
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
