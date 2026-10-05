[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.00889,121.48712,25.02499,121.50736);
  way["building"](25.00889,121.48712,25.02499,121.50736);
);
out body geom;
