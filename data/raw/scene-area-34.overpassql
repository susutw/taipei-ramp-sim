[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.06591,121.5511,25.07723,121.56654);
  way["building"](25.06591,121.5511,25.07723,121.56654);
);
out body geom;
