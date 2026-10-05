[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](24.96876,121.54784,24.98062,121.56239);
  way["building"](24.96876,121.54784,24.98062,121.56239);
);
out body geom;
