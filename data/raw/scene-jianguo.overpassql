[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.033,121.527,25.057,121.547);
  way["building"](25.033,121.527,25.057,121.547);
);
out body geom;
