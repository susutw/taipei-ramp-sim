[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.07073,121.50389,25.08534,121.52487);
  way["building"](25.07073,121.50389,25.08534,121.52487);
);
out body geom;
