import { getCustomers } from './actions'
import { CustomerClient } from './CustomerClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function CustomersPage() {
  await authorizePage([Role.ADMIN])
  const customers = await getCustomers()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Customers
        </h1>
        <p className="meta-text mt-0.5">
          {customers.length} registered client{customers.length !== 1 ? 's' : ''}
        </p>
      </div>
      <CustomerClient initialData={customers} />
    </div>
  )
}
