[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.03322,121.52245,25.05647,121.54351);
  way["building"](25.03322,121.52245,25.05647,121.54351);
);
out body geom;
