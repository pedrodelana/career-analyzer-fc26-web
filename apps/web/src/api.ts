export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      'X-FC26-Client': 'local-web',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(
      result?.error?.message ??
        'The local backend is unavailable. Start the API server and try again.',
    );
  }
  return response.json() as Promise<T>;
}
