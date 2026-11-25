import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, type AuthUser, type Role } from '@/services/authApi'

/** Server-backed session (httpOnly cookie). `user` is null when signed out, `ready` false while /auth/me loads. */
export type SessionUser = AuthUser

interface SessionCtx {
  user: SessionUser | null
  ready: boolean
  signIn: (email: string, password: string) => Promise<SessionUser>
  signUp: (body: { name: string; email: string; password: string; confirm_password: string; requested_role: Role; auth_code?: string }) => Promise<{ email: string; debug_link?: string; email_sent: boolean; activated?: boolean }>
  signOut: () => Promise<void>
  refresh: () => Promise<SessionUser | null>
  setUser: (u: SessionUser | null) => void
}

const Ctx = createContext<SessionCtx | null>(null)

/** Landing route for a user after sign-in, based on role and account state. */
export function homeFor(u: SessionUser | null): string {
  if (!u) return '/welcome'
  if (u.must_change_password) return '/change-password'
  if (u.status !== 'active' || u.access_expired) return '/pending'
  return u.role === 'employee' ? '/excel' : '/'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me()
      setUser(u)
      return u
    } catch {
      setUser(null)
      return null
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    const u = await authApi.login(email.trim(), password)
    setUser(u)
    return u
  }, [])
  const signUp = useCallback(async (body: Parameters<SessionCtx['signUp']>[0]) => authApi.signup({ ...body, email: body.email.trim() }), [])
  const signOut = useCallback(async () => {
    try { await authApi.logout() } finally { setUser(null) }
  }, [])

  const value = useMemo(() => ({ user, ready, signIn, signUp, signOut, refresh, setUser }), [user, ready, signIn, signUp, signOut, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSession must be used inside SessionProvider')
  return c
}

export function can(user: SessionUser | null, ...roles: Role[]): boolean {
  return !!user && user.status === 'active' && roles.includes(user.role)
}
