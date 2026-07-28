import { getCustomers } from './actions'
import { CustomerClient } from './CustomerClient'

export default async function CustomersPage() {
  const customers = await getCustomers()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Customers</h2>
      </div>
      <CustomerClient initialData={customers} />
    </div>
  )
}
