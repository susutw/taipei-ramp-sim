[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.08969,121.49154,25.11028,121.51139);
  way["building"](25.08969,121.49154,25.11028,121.51139);
);
out body geom;
