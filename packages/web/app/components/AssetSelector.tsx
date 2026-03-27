import { TabBar } from "./TabBar";

export function AssetSelector({ current }: { current: string }) {
  const assets = ["BTC", "ETH"];

  return (
    <TabBar
      items={assets.map((a) => ({ key: a, label: a, to: `/?asset=${a}` }))}
      activeKey={current}
    />
  );
}
