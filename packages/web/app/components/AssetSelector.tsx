import { TabBar, TabBarProps } from "./TabBar";

export function AssetSelector({
  current,
  baseUrl = "/",
  ...restProps
}: { current: string; baseUrl?: string } & Omit<TabBarProps, "activeKey" | "items">) {
  const assets = ["BTC", "ETH"];

  return (
    <TabBar
      items={assets.map((a) => ({ key: a, label: a, to: `${baseUrl}?asset=${a}` }))}
      activeKey={current}
      {...restProps}
    />
  );
}
