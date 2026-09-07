export interface WalletRequest {
  readonly type: 'wallet_supportedWalletApi';
}

export interface ProbeWallet {
  request(request: WalletRequest): Promise<unknown>;
}

export interface CapabilityReport {
  readonly versions?: readonly string[];
  readonly errorCode?: number;
  readonly api: 'responded' | 'unverified';
  readonly collection: 'unverified';
  readonly reason: 'API_RESPONSE' | 'TIMEOUT' | 'REQUEST_FAILED' | 'MALFORMED_RESPONSE';
}

export async function probeStrk20Wallet(wallet: ProbeWallet, timeoutMs = 10_000): Promise<CapabilityReport> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('VOW_INVALID_TIMEOUT');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CapabilityReport>((resolve) => {
    timer = setTimeout(() => resolve(report('TIMEOUT')), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => wallet.request({ type: 'wallet_supportedWalletApi' }))
        .then((response): CapabilityReport => Array.isArray(response) && response.length <= 32 && response.every((version: unknown) => typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-rc\.\d{1,3})?$/.test(version))
          ? { api: 'responded', versions: [...response] as string[], collection: 'unverified', reason: 'API_RESPONSE' }
          : report('MALFORMED_RESPONSE'))
        .catch((error: unknown) => failedReport(error)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function report(reason: CapabilityReport['reason']): CapabilityReport {
  return { api: 'unverified', collection: 'unverified', reason };
}

function failedReport(error: unknown): CapabilityReport {
  const failure = report('REQUEST_FAILED');
  try {
    if (typeof error !== 'object' || error === null) return failure;
    const code: unknown = Reflect.get(error, 'code');
    if (typeof code === 'number' && Number.isSafeInteger(code) && Math.abs(code) <= 2147483647) {
      return { ...failure, errorCode: code };
    }
  } catch { return failure; }
  return failure;
}
