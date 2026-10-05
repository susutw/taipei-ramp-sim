[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.04239,121.61506,25.06445,121.62834);
  way["building"](25.04239,121.61506,25.06445,121.62834);
);
out body geom;
