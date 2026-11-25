import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Lightweight client-side session. Login / sign-up currently work in "local" mode (no server check);
 * the shape is ready to be backed by an authentication API later.
 */
export interface SessionUser {
  name: string
  email: string
  role: 'viewer' | 'manager' | 'admin'
  signedInAt: string
}

interface SessionCtx {
  user: SessionUser | null
  signIn: (email: string, password: string) => Promise<SessionUser>
  signUp: (name: string, email: string, password: string) => Promise<SessionUser>
  signOut: () => void
}

const KEY = 'edd.session'
const Ctx = createContext<SessionCtx | null>(null)

function read(): SessionUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  return local.split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || 'User'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(read)
  const persist = useCallback((u: SessionUser | null) => {
    setUser(u)
    if (u) localStorage.setItem(KEY, JSON.stringify(u))
    else localStorage.removeItem(KEY)
  }, [])
  const signIn = useCallback(async (email: string, password: string) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid work email address.')
    if (password.length < 4) throw new Error('Enter your password.')
    await new Promise((r) => setTimeout(r, 500))
    const u: SessionUser = { name: nameFromEmail(email), email, role: 'manager', signedInAt: new Date().toISOString() }
    persist(u)
    return u
  }, [persist])
  const signUp = useCallback(async (name: string, email: string, password: string) => {
    if (name.trim().length < 2) throw new Error('Enter your full name.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid work email address.')
    if (password.length < 8) throw new Error('Use at least 8 characters for the password.')
    await new Promise((r) => setTimeout(r, 600))
    const u: SessionUser = { name: name.trim(), email, role: 'viewer', signedInAt: new Date().toISOString() }
    persist(u)
    return u
  }, [persist])
  const signOut = useCallback(() => persist(null), [persist])
  const value = useMemo(() => ({ user, signIn, signUp, signOut }), [user, signIn, signUp, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSession must be used inside SessionProvider')
  return c
}
