"use client"

import { useRef, useState } from 'react'
import { Prisma } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Printer, Image as ImageIcon, Download } from 'lucide-react'
import html2canvas from 'html2canvas'
import { formatCurrency } from '@/lib/currency'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

import { Order, OrderDish } from '@prisma/client'
import type { ClientSafeUser } from '@/lib/user'

type InvoiceOrder = Order & {
  customer: ClientSafeUser,
  dishes: OrderDish[]
}

export function InvoiceModal({ order }: { order: InvoiceOrder }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const invoiceRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    window.print()
  }

  const handleExportImage = async () => {
    if (!invoiceRef.current) return
    setIsExporting(true)
    try {
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff'
      })
      const image = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = image
      link.download = `Invoice_Order_${order.shortId}.png`
      link.click()
    } catch (err) {
      console.error('Failed to export image', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={
        <Button variant="outline" size="sm" className="gap-2">
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">Invoice</span>
        </Button>
      } />
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex justify-between items-center mr-8">
            <span>Order Invoice</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePrint} className="gap-2">
                <Printer className="h-4 w-4" /> Print PDF
              </Button>
              <Button size="sm" onClick={handleExportImage} disabled={isExporting} className="gap-2">
                {isExporting ? <span className="animate-spin text-lg leading-none">C</span> : <ImageIcon className="h-4 w-4" />}
                Export Image
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 p-8 bg-white text-black font-sans relative border rounded-md" ref={invoiceRef}>
          {/* Printable styles injected here to force this div only for printing */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body * { visibility: hidden; }
              .invoice-print-container, .invoice-print-container * { visibility: visible; }
              .invoice-print-container { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px; }
            }
          `}} />
          
          <div className="invoice-print-container">
            <div className="flex justify-between items-start border-b pb-6 mb-6 border-gray-200">
              <div>
                <h2 className="text-3xl font-bold tracking-tighter uppercase text-gray-900">CHOP WITH ROSTTY</h2>
                <p className="text-sm text-gray-500 mt-1">Authentic West African Catering</p>
                <p className="text-sm text-gray-500">Accra, Ghana</p>
              </div>
              <div className="text-right">
                <h3 className="text-xl font-semibold text-gray-700">INVOICE</h3>
                <p className="font-mono text-gray-500 mt-1">#{order.shortId}</p>
                <p className="text-sm text-gray-500 mt-1">Date: {order.createdAt.toLocaleDateString()}</p>
              </div>
            </div>

            <div className="flex justify-between mb-8">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Bill To:</p>
                <p className="font-semibold">{order.customer.name || 'Walk-in Customer'}</p>
                {order.customer.phone && <p className="text-sm text-gray-600">{order.customer.phone}</p>}
                {order.customer.email && <p className="text-sm text-gray-600">{order.customer.email}</p>}
              </div>
              
              {(order.deliveryAddress || order.dueDate) && (
                <div className="text-right">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Delivery Details:</p>
                  {order.dueDate && <p className="text-sm text-gray-600 font-medium text-amber-600">Due: {order.dueDate.toLocaleDateString()}</p>}
                  {order.deliveryAddress && <p className="text-sm text-gray-600 max-w-[200px] ml-auto">{order.deliveryAddress}</p>}
                  {order.deliveryPhone && <p className="text-sm text-gray-600 mt-1">{order.deliveryPhone}</p>}
                </div>
              )}
            </div>

            <table className="w-full text-left border-collapse mb-8">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="py-3 font-semibold text-gray-800">Item Description</th>
                  <th className="py-3 font-semibold text-gray-800 text-right">Qty</th>
                  <th className="py-3 font-semibold text-gray-800 text-right">Unit Price</th>
                  <th className="py-3 font-semibold text-gray-800 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.dishes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-gray-500 italic text-center">No items listed.</td>
                  </tr>
                ) : (
                  order.dishes.map((dish, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-4 font-medium text-gray-800">{dish.dishName}</td>
                      <td className="py-4 text-gray-600 text-right">{dish.quantity}</td>
                      <td className="py-4 text-gray-600 text-right font-mono">{formatCurrency(dish.unitPrice)}</td>
                      <td className="py-4 text-gray-900 text-right font-mono font-medium">
                        {formatCurrency(dish.unitPrice * dish.quantity)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="flex justify-end pt-4 border-t-2 border-gray-800">
              <div className="w-64">
                <div className="flex justify-between items-center py-2 text-lg font-bold">
                  <span>Total Amount</span>
                  <span className="font-mono">{formatCurrency(order.totalPrice)}</span>
                </div>
              </div>
            </div>

            <div className="mt-16 pt-8 border-t border-gray-200 text-center text-sm text-gray-500">
              <p>Thank you for choosing Chop with Rostty!</p>
              <p className="mt-1">Please keep this invoice for your records.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
