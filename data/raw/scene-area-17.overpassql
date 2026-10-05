[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.04335,121.49896,25.05857,121.52369);
  way["building"](25.04335,121.49896,25.05857,121.52369);
);
out body geom;
