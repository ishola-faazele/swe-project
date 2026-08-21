"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { InventoryItem } from "@prisma/client"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { formatCurrency, getCurrencySymbol } from "@/lib/currency"
import { createDish, deleteDish, toggleDishActive } from "./actions"
import {
  RecipeBuilder,
  buildIngredients,
  recipePayload,
  type DishWithMedia,
  type RecipeRow,
} from "./RecipeBuilder"
import { Plus, UtensilsCrossed, Pencil, Archive, RotateCcw, Trash2, Film } from "lucide-react"
import { cn } from "@/lib/utils"
import { HighlightText } from "@/components/ui/highlight"
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

// Badge styling lives in globals.css (.dish-active/.dish-archived).

const PAGE_SIZE = 12

/**
 * The card's cover is the lowest-position IMAGE, deliberately NOT simply media[0].
 *
 * "Cover" for ordering purposes on the detail page is type-agnostic, but a compact grid thumbnail
 * is not: a video has no poster frame here, and generating one would need either server-side video
 * processing (a PRD non-goal) or loading the whole video client-side just to grab a frame. A dish
 * whose only media is video therefore shows the same placeholder as one with no media at all,
 * plus a film badge so the admin still knows video exists.
 */
function coverImageUrl(dish: DishWithMedia): string | null {
  return dish.media.find(m => m.type === 'IMAGE')?.url ?? null
}

function hasVideo(dish: DishWithMedia): boolean {
  return dish.media.some(m => m.type === 'VIDEO')
}

export function MenuClient({
  initialData,
  inventory
}: {
  initialData: DishWithMedia[],
  inventory: InventoryItem[]
}) {
  const [data, setData] = useState<DishWithMedia[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [deletingDish, setDeletingDish] = useState<DishWithMedia | null>(null)
  const [newRecipe, setNewRecipe] = useState<RecipeRow[]>([])
  const [page, setPage] = useState(0)
  const [counter, setCounter] = useState(0)

  function addRow(rows: RecipeRow[], setRows: (rows: RecipeRow[]) => void) {
    setRows([...rows, { inventoryItemId: '', quantityPerDish: 0, internalId: counter }])
    setCounter(c => c + 1)
  }

  // Memoized because a fresh array identity every render is a real hazard in this codebase — see
  // AGENTS.md's TanStack note. This screen no longer uses a table, but the same discipline keeps
  // the grid's rows from remounting mid-click.
  const filtered = useMemo(
    () => data.filter(d => d.name.toLowerCase().includes(globalFilter.toLowerCase())),
    [data, globalFilter]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Clamped rather than reset in an effect — this codebase uses no useEffect, and a filter that
  // shrinks the list below the current page would otherwise render an empty grid.
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  async function handleAdd(formData: FormData) {
    const name = formData.get("name") as string
    const price = Number(formData.get("price"))
    const servingSize = Number(formData.get("servingSize")) || 1

    const result = await createDish({
      name,
      price,
      servingSize,
      ingredients: recipePayload(newRecipe),
    })

    if (!result.ok) {
      toast.add({ title: 'Error', description: result.error, type: 'error' })
      return
    }

    const newDish = result.data
    // `media: []` — a brand-new dish has none. Photos and video are attached one at a time from
    // the dish's own detail page, never from this create form.
    setData([...data, {
      ...newDish,
      ingredients: buildIngredients(newDish.id, newRecipe, null, inventory),
      media: [],
    }])
    setIsOpen(false)
    setNewRecipe([])
    toast.add({ title: 'Dish created', description: `"${name}" was added to the menu.`, type: 'success' })
  }

  async function handleToggleActive(dish: DishWithMedia) {
    const nextIsActive = !dish.isActive
    await toggleDishActive(dish.id, nextIsActive)
    setData(prev => prev.map(d => d.id === dish.id ? { ...d, isActive: nextIsActive } : d))
    toast.add({
      title: nextIsActive ? 'Dish restored' : 'Dish archived',
      description: nextIsActive
        ? `"${dish.name}" is available on new orders again.`
        : `"${dish.name}" is hidden from new orders.`,
      type: 'info',
    })
  }

  async function performDelete(dish: DishWithMedia) {
    try {
      const result = await deleteDish(dish.id)

      if (result.archived) {
        setData(prev => prev.map(d => d.id === dish.id ? { ...d, isActive: false } : d))
        toast.add({
          title: 'Dish archived',
          description: `"${dish.name}" is referenced by past orders, so it was archived instead of deleted.`,
          type: 'info',
        })
      } else {
        setData(prev => prev.filter(d => d.id !== dish.id))
        toast.add({ title: 'Dish deleted', description: `"${dish.name}" was removed from the menu.`, type: 'success' })
      }
      setDeletingDish(null)
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete this dish.', type: 'error' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <p className="meta-text text-sm">
          {data.filter(d => d.isActive).length} active dish{data.filter(d => d.isActive).length !== 1 ? 'es' : ''}
        </p>
        <div className="flex flex-1 sm:flex-none items-center gap-4">
          <Input
            placeholder="Search menu..."
            value={globalFilter ?? ''}
            onChange={(e) => {
              setGlobalFilter(String(e.target.value))
              setPage(0)
            }}
            className="w-full sm:w-64 bg-card"
          />
          {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
          <Button onClick={() => setIsOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Dish
          </Button>
        </div>
      </div>

      {/* Create dialog — name/price/servingSize/recipe only. Photos and video are deliberately
          absent: a dish must exist before media can be attached to it, and each item is its own
          immediately-persisted action on the detail page rather than part of this save. */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Dish</DialogTitle>
          </DialogHeader>
          <form action={handleAdd} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Dish Name</Label>
                <Input id="name" name="name" placeholder="e.g. Jollof Rice" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Price ({getCurrencySymbol()})</Label>
                <Input id="price" name="price" type="number" step="any" min="0" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="servingSize">Recipe Serves</Label>
                <Input id="servingSize" name="servingSize" type="number" min="1" step="1" defaultValue={1} />
                <p className="text-[10px] text-muted-foreground">How many units does this recipe cover? (1 = per-unit)</p>
              </div>
            </div>

            <RecipeBuilder
              rows={newRecipe}
              setRows={setNewRecipe}
              inventory={inventory}
              dish={null}
              onAddRow={() => addRow(newRecipe, setNewRecipe)}
            />

            <p className="text-xs text-muted-foreground">
              Add photos and video from the dish&apos;s own page once it is saved.
            </p>

            <Button type="submit" className="w-full">Save Dish</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Card gallery */}
      {visible.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map(dish => {
            const cover = coverImageUrl(dish)
            return (
              <div
                key={dish.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-lg border border-border bg-card",
                  !dish.isActive && "opacity-60"
                )}
              >
                <div className="relative aspect-[4/3] w-full bg-muted">
                  {cover ? (
                    // Plain <img>, never next/image — matching this repo's zero-next/image convention.
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                      <UtensilsCrossed className="h-8 w-8" aria-hidden="true" />
                    </div>
                  )}

                  {hasVideo(dish) && (
                    <span
                      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground"
                      title="This dish has video"
                    >
                      <Film className="h-3 w-3" aria-hidden="true" />
                      Video
                    </span>
                  )}

                  <span className={cn("absolute top-2 right-2", dish.isActive ? 'dish-active' : 'dish-archived')}>
                    {dish.isActive ? 'ACTIVE' : 'ARCHIVED'}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground">
                      <HighlightText text={dish.name} query={globalFilter} />
                    </span>
                    <span className="font-mono-data tabular-nums text-xs font-bold text-primary">
                      #{dish.shortId}
                    </span>
                  </div>

                  <span className="font-mono-data text-sm text-foreground">
                    {formatCurrency(dish.price)}
                  </span>
                  <span className="meta-text text-xs">
                    Recipe serves {dish.servingSize}
                  </span>

                  <div className="mt-2 flex gap-2 border-t border-border pt-2">
                    {/* Editing is a full page now, not a dialog — that page owns both the recipe
                        editor and this dish's media management. Styled with buttonVariants rather
                        than <Button asChild>: this Button primitive has no asChild/render slot. */}
                    <Link
                      href={`/admin/menu/${dish.id}`}
                      title="Edit dish"
                      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), "h-8 w-8")}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Edit</span>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={dish.isActive ? "Archive dish" : "Restore dish"}
                      onClick={() => handleToggleActive(dish)}
                    >
                      {dish.isActive
                        ? <Archive className="h-4 w-4" aria-hidden="true" />
                        : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                      <span className="sr-only">{dish.isActive ? "Archive" : "Restore"}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete dish"
                      onClick={() => setDeletingDish(dish)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="empty-state-title">No dishes yet</p>
            <p className="empty-state-hint">
              Add a dish and its recipe so orders can deduct stock automatically.
            </p>
          </div>
        </div>
      )}

      {/* Local pagination — TablePagination is built around a TanStack Table instance this screen
          no longer has. */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="meta-text text-xs">
            Page {currentPage + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingDish} onOpenChange={(open) => !open && setDeletingDish(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deletingDish?.name}&quot;? A dish used by past orders is archived instead, so order history stays intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingDish && performDelete(deletingDish)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
