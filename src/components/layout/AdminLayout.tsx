import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="flex flex-col">
        <Header />
        <main id="main-content" className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
