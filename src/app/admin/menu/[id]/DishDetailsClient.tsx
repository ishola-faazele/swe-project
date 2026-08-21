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

      {/* Hero Gallery Section */}
      <section className="space-y-4">
        {/* Cover Media */}
        <div className="relative aspect-video sm:aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
          {media.length > 0 ? (
            media[0].type === 'VIDEO' ? (
              <video controls className="h-full w-full object-cover" src={media[0].url} />
            ) : (
              <img src={media[0].url} alt="Cover" className="h-full w-full object-cover" />
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground bg-muted/30">
              <ImageIcon className="h-12 w-12 opacity-50 mb-2" aria-hidden="true" />
              <p className="text-sm font-medium">No media added</p>
            </div>
          )}

          {media.length > 0 && (
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <span className="bg-background/90 text-foreground px-2 py-1 rounded text-xs font-semibold shadow">Cover</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 shadow"
                onClick={() => handleRemove(media[0].id)}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        {/* Thumbnails & Add Media */}
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {media.slice(1).map((item, index) => {
            const actualIndex = index + 1;
            return (
              <div key={item.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {item.type === 'VIDEO' ? (
                  <video className="h-full w-full object-cover" src={item.url} muted playsInline />
                ) : (
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}

                <div className="absolute inset-0 bg-background/50 opacity-0 transition-opacity group-hover:opacity-100 flex flex-col items-center justify-center gap-2">
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      size="icon-xs"
                      className="h-6 w-6 rounded-full"
                      onClick={() => handleReorder(item.id, 'up')}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-xs"
                      className="h-6 w-6 rounded-full"
                      disabled={actualIndex === media.length - 1}
                      onClick={() => handleReorder(item.id, 'down')}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    variant="destructive"
                    size="icon-xs"
                    className="h-6 w-6 rounded-full"
                    onClick={() => handleRemove(item.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )
          })}

          <div className="col-span-3 sm:col-span-2">
            <MediaUpload
              key={mediaUploadKey}
              value={null}
              onChange={handleMediaUploaded}
              entityType="dish"
              label="Add photo / video"
            />
          </div>
        </div>
      </section>

      {/* Details — a straight relocation of the old edit dialog's fields onto a full page. */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Recipe & Pricing</h2>
        <p className="meta-text mt-1 mb-6">Manage how this dish is priced and what inventory it consumes.</p>

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
    </div>
  )
}
