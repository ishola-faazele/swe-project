"use client"

import { useState } from "react"
import Link from "next/link"
import { DishMedia, InventoryItem } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { MediaUpload } from "@/components/ui/media-upload"
import { formatCurrency, getCurrencySymbol } from "@/lib/currency"
import { updateDish } from "../actions"
import {
  RecipeBuilder,
  recipePayload,
  type DishWithMedia,
  type RecipeRow,
} from "../RecipeBuilder"
import { addDishMedia, removeDishMedia, reorderDishMedia } from "./actions"
import { ArrowLeft, ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react"

export function DishDetailsClient({
  dish,
  inventory,
}: {
  dish: DishWithMedia
  inventory: InventoryItem[]
}) {
  const [media, setMedia] = useState<DishMedia[]>(dish.media)
  const [recipe, setRecipe] = useState<RecipeRow[]>(
    dish.ingredients.map((ingredient, index) => ({
      inventoryItemId: ingredient.inventoryItemId,
      quantityPerDish: ingredient.quantityPerDish,
      internalId: index,
    }))
  )
  const [counter, setCounter] = useState(dish.ingredients.length)
  // Bumped after every successful add to REMOUNT the uploader, clearing its internal preview and
  // status so the next pick starts clean. Same remount-to-reset technique CustomerFormFields
  // already uses (key={isOpen ? 'add-open' : 'add-closed'}), not a new pattern.
  const [mediaUploadKey, setMediaUploadKey] = useState(0)

  function addRow() {
    setRecipe([...recipe, { inventoryItemId: '', quantityPerDish: 0, internalId: counter }])
    setCounter(c => c + 1)
  }

  async function handleSave(formData: FormData) {
    const name = formData.get("name") as string
    const price = Number(formData.get("price"))

    const result = await updateDish(dish.id, {
      name,
      price,
      servingSize: Number(formData.get("servingSize")) || 1,
      ingredients: recipePayload(recipe),
    })

    if (!result.ok) {
      toast.add({ title: 'Error', description: result.error, type: 'error' })
      return
    }

    toast.add({ title: 'Dish updated', description: `"${name}" was saved.`, type: 'success' })
  }

  async function handleMediaUploaded(url: string | null, contentType?: string) {
    // MediaUpload's onChange(null) only fires on an explicit clear, which this always-empty "add"
    // slot has no meaningful use for.
    if (!url || !contentType) return

    // Derived from the browser-reported file type and trusted as-is — never verified against the
    // actual bytes. Worst case of a lie is a broken tile, a cosmetic failure, not a security one.
    const type = contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE'

    const result = await addDishMedia({ dishId: dish.id, url, type })
    if (!result.ok) {
      toast.add({ title: 'Error', description: result.error, type: 'error' })
      return
    }

    setMedia(prev => [...prev, result.data])
    setMediaUploadKey(k => k + 1)
  }

  // No confirmation dialog on purpose: removing one media item is low-stakes and easily reversed
  // (re-adding it is just picking the same file again), unlike deleting a whole dish.
  async function handleRemove(mediaId: string) {
    const result = await removeDishMedia(mediaId)
    if (!result.ok) {
      toast.add({ title: 'Error', description: result.error, type: 'error' })
      return
    }

    setMedia(prev => prev.filter(m => m.id !== mediaId))
  }

  async function handleReorder(mediaId: string, direction: 'up' | 'down') {
    const result = await reorderDishMedia({ dishId: dish.id, mediaId, direction })
    if (!result.ok) {
      toast.add({ title: 'Error', description: result.error, type: 'error' })
      return
    }

    // The action returns the dish's full list in its new order — adopt it wholesale rather than
    // reproducing the swap locally.
    setMedia(result.data)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/menu"
            className="meta-text inline-flex items-center gap-1 text-xs hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to menu
          </Link>
          <h1 className="page-title mt-1">{dish.name}</h1>
          <p className="meta-text mt-0.5">
            Dish #{dish.shortId} · {formatCurrency(dish.price)}
          </p>
        </div>
      </div>

      {/* Details — a straight relocation of the old edit dialog's fields onto a full page. */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-bold text-foreground">Details</h2>
        <p className="meta-text mt-0.5 mb-4">Name, price, and the recipe deducted per dish.</p>

        <form action={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Dish Name</Label>
              <Input id="name" name="name" defaultValue={dish.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price ({getCurrencySymbol()})</Label>
              <Input id="price" name="price" type="number" step="any" min="0" defaultValue={dish.price} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="servingSize">Recipe Serves</Label>
              <Input id="servingSize" name="servingSize" type="number" min="1" step="1" defaultValue={dish.servingSize} />
              <p className="text-[10px] text-muted-foreground">How many units does this recipe cover? (1 = per-unit)</p>
            </div>
          </div>

          <RecipeBuilder
            rows={recipe}
            setRows={setRecipe}
            inventory={inventory}
            dish={dish}
            onAddRow={addRow}
          />

          <p className="text-xs text-muted-foreground">
            Recipe changes only affect future orders — past orders keep the ingredients they were
            placed with.
          </p>

          <Button type="submit" className="w-full">Update Dish</Button>
        </form>
      </section>

      {/* Photos & Video — each item is added, reordered, and removed on its own. There is no Save
          button here: every action below persists the moment it succeeds. */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-bold text-foreground">Photos &amp; Video</h2>
        <p className="meta-text mt-0.5 mb-4">
          The first photo is this dish&apos;s cover on the menu gallery. Changes save immediately.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {media.map((item, index) => (
            <div key={item.id} className="space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {item.type === 'VIDEO' ? (
                  // Plain <video controls>, no player library — the same restraint as this repo's
                  // zero-next/image convention.
                  <video controls className="h-full w-full object-cover" src={item.url} />
                ) : (
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}

                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1 right-1 bg-background/80 text-destructive hover:bg-destructive/20 hover:text-destructive"
                  title="Remove"
                  aria-label={`Remove media ${index + 1}`}
                  onClick={() => handleRemove(item.id)}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>

              <div className="flex items-center justify-between gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Move earlier"
                  aria-label={`Move media ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => handleReorder(item.id, 'up')}
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                </Button>
                <span className="meta-text text-[10px] uppercase">{item.type}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Move later"
                  aria-label={`Move media ${index + 1} later`}
                  disabled={index === media.length - 1}
                  onClick={() => handleReorder(item.id, 'down')}
                >
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}

          {media.length === 0 && (
            <div className="col-span-full flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-muted-foreground">
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              <p className="text-xs">No photos or video yet.</p>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <MediaUpload
            key={mediaUploadKey}
            value={null}
            onChange={handleMediaUploaded}
            entityType="dish"
            label="Add photo or video"
          />
        </div>
      </section>
    </div>
  )
}
