[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.00106,121.52702,25.02219,121.5498);
  way["building"](25.00106,121.52702,25.02219,121.5498);
);
out body geom;
