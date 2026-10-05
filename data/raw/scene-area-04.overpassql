[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](24.99509,121.56861,25.01345,121.59043);
  way["building"](24.99509,121.56861,25.01345,121.59043);
);
out body geom;
