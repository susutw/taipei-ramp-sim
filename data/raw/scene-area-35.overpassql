[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.01951,121.59736,25.02968,121.60854);
  way["building"](25.01951,121.59736,25.02968,121.60854);
);
out body geom;
