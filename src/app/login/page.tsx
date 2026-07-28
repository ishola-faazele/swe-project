import { login } from './actions'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { message: string }
}) {
  return (
    <div className="flex-1 flex flex-col w-full px-8 sm:max-w-md justify-center gap-2 mx-auto min-h-screen">
      <form
        className="animate-in flex-1 flex flex-col w-full justify-center gap-2 text-foreground"
      >
        <h1 className="text-3xl font-bold mb-4">Welcome back</h1>
        <label className="text-md" htmlFor="email">
          Email
        </label>
        <input
          className="rounded-md px-4 py-2 bg-inherit border mb-6"
          name="email"
          placeholder="you@example.com"
          required
        />
        <button
          formAction={login}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 mb-2"
        >
          Send Magic Link
        </button>
        {searchParams?.message && (
          <p className="mt-4 p-4 bg-muted text-foreground text-center">
            {searchParams.message}
          </p>
        )}
      </form>
    </div>
  )
}
