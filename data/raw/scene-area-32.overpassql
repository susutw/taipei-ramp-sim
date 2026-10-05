[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.10115,121.49317,25.11695,121.50449);
  way["building"](25.10115,121.49317,25.11695,121.50449);
);
out body geom;
