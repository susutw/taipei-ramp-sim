[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.02952,121.53215,25.04277,121.5435);
  way["building"](25.02952,121.53215,25.04277,121.5435);
);
out body geom;
