[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.03319,121.48935,25.05554,121.51216);
  way["building"](25.03319,121.48935,25.05554,121.51216);
);
out body geom;
