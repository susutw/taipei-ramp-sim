[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.05451,121.60252,25.07065,121.62463);
  way["building"](25.05451,121.60252,25.07065,121.62463);
);
out body geom;
