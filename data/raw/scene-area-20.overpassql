[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](24.97097,121.56339,24.98309,121.58685);
  way["building"](24.97097,121.56339,24.98309,121.58685);
);
out body geom;
