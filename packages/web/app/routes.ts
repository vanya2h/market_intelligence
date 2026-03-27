import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("brief/:id", "routes/brief.tsx"),
  route("brief-history", "routes/brief-history.tsx"),
  route("faq", "routes/faq.tsx"),
  route("api/price/:asset", "routes/api.price.ts"),
] satisfies RouteConfig;
