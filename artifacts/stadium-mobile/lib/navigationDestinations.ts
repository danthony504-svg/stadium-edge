export type NavigationDestination = {
  label: string;
  route: string;
  icon: string;
  beta?: boolean;
};

export const NAV_DESTINATIONS: readonly NavigationDestination[] = [
  { label: "Discover", route: "/", icon: "compass" },
  { label: "Coach", route: "/coach", icon: "zap" },
  { label: "Fantasy Football", route: "/fantasy", icon: "award", beta: true },
  { label: "Park Weather", route: "/weather", icon: "cloud-drizzle" },
  { label: "Props", route: "/props", icon: "user" },
  { label: "Simulator", route: "/simulator", icon: "cpu" },
  { label: "Edge Lock", route: "/arbitrage", icon: "repeat" },
  { label: "+500 Steals", route: "/steals", icon: "target" },
  { label: "Slip", route: "/slip", icon: "layers" },
  { label: "Model Report", route: "/report", icon: "bar-chart-2" },
];
