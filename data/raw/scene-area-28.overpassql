[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](24.99111,121.52985,25.00531,121.54228);
  way["building"](24.99111,121.52985,25.00531,121.54228);
);
out body geom;
