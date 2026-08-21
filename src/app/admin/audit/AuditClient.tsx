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
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { 
  ArrowUpDown, ShieldAlert, Shield, User, Clock,
  PlusCircle, UserPlus, UserMinus, XCircle, Trash2, ArrowRightCircle, Package, Info
} from "lucide-react"
import { HighlightText } from "@/components/ui/highlight"
import { TablePagination } from "@/components/ui/table-pagination"
import { cn } from "@/lib/utils"
import { BUSINESS_LOCALE } from "@/lib/currency"

type AuditLogWithUser = {
  id: string
  action: string
  details: string | null
  createdAt: Date
  user: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    role: string
    shortId: number
  }
}

function getActionStyle(action: string) {
  if (action.includes('DELETED')) return { icon: Trash2, color: 'text-destructive', bg: 'bg-destructive/10' }
  if (action.includes('CANCELLED')) return { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' }
  if (action === 'USER_CREATED') return { icon: UserPlus, color: 'text-emerald-500', bg: 'bg-emerald-500/10' }
  if (action === 'ORDER_CREATED') return { icon: PlusCircle, color: 'text-emerald-500', bg: 'bg-emerald-500/10' }
  if (action === 'ORDER_STATUS_UPDATED') return { icon: ArrowRightCircle, color: 'text-blue-500', bg: 'bg-blue-500/10' }
  if (action === 'STOCK_ADJUSTED') return { icon: Package, color: 'text-amber-500', bg: 'bg-amber-500/10' }
  
  return { icon: Info, color: 'text-muted-foreground', bg: 'bg-muted' }
}

const columnHelper = createColumnHelper<AuditLogWithUser>()
export function AuditClient({ initialData }: { initialData: AuditLogWithUser[] }) {
  const [data] = useState<AuditLogWithUser[]>(initialData)
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }])
  const [globalFilter, setGlobalFilter] = useState("")

  const columns = useMemo(
    () => [
      columnHelper.accessor("createdAt", {
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 w-full justify-start px-2 -ml-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Timestamp
            <ArrowUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
          </Button>
        ),
        cell: (info) => {
          const date = new Date(info.getValue())
          return (
            <div className="flex items-center gap-2 px-2 text-sm text-foreground/80 font-mono-data">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {date.toLocaleString(BUSINESS_LOCALE, {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', second: '2-digit'
              })}
            </div>
          )
        }
      }),
      columnHelper.accessor((row) => row.user.name || row.user.email || row.user.phone || "Unknown User", {
        id: "user",
        header: () => (
          <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            User
          </div>
        ),
        cell: (info) => {
          const role = info.row.original.user.role
          const isAdmin = role === 'ADMIN'
          return (
            <div className="flex items-center gap-3 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                {isAdmin ? <ShieldAlert className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-sm text-foreground">
                  <HighlightText text={info.getValue()} query={globalFilter} />
                </span>
                <span className="text-xs text-muted-foreground uppercase font-semibold">
                  {role}
                </span>
              </div>
            </div>
          )
        },
      }),
      columnHelper.accessor("action", {
        header: () => (
          <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Action
          </div>
        ),
        cell: (info) => {
          const { icon: Icon, color, bg } = getActionStyle(info.getValue())
          return (
            <div className="flex items-center gap-2 px-2">
              <div className={cn("flex h-6 w-6 items-center justify-center rounded-md shrink-0", bg, color)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-bold text-foreground">
                <HighlightText text={info.getValue().replace(/_/g, ' ')} query={globalFilter} />
              </span>
            </div>
          )
        },
      }),
      columnHelper.accessor("details", {
        header: () => (
          <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </div>
        ),
        cell: (info) => (
          <div className="px-2 text-sm text-muted-foreground">
            {info.getValue() ? <HighlightText text={info.getValue()!} query={globalFilter} /> : "—"}
          </div>
        ),
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search logs..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
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
                      <Clock className="h-8 w-8 mb-2 opacity-50" />
                      <p>No audit logs found.</p>
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
    </div>
  )
}
