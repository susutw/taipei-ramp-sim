[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.05994,121.5196,25.08194,121.54202);
  way["building"](25.05994,121.5196,25.08194,121.54202);
);
out body geom;
