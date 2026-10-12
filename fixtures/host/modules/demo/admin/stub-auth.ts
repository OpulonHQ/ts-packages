// Stub sign-in until users ships: the bearer token of the fixture Worker's demo user is kept in
// sessionStorage and sent with every admin request.
const key = 'demo-token'

export const signInWithToken = (token: string) => sessionStorage.setItem(key, token)

export const stubFetch: typeof fetch = (input, init) => {
  const token = sessionStorage.getItem(key)
  const headers = new Headers(init?.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
