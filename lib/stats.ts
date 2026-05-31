export interface ProxyStats {
  direct: number;
  proxy: number;
}

export const stats: ProxyStats = {
  direct: 0,
  proxy: 0,
};

export function formatStats(): string {
  const total = stats.direct + stats.proxy;
  return `direct: ${stats.direct} | proxy: ${stats.proxy} | total: ${total}`;
}
