[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.01798,121.56305,25.03845,121.58227);
  way["building"](25.01798,121.56305,25.03845,121.58227);
);
out body geom;
