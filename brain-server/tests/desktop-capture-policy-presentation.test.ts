import { describe, expect, it } from 'vitest';
import { getCapturePolicyTogglePresentation } from '../../desktop-daemon/src/lib/capture-policy-presentation';

describe('capture-policy toggle presentation', () => {
  it('uses a neutral, disabled, unpressed state when native revocation is unconfirmed', () => {
    for (const storedPreference of [false, true]) {
      const presentation = getCapturePolicyTogglePresentation(
        storedPreference,
        '无法确认原生捕获已停止；请立即停止捕获并退出应用。',
        false,
      );

      expect(presentation.state).toBe('unknown');
      expect(presentation.disabled).toBe(true);
      expect('pressed' in presentation).toBe(false);
    }
  });

  it('also avoids presenting a confirmed on/off state for other unresolved sync errors', () => {
    const presentation = getCapturePolicyTogglePresentation(
      false,
      '无法确认隐私设置已同步到本机硬件监听器。',
      false,
    );

    expect(presentation).toEqual({ state: 'unknown', disabled: true });
  });

  it('shows a distinct revoked state and never exposes the stale active preference after a failed save', () => {
    const presentation = getCapturePolicyTogglePresentation(
      false,
      '隐私设置未能保存；本机捕获保持撤销。请先保存“保持暂停”，再明确选择是否恢复。',
      false,
    );

    expect(presentation).toEqual({ state: 'revoked', disabled: true });
    expect('pressed' in presentation).toBe(false);
  });

  it('keeps capture visibly revoked during the explicit recovery save', () => {
    expect(getCapturePolicyTogglePresentation(
      false,
      '隐私设置未能保存；本机捕获保持撤销。',
      true,
    )).toEqual({ state: 'revoked', disabled: true });
  });

  it('also treats an interrupted prior privacy transaction as revoked after relaunch', () => {
    expect(getCapturePolicyTogglePresentation(
      false,
      '隐私策略变更尚未确认；本机捕获保持撤销。',
      false,
    )).toEqual({ state: 'revoked', disabled: true });
  });

  it('disables a known toggle while synchronization is pending', () => {
    expect(getCapturePolicyTogglePresentation(true, null, true)).toEqual({
      state: 'paused',
      disabled: true,
      pressed: true,
    });
  });
});
