[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.11138,121.49308,25.13087,121.50538);
  way["building"](25.11138,121.49308,25.13087,121.50538);
);
out body geom;
