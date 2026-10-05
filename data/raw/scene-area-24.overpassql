[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.04989,121.56682,25.06944,121.58557);
  way["building"](25.04989,121.56682,25.06944,121.58557);
);
out body geom;
