[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.00643,121.50993,25.0287,121.53357);
  way["building"](25.00643,121.50993,25.0287,121.53357);
);
out body geom;
