[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.04893,121.52194,25.07003,121.53332);
  way["building"](25.04893,121.52194,25.07003,121.53332);
);
out body geom;
