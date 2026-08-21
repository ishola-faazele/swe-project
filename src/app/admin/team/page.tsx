import { getTeam } from './actions'
import { TeamClient } from './TeamClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function TeamPage() {
  await authorizePage([Role.ADMIN])
  const team = await getTeam()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Team
        </h1>
        <p className="meta-text mt-0.5">
          {team.length} staff member{team.length !== 1 ? 's' : ''}
        </p>
      </div>
      <TeamClient initialData={team} />
    </div>
  )
}
