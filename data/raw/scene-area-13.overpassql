[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.03851,121.55912,25.06011,121.57595);
  way["building"](25.03851,121.55912,25.06011,121.57595);
);
out body geom;
