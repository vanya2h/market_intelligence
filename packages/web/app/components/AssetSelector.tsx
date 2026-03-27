import { TabBar, TabBarProps } from "./TabBar";

export function AssetSelector({
  current,
  ...restProps
}: { current: string } & Omit<TabBarProps, "activeKey" | "items">) {
  const assets = ["BTC", "ETH"];

  return (
    <TabBar items={assets.map((a) => ({ key: a, label: a, to: `/?asset=${a}` }))} activeKey={current} {...restProps} />
  );
}
