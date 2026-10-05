[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.0274,121.6099,25.04314,121.63554);
  way["building"](25.0274,121.6099,25.04314,121.63554);
);
out body geom;
