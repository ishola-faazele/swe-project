import { getCustomers } from './actions'
import { CustomerClient } from './CustomerClient'

export default async function CustomersPage() {
  const customers = await getCustomers()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'oklch(0.93 0.008 65)' }}>
          Customers
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
          {customers.length} registered client{customers.length !== 1 ? 's' : ''}
        </p>
      </div>
      <CustomerClient initialData={customers} />
    </div>
  )
}
