import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("brief/:id", "routes/brief.tsx"),
  route("brief-history", "routes/brief-history.tsx"),
] satisfies RouteConfig;
