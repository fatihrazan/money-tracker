import type { DateRange, Snapshot } from '@money/core';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// HTTP client used by the web application.
export function createClient(
  baseUrl = '',
  getToken?: () => string | undefined,
  authMode: 'cookie' | 'bearer' = 'cookie',
  timeoutMs = 0,
) {
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    requestId?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = getToken?.();
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(`${baseUrl}/api/v1/${path}`, {
        signal:
          controller && signal
            ? AbortSignal.any([controller.signal, signal])
            : (controller?.signal ?? signal),
        method,
        credentials: authMode === 'cookie' ? 'include' : 'omit',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(requestId ? { 'Idempotency-Key': requestId } : {}),
          ...(authMode === 'bearer' ? { 'X-Auth-Mode': 'bearer' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new ApiError(response.status, payload.error?.message ?? 'Permintaan gagal.');
      return payload.data;
    } catch (error) {
      if (controller?.signal.aborted)
        throw new ApiError(408, 'Server tidak merespons. Periksa koneksi lalu coba lagi.');
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return {
    request,
    snapshot: (month: string, account = '', range?: DateRange, view?: string) =>
      request<Snapshot>(
        `snapshot?month=${encodeURIComponent(month)}${account ? `&account=${encodeURIComponent(account)}` : ''}${range ? `&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}` : ''}${view ? `&view=${encodeURIComponent(view)}` : ''}`,
      ),
  };
}
