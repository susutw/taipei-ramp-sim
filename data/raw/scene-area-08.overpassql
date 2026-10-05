[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.06156,121.56291,25.07946,121.58586);
  way["building"](25.06156,121.56291,25.07946,121.58586);
);
out body geom;
