[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.01887,121.48232,25.04174,121.49754);
  way["building"](25.01887,121.48232,25.04174,121.49754);
);
out body geom;
