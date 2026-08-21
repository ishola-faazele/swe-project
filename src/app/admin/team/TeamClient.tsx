"use client"

import { useState, useMemo } from "react"
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
import { addStaff, demoteToCustomer } from "./actions"
import { Plus, User, ArrowUpDown, Shield, UserCog, UserMinus, ShieldAlert } from "lucide-react"
import { HighlightText } from "@/components/ui/highlight"
import { TablePagination } from "@/components/ui/table-pagination"
import type { User as PrismaUser } from "@prisma/client"
import { cn } from "@/lib/utils"

type TeamUser = Omit<PrismaUser, 'authEmail'>

const columnHelper = createColumnHelper<TeamUser>()

export function TeamClient({ initialData }: { initialData: TeamUser[] }) {
  const [data, setData] = useState<TeamUser[]>(initialData)
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }])
  const [globalFilter, setGlobalFilter] = useState("")

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [demoteUser, setDemoteUser] = useState<TeamUser | null>(null)
  const [pendingPromotion, setPendingPromotion] = useState<{ name: string; email: string; phone: string } | null>(null)

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.name || "—", {
        id: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 w-full justify-start px-2 -ml-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Name
            <ArrowUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
          </Button>
        ),
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <HighlightText text={info.getValue()} query={globalFilter} className="font-medium text-foreground" />
          </div>
        ),
      }),
      columnHelper.accessor("email", {
        header: () => (
          <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Email
          </div>
        ),
        cell: (info) => (
          <div className="px-2 font-mono-data text-sm">
            {info.getValue() ? <HighlightText text={info.getValue()!} query={globalFilter} /> : "—"}
          </div>
        ),
      }),
      columnHelper.accessor("phone", {
        header: () => (
          <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Phone
          </div>
        ),
        cell: (info) => (
          <div className="px-2 font-mono-data text-sm">
            {info.getValue() ? <HighlightText text={info.getValue()!} query={globalFilter} /> : "—"}
          </div>
        ),
      }),
      columnHelper.accessor("role", {
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 w-full justify-start px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Role
            <ArrowUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
          </Button>
        ),
        cell: (info) => {
          const role = info.getValue()
          const isAdmin = role === 'ADMIN'
          return (
            <div className="px-2 flex items-center gap-1.5">
              {isAdmin ? (
                <ShieldAlert className="h-4 w-4 text-amber-500" />
              ) : (
                <Shield className="h-4 w-4 text-emerald-500" />
              )}
              <span className={cn(
                "text-xs font-bold tracking-wide uppercase px-2 py-0.5 rounded-full",
                isAdmin ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
              )}>
                {role}
              </span>
            </div>
          )
        },
      }),
      columnHelper.display({
        id: "actions",
        header: () => (
          <div className="px-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Actions
          </div>
        ),
        cell: (info) => {
          const user = info.row.original
          if (user.role === 'ADMIN') return <div className="px-2 text-right text-muted-foreground text-xs">—</div>
          return (
            <div className="flex justify-end gap-1 px-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDemoteUser(user)}
                title="Demote to Customer"
              >
                <UserMinus className="h-4 w-4" />
                <span className="sr-only">Demote</span>
              </Button>
            </div>
          )
        },
      }),
    ],
    [globalFilter]
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  async function handleAddStaff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string

    try {
      const result = await addStaff({ name, email, phone })
      if (result.ok) {
        toast.add({ title: "Staff Added", description: "The staff member has been added successfully.", type: "success" })
        setIsAddOpen(false)
        window.location.reload()
      } else {
        if (result.error === 'CUSTOMER_EXISTS') {
          setPendingPromotion({ name, email, phone })
        } else {
          toast.add({ title: "Error", description: result.error, type: "error" })
        }
      }
    } catch {
      toast.add({ title: "Error", description: "A network error occurred.", type: "error" })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDemote() {
    if (!demoteUser) return
    try {
      const result = await demoteToCustomer(demoteUser.id)
      if (result.ok) {
        toast.add({ title: "Staff Demoted", description: "User has been demoted to CUSTOMER.", type: "success" })
        setDemoteUser(null)
        window.location.reload()
      } else {
        toast.add({ title: "Error", description: result.error, type: "error" })
      }
    } catch {
      toast.add({ title: "Error", description: "A network error occurred.", type: "error" })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search team..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={() => setIsAddOpen(true)} className="gap-2">
          <UserCog className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="h-10 text-left align-middle font-medium text-muted-foreground whitespace-nowrap first:pl-4 last:pr-4">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <UserCog className="h-8 w-8 mb-2 opacity-50" />
                      <p>No team members found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="group border-b border-border/50 hover:bg-muted/20 transition-colors last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="py-3 align-middle first:pl-4 last:pr-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {table.getPageCount() > 1 && (
          <div className="border-t border-border p-4 bg-muted/10">
            <TablePagination table={table} />
          </div>
        )}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddStaff} className="space-y-4 pt-4">
            <div>
              <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                name="name"
                required
                placeholder="e.g. Jane Doe"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="e.g. jane@example.com"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="e.g. +234..."
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Adding..." : "Add Staff"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!demoteUser} onOpenChange={(open) => !open && setDemoteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demote {demoteUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will instantly revoke their STAFF privileges. They will only have access to the customer dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDemote}
            >
              Demote to Customer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingPromotion} onOpenChange={(open) => !open && setPendingPromotion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Customer Account Found</AlertDialogTitle>
            <AlertDialogDescription>
              A customer account with this email or phone number already exists. Are you sure you want to promote them to STAFF?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingPromotion) return
                setIsSubmitting(true)
                try {
                  const result = await addStaff(pendingPromotion, true)
                  if (result.ok) {
                    toast.add({ title: "Staff Promoted", description: "Customer has been promoted to STAFF.", type: "success" })
                    setPendingPromotion(null)
                    setIsAddOpen(false)
                    window.location.reload()
                  } else {
                    toast.add({ title: "Error", description: result.error, type: "error" })
                  }
                } catch {
                  toast.add({ title: "Error", description: "A network error occurred.", type: "error" })
                } finally {
                  setIsSubmitting(false)
                }
              }}
            >
              Confirm Promotion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
