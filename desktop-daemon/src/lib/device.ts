/**
 * 图谱总览节点上限：按设备硬件估算默认值（用户未自定义时用）。
 * 力导向图节点越多越重，3D 尤甚，所以按 CPU 线程 + 内存粗分档。
 */
export function getDeviceNodeCap(): number {
  if (typeof navigator === 'undefined') return 300;
  const cores = (navigator as any).hardwareConcurrency || 4;
  const mem = (navigator as any).deviceMemory || 4; // GB，仅 Chromium/WebView2 可读
  if (mem >= 8 && cores >= 8) return 600;
  if (mem >= 4 && cores >= 4) return 300;
  return 150;
}

/** 解析最终生效的节点上限：自定义(>0)优先并夹到 [50,1000]，否则按设备自动。 */
export function resolveNodeCap(custom: number | undefined | null): number {
  if (custom && custom > 0) return Math.min(Math.max(custom, 50), 1000);
  return getDeviceNodeCap();
}
