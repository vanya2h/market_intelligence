import type { LoaderFunctionArgs } from "react-router";
import { api } from "../server/api.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const asset = params.asset;
  if (!asset) return Response.json({ error: "Missing asset" }, { status: 400 });

  const res = await api.api.price[":asset"].$get({ param: { asset } });

  if (!res.ok) {
    return Response.json({ error: "Upstream price fetch failed" }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data, {
    headers: { "Cache-Control": "no-cache" },
  });
}
