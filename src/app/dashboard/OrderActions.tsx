"use client"

import { Button } from "@/components/ui/button"
import { Printer, Share2 } from "lucide-react"
import { formatCurrency, BUSINESS_LOCALE } from "@/lib/currency"

type OrderProps = {
  shortId: number
  customerName: string | null
  status: string
  dishes: { quantity: number; dishName: string; unitPrice: number }[]
  totalPrice: number
  dueDate: Date | null
}

export function OrderActions({ order }: { order: OrderProps }) {
  const handleShareReceipt = () => {
    const lines = [
      `*Receipt for Order #${order.shortId}*`,
      `Customer: ${order.customerName || 'N/A'}`,
      `Status: ${order.status}`,
      ``,
      `*Items:*`,
      ...order.dishes.map(d => `- ${d.quantity}x ${d.dishName} (${formatCurrency(d.unitPrice)})`),
      ``,
      `*Total: ${formatCurrency(order.totalPrice)}*`,
    ]

    if (order.dueDate) {
      lines.push(`Due Date: ${order.dueDate.toLocaleDateString(BUSINESS_LOCALE)}`)
    }

    const text = encodeURIComponent(lines.join('\n'))
    // Since this is for the customer to share with OTHERS, we don't send to a specific number.
    // Opening wa.me without a phone number opens the contact picker on WhatsApp.
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=600,height=800')
    if (!printWindow) return

    const receiptHtml = `
      <html>
        <head>
          <title>Receipt - Order #${order.shortId}</title>
          <style>
            body { font-family: monospace; padding: 20px; max-width: 400px; margin: 0 auto; color: #000; }
            h1 { text-align: center; font-size: 1.5rem; border-bottom: 1px dashed #000; padding-bottom: 10px; }
            .meta { margin-bottom: 20px; font-size: 0.9rem; }
            .item { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 1.2rem; border-top: 1px dashed #000; padding-top: 10px; margin-top: 10px; }
            .footer { text-align: center; margin-top: 40px; font-size: 0.8rem; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <h1>CHOP WITH ROSTTY</h1>
          <div class="meta">
            <div>Order #${order.shortId}</div>
            <div>Customer: ${order.customerName || 'N/A'}</div>
            <div>Status: ${order.status}</div>
            ${order.dueDate ? `<div>Due Date: ${order.dueDate.toLocaleDateString(BUSINESS_LOCALE)}</div>` : ''}
          </div>
          
          <div class="items">
            ${order.dishes.length > 0 
              ? order.dishes.map(d => `
                <div class="item">
                  <span>${d.quantity}x ${d.dishName}</span>
                  <span>${formatCurrency(d.unitPrice * d.quantity)}</span>
                </div>
              `).join('')
              : '<div class="item">No dishes recorded.</div>'
            }
          </div>

          <div class="total">
            <span>Total</span>
            <span>${formatCurrency(order.totalPrice)}</span>
          </div>

          <div class="footer">
            Thank you for your order!
          </div>
        </body>
      </html>
    `

    printWindow.document.write(receiptHtml)
    printWindow.document.close()
    
    // Wait for content to load before printing
    printWindow.onload = () => {
      printWindow.focus()
      printWindow.print()
      // Optional: printWindow.close() after printing, but some browsers block it if print is cancelled.
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Print
      </Button>
      <Button variant="outline" size="sm" onClick={handleShareReceipt}>
        <Share2 className="mr-1.5 h-4 w-4 text-green-600" aria-hidden="true" />
        Share
      </Button>
    </div>
  )
}
