[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.07115,121.49794,25.0888,121.5143);
  way["building"](25.07115,121.49794,25.0888,121.5143);
);
out body geom;
