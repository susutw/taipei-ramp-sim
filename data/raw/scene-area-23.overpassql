[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.03942,121.54591,25.05223,121.56815);
  way["building"](25.03942,121.54591,25.05223,121.56815);
);
out body geom;
