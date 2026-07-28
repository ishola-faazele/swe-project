"use client"

import { useState } from "react"
import { InventoryItem, Category } from "@prisma/client"
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
import { createInventoryItem, deleteInventoryItem } from "./actions"

const columnHelper = createColumnHelper<InventoryItem>()

export function InventoryClient({ initialData }: { initialData: InventoryItem[] }) {
  const [data, setData] = useState<InventoryItem[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)

  const columns = [
    columnHelper.accessor("name", {
      header: "Item Name",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("category", {
      header: "Category",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("currentStock", {
      header: "Stock",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("unit", {
      header: "Unit",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("minimumThreshold", {
      header: "Low Stock Alert",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <Button 
          variant="destructive" 
          size="sm"
          onClick={async () => {
            await deleteInventoryItem(info.row.original.id)
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
    const name = formData.get("name") as string
    const category = formData.get("category") as Category
    const currentStock = Number(formData.get("currentStock"))
    const unit = formData.get("unit") as string
    const thresholdStr = formData.get("minimumThreshold") as string
    const minimumThreshold = thresholdStr ? Number(thresholdStr) : null

    const newItem = await createInventoryItem({ name, currentStock, unit, minimumThreshold, category })
    setData([...data, newItem])
    setIsOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>Add Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Inventory Item</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-4">
              <div>
                <Label htmlFor="name">Item Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <select id="category" name="category" className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50" required>
                  <option value="INGREDIENT">Ingredient</option>
                  <option value="DRINK">Drink</option>
                  <option value="PACKAGING">Packaging</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <Label htmlFor="currentStock">Current Stock</Label>
                <Input id="currentStock" name="currentStock" type="number" step="any" required />
              </div>
              <div>
                <Label htmlFor="unit">Unit (e.g., kg, pieces, packs)</Label>
                <Input id="unit" name="unit" required />
              </div>
              <div>
                <Label htmlFor="minimumThreshold">Low Stock Alert Threshold (Optional)</Label>
                <Input id="minimumThreshold" name="minimumThreshold" type="number" step="any" />
              </div>
              <Button type="submit" className="w-full">Save Item</Button>
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
                  No items in inventory.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
