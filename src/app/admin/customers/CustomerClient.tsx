"use client"

import { useState } from "react"
import { User } from "@prisma/client"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "@/components/ui/toast"
import { createCustomer, deleteCustomer, updateCustomer, toggleCustomerActive } from "./actions"
import { Plus, ShoppingBag, Users, ArrowUpDown, ArrowUp, ArrowDown, Archive, RotateCcw, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMemo } from "react"
import { HighlightText } from "@/components/ui/highlight"
import { TablePagination } from "@/components/ui/table-pagination"

type CustomerWithCount = User & { _count: { orders: number } }

const columnHelper = createColumnHelper<CustomerWithCount>()

export function CustomerClient({ initialData }: { initialData: CustomerWithCount[] }) {
  const [data, setData] = useState<CustomerWithCount[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithCount | null>(null)
  const [deletingCustomer, setDeletingCustomer] = useState<CustomerWithCount | null>(null)

  const visibleData = useMemo(
    () => data.filter(c => showArchived || c.isActive),
    [data, showArchived]
  )
  const archivedCount = data.filter(c => !c.isActive).length

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
        <span className={cn('font-medium', info.row.original.isActive ? 'text-foreground' : 'text-muted-foreground/70')}>
          {info.getValue() ? <HighlightText text={info.getValue()} query={globalFilter} /> : 'No name'}
          {!info.row.original.isActive && (
            <span className="ml-2 text-[10px] tracking-wide uppercase font-bold text-muted-foreground/50 border border-muted-foreground/20 px-1.5 py-0.5 rounded-sm">
              Archived
            </span>
          )}
        </span>
      ),
    }),
    columnHelper.accessor("email", {
      header: "EMAIL",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => (
        <span className="font-mono-data text-xs text-muted-foreground">
          {info.getValue() ? <HighlightText text={info.getValue()} query={globalFilter} /> : '—'}
        </span>
      ),
    }),
    columnHelper.accessor("phone", {
      header: "PHONE",
      cell: (info) => (
        <span className="font-mono-data text-xs text-muted-foreground">
          {info.getValue() ? <HighlightText text={info.getValue()} query={globalFilter} /> : '—'}
        </span>
      ),
    }),
    columnHelper.accessor("_count.orders", {
      header: "ORDERS",
      meta: { className: "hidden md:table-cell" },
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
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Edit customer"
            onClick={() => setEditingCustomer(info.row.original)}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={async () => {
              const customer = info.row.original
              const nextIsActive = !customer.isActive
              try {
                const result = await toggleCustomerActive(customer.id, nextIsActive)
                if (!result.ok) {
                  toast.add({ title: 'Error', description: result.error, type: 'error' })
                  return
                }
                setData(prev => prev.map(c => c.id === customer.id ? { ...c, isActive: nextIsActive } : c))
                toast.add({
                  title: nextIsActive ? 'Customer restored' : 'Customer archived',
                  description: nextIsActive
                    ? 'This customer is now active again.'
                    : 'This customer has been archived and hidden from default views.',
                  type: 'success'
                })
              } catch (err) {
                toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not toggle archive state.', type: 'error' })
              }
            }}
            title={info.row.original.isActive ? "Archive customer" : "Restore customer"}
          >
            {info.row.original.isActive ? (
              <Archive className="h-4 w-4" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{info.row.original.isActive ? "Archive" : "Restore"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete customer"
            onClick={() => setDeletingCustomer(info.row.original)}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      ),
    })
  ]

  const table = useReactTable({
    data: visibleData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  async function handleAdd(formData: FormData) {
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string
    try {
      const result = await createCustomer({ name, email, phone })
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setData([{ ...result.data, _count: { orders: 0 } }, ...data])
      setIsOpen(false)
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not create this customer.', type: 'error' })
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
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setData(prev => prev.map(c => c.id === result.data.id ? { ...c, ...result.data } : c))
      setEditingCustomer(null)
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this customer.', type: 'error' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <p className="meta-text text-sm">
          {data.length} customer{data.length !== 1 ? 's' : ''} registered
        </p>
        <div className="flex flex-1 sm:flex-none items-center gap-4">
          <Input
            placeholder="Search customers..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(String(e.target.value))}
            className="w-full sm:w-64 bg-card"
          />
          {(archivedCount > 0 || showArchived) && (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived(s => !s)}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {showArchived ? 'Hide Archived' : `Show Archived (${archivedCount})`}
            </Button>
          )}
          {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
          <Button onClick={() => setIsOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add Customer
          </Button>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="e.g. Adaeze Okonkwo" />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" name="phone" placeholder="Optional" />
              </div>
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
              <Input id="edit-name" name="name" required defaultValue={editingCustomer?.name || ""} />
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
                <th 
                  key={header.id} 
                  className={cn(
                    "table-head-cell", 
                    header.column.getCanSort() && "cursor-pointer select-none hover:text-foreground", 
                    header.column.getIsSorted() && "text-primary hover:text-primary/80",
                    header.column.columnDef.meta?.className
                  )}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div className="flex items-center gap-2">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      header.column.getIsSorted() === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : header.column.getIsSorted() === 'desc' ? (
                        <ArrowDown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
                      )
                    )}
                  </div>
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, idx) => (
                <tr key={row.id} className={cn('table-row', idx % 2 === 0 && 'bg-card/40', !row.original.isActive && 'opacity-60')}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={cn("px-4 py-3", cell.column.columnDef.meta?.className)}>
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
      <TablePagination table={table} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingCustomer} onOpenChange={(open) => !open && setDeletingCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete customer #{deletingCustomer?.shortId} ({deletingCustomer?.name || 'No name'}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deletingCustomer) return
                try {
                  const result = await deleteCustomer(deletingCustomer.id)
                  if (!result.ok) {
                    toast.add({ title: 'Error', description: result.error, type: 'error' })
                    return
                  }
                  if (result.data?.archived) {
                    setData(prev => prev.map(c => c.id === deletingCustomer.id ? { ...c, isActive: false } : c))
                    toast.add({ title: 'Archived', description: 'This customer has past orders, so their record was archived instead of deleted.', type: 'info' })
                  } else {
                    setData(prev => prev.filter(i => i.id !== deletingCustomer.id))
                  }
                  setDeletingCustomer(null)
                } catch (err) {
                  toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete this customer.', type: 'error' })
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
