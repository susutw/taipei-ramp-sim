[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.0042,121.54902,25.01911,121.5714);
  way["building"](25.0042,121.54902,25.01911,121.5714);
);
out body geom;
