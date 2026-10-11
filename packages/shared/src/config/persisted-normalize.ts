/** persisted-normalize ownership. config.json writes belong exclusively to repository.ts. */

export function stripRemoteServerToken<T extends { token?: string }>(remoteServer: T): Omit<T, 'token'> {
  const { token: _token, ...metadata } = remoteServer
  return metadata
}
