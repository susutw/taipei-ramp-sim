[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.01514,121.5246,25.03452,121.54344);
  way["building"](25.01514,121.5246,25.03452,121.54344);
);
out body geom;
