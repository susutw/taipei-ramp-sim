[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](24.9881,121.58463,25.00987,121.60511);
  way["building"](24.9881,121.58463,25.00987,121.60511);
);
out body geom;
