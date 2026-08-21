import { getAuditLogs } from './actions'
import { AuditClient } from './AuditClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function AuditPage() {
  await authorizePage([Role.ADMIN])
  const logs = await getAuditLogs()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Audit Logs
        </h1>
        <p className="meta-text mt-0.5">
          Showing the last {logs.length} tracked actions.
        </p>
      </div>
      <AuditClient initialData={logs} />
    </div>
  )
}
