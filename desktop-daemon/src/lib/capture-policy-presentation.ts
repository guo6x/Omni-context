export type CapturePolicyTogglePresentation =
  | { state: 'unknown'; disabled: true; pressed?: never }
  | { state: 'revoked'; disabled: true; pressed?: never }
  | { state: 'paused' | 'active'; disabled: boolean; pressed: boolean };

export function isCapturePolicyRevokedError(syncError: string | null): boolean {
  return syncError?.includes('隐私设置未能保存') === true
    || syncError?.includes('隐私策略变更尚未确认') === true;
}

/**
 * Show the stored preference as a toggle only when native state is known.
 * A failed save is distinct: native capture was explicitly revoked, and the
 * stale stored preference must not be presented as active or re-applied.
 */
export function getCapturePolicyTogglePresentation(
  capturePaused: boolean,
  syncError: string | null,
  pending: boolean,
): CapturePolicyTogglePresentation {
  const nativeRevocationConfirmed = isCapturePolicyRevokedError(syncError);

  if (nativeRevocationConfirmed) {
    return { state: 'revoked', disabled: true };
  }

  if (syncError) {
    return { state: 'unknown', disabled: true };
  }

  return {
    state: capturePaused ? 'paused' : 'active',
    disabled: pending,
    pressed: capturePaused,
  };
}
